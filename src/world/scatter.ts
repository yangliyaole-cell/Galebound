import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '../core/quality';
import { lodDepthMaterial } from '../render/lod';
import { toon } from '../render/toon';
import { blossomTexture, leafTexture, needleTexture } from '../render/textures';
import { addRound, surfaceTop } from './colliders';
import { foliageMaterial, leafCards, type Part } from './foliage';
import { heightAt, normalAt, sstep } from './heightmap';
import { CITY, FOREST, HALF, SIZE, START, VILLAGE, ROADS, ABBEY, roadClearance, insideCity, PLAZAS, FIELDS, fieldPolygon, inPolygon, cityRadiusAt } from './layout';
import { blossomDensity, forestDensity } from './maps';
import { fbm, seededRandom } from './noise';
import { Forest } from './flora/forest';
import type { TreeKind } from './flora/tree-models';

/** Trees are grown and drawn by the forest; this size factor converts the old planting scales. */
const TREE_SIZE: Record<TreeKind, number> = { oak: 0.8, great: 0.62, blossom: 0.9, cypress: 0.72, pine: 0.75 };
import { waterLevelAt as surfaceAt } from './heightmap';
const waterLevelAt = (x: number, z: number): number => Math.max(0, surfaceAt(x, z));

function finish(geo: THREE.BufferGeometry, colors: number[], leaf: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const count = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Array(count).fill(leaf), 1));
  return g;
}

/** A cluster of lumpy spheres: the crown of a tree, or a bush. */
function puff(parts: Part[], detail: number, seed: number, lumpiness = 0.2, shade = 1, shrink = 1): THREE.BufferGeometry {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y, , r] of parts) {
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const geos = parts.map(([x, y, z, radius], pi) => {
    const r = radius * shrink;
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i);
      const ny = pos.getY(i);
      const nz = pos.getZ(i);
      const lump = fbm(nx * 2.1 + ny * 1.3 + seed + pi * 7, nz * 2.1 - ny * 1.7 + seed, 2) - 0.5;
      const k = r * (1 + lump * 2 * lumpiness);
      const wy = y + ny * k * 0.92;
      pos.setXYZ(i, x + nx * k, wy, z + nz * k);
      nor.setXYZ(i, nx, ny, nz);
      // Painted shading: dark underneath, light where the sun lands.
      const height = (wy - minY) / (maxY - minY);
      const patch = fbm(nx * 1.2 + pi * 3.1, nz * 1.2 + ny + seed, 2);
      const v = 0.6 + 0.4 * sstep(0.1, 0.85, height * 0.55 + (ny * 0.5 + 0.5) * 0.35 + (patch - 0.5) * 0.14);
      colors.push(v * 0.93 * shade, v * shade, v * 0.84 * shade);
    }
    return finish(g, colors, 1);
  });
  return mergeGeometries(geos);
}

function trunk(top: number, bottom: number, height: number, sides: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, bottom, height, sides, 2).translate(0, height / 2, 0);
  const pos = g.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) + lean * t * t);
    // Flare the roots a little.
    if (t < 0.01) pos.setXYZ(i, pos.getX(i) * 1.35, pos.getY(i), pos.getZ(i) * 1.35);
  }
  const ng = g.toNonIndexed();
  const np = ng.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const v = 0.75 + 0.25 * (np.getY(i) / height);
    colors.push(0.3 * v, 0.2 * v, 0.14 * v);
  }
  return finish(ng, colors, 0);
}

function cone(radius: number, height: number, y: number, sides: number, shade: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, sides, 1).translate(0, y + height / 2, 0).toNonIndexed();
  const pos = g.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = shade * (0.78 + 0.3 * ((pos.getY(i) - y) / height));
    colors.push(v * 0.9, v, v * 0.92);
  }
  return finish(g, colors, 1);
}

function rockGeometry(detail: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.7 + 0.6 * fbm(v.x * 1.6 + v.y * 2.2 + seed, v.z * 1.6 - v.y * 1.9 + seed, 2);
    pos.setXYZ(i, v.x * k, Math.max(-0.35, v.y * k * 0.75), v.z * k);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    // Moss gathers on the top faces.
    const moss = sstep(0.55, 0.9, nor.getY(i)) * sstep(0.45, 0.6, fbm(pos.getX(i) * 2, pos.getZ(i) * 2 + seed, 2));
    const base = 0.82 + 0.18 * nor.getY(i);
    colors.push(base * (1 - moss * 0.35), base * (1 - moss * 0.05), base * (1 - moss * 0.5));
  }
  return finish(g, colors, 1);
}

type Look = 'leaf' | 'blossom' | 'needle';

interface Species {
  /** Trunk plus a dark core that fills the gaps between leaves. */
  hi: THREE.BufferGeometry;
  /** Leaf cards drawn over the core when the tree is near. */
  cards: THREE.BufferGeometry | null;
  look: Look;
  mid?: THREE.BufferGeometry;
  midCards?: THREE.BufferGeometry | null;
  /** Plain lumpy shape for the distance. */
  lo: THREE.BufferGeometry;
  /** Height of the bare trunk, for collision. */
  trunkHeight: number;
  trunkRadius: number;
  sway: boolean;
  shadow: boolean;
  tints: number[];
}

/** A bough from the trunk out into the crown. */
function bough(from: [number, number, number], to: [number, number, number], radius: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius * 0.5, radius, len, 5).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  const ng = g.toNonIndexed();
  const colors: number[] = [];
  for (let i = 0; i < ng.attributes.position.count; i++) colors.push(0.27, 0.18, 0.13);
  return finish(ng, colors, 0);
}

function makeSpecies(detail: number): Record<string, Species> {
  const oakParts: Part[] = [
    [0, 4.0, 0, 2.0], [1.6, 3.3, 0.4, 1.45], [-1.5, 3.4, -0.5, 1.5], [0.3, 5.3, 0.3, 1.4],
    [-0.4, 3.1, 1.5, 1.3], [0.5, 3.2, -1.6, 1.35], [-1.0, 4.7, 0.9, 1.1], [1.1, 4.6, -0.8, 1.15],
  ];
  const greatParts: Part[] = [...oakParts, [2.0, 4.4, 1.3, 1.25], [-2.0, 4.3, 0.9, 1.3], [0.2, 4.2, -2.1, 1.25], [0.9, 2.7, 1.9, 1.0], [-1.7, 2.8, -1.6, 1.05]];
  const oakLo: Part[] = [[0, 4.1, 0, 2.3], [1.3, 3.3, 0.3, 1.5], [-1.2, 3.5, -0.3, 1.6]];
  const boughs = [
    bough([0.15, 2.2, 0], [1.5, 3.4, 0.4], 0.16), bough([0.1, 2.4, 0], [-1.4, 3.5, -0.4], 0.16),
    bough([0.2, 2.6, 0], [-0.3, 3.3, 1.4], 0.13), bough([0.2, 2.6, 0], [0.5, 3.4, -1.5], 0.13),
  ];
  const cypressParts: Part[] = [[0, 2.0, 0, 0.85], [0, 3.3, 0, 1.0], [0, 4.7, 0, 0.92], [0, 6.0, 0, 0.72], [0, 7.0, 0, 0.48], [0, 7.7, 0, 0.26]];
  // A conifer is tiers of drooping boughs, widest at the bottom.
  const pineParts: Part[] = [];
  for (const [radius, y] of [[1.75, 2.2], [1.4, 3.6], [1.05, 4.9], [0.7, 6.1]] as const) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + y;
      pineParts.push([Math.cos(a) * radius * 0.62, y, Math.sin(a) * radius * 0.62, radius * 0.5]);
    }
  }
  pineParts.push([0, 7.2, 0, 0.45], [0, 7.9, 0, 0.25]);
  const pineCore = (sides: number, shade: number): THREE.BufferGeometry[] => [
    cone(1.75, 2.8, 1.5, sides, 0.72 * shade), cone(1.42, 2.6, 3.0, sides, 0.82 * shade),
    cone(1.08, 2.4, 4.4, sides, 0.92 * shade), cone(0.7, 2.6, 5.7, sides, 1.0 * shade),
  ];
  const bushParts: Part[] = [[0, 0.5, 0, 0.75], [0.6, 0.4, 0.2, 0.55], [-0.5, 0.42, -0.3, 0.6]];
  const greens = [0x4f9f3c, 0x5fae40, 0x488f3a, 0x6db648, 0x3f8a3c];
  const result: Record<string, Species> = {
    oak: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'leaf',
      lo: mergeGeometries([trunk(0.2, 0.42, 3.4, 4, 0.25), puff(oakLo, 0, 1, 0.12)]),
      trunkHeight: 2.6, trunkRadius: 0.4, sway: true, shadow: true, tints: greens,
    },
    great: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'leaf',
      lo: mergeGeometries([trunk(0.26, 0.5, 3.6, 6, 0.3), puff(oakParts, 0, 4)]),
      trunkHeight: 2.6, trunkRadius: 0.48, sway: true, shadow: true, tints: [0x58a83e],
    },
    blossom: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'blossom',
      lo: mergeGeometries([trunk(0.18, 0.36, 3.2, 4, -0.3), puff(oakLo, 0, 9, 0.12)]),
      trunkHeight: 2.5, trunkRadius: 0.36, sway: true, shadow: true,
      tints: [0xf29bbb, 0xf5aec8, 0xee86aa, 0xf8c2d6],
    },
    cypress: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'leaf',
      lo: mergeGeometries([trunk(0.14, 0.2, 2.0, 4), puff([[0, 3.2, 0, 1.05], [0, 5.4, 0, 0.9], [0, 7.0, 0, 0.5]], 0, 5, 0.08)]),
      trunkHeight: 6, trunkRadius: 0.45, sway: true, shadow: true,
      tints: [0x2f6a3e, 0x2a6240, 0x367344],
    },
    pine: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'needle',
      lo: mergeGeometries([trunk(0.12, 0.3, 3, 4), cone(1.9, 6.6, 1.6, 6, 0.85)]),
      trunkHeight: 6, trunkRadius: 0.4, sway: true, shadow: true,
      tints: [0x2c6a4c, 0x327456, 0x275f46, 0x3a7c58],
    },
    bush: {
      hi: new THREE.BufferGeometry(),
      cards: null,
      look: 'leaf',
      lo: puff([[0, 0.5, 0, 0.9]], 0, 3, 0.2),
      trunkHeight: 0, trunkRadius: 0, sway: true, shadow: false,
      tints: [0x488f3a, 0x5fae40, 0x3f8a3c, 0x6aa84a],
    },
    rock: {
      hi: rockGeometry(1, 2),
      cards: null,
      look: 'leaf',
      lo: rockGeometry(0, 2),
      trunkHeight: 0, trunkRadius: 0, sway: false, shadow: true,
      tints: [0xb3b0a4, 0xa5a297, 0xc0bcae, 0x9a988f],
    },
  };
  if (!detail) return result;
  // Independent small leaves close up; sparse larger clusters finish the mid crown.
  // This RNG never participates in world placement or collision generation.
  const crowns: Record<string, Part[]> = { oak: oakParts, great: greatParts, blossom: oakParts, cypress: cypressParts, pine: pineParts, bush: bushParts };
  const wood: Record<string, THREE.BufferGeometry[]> = {
    oak: [trunk(0.2, 0.42, 3.4, 10, 0.25), ...boughs],
    great: [trunk(0.26, 0.5, 3.6, 12, 0.3), ...boughs],
    blossom: [trunk(0.18, 0.36, 3.2, 8, -0.3), ...boughs],
    cypress: [trunk(0.14, 0.2, 2, 6)], pine: [trunk(0.12, 0.3, 3, 7)], bush: [],
  };
  for (const [name, parts] of Object.entries(crowns)) {
    const s = result[name];
    const crown = () => name === 'pine' ? pineCore(8, 0.95) : [puff(parts, 1, 17, 0.12, 0.92, 0.98)];
    s.mid = mergeGeometries([...wood[name], ...crown()]);
    s.midCards = leafCards(parts, name === 'pine' ? 5 : 4, name === 'pine' ? 0.45 : 0.25, 17);
    const density = (name === 'great' ? 98 : 60) * (detail > 1 ? 2 : 1);
    const size = name === 'pine' ? 0.22 : name === 'great' ? 0.14 : 0.12;
    const outer = leafCards(parts, density, size, 17, 1.03, 2);
    const inner = leafCards(parts, density * 0.25, size * 0.9, 73, 0.78, 2);
    s.cards = mergeGeometries([outer, inner]);
    s.cards.computeBoundingSphere();
    const cardSizes = s.cards.attributes.aCard;
    let widest = 0;
    for (let i = 0; i < cardSizes.count; i++) widest = Math.max(widest, cardSizes.getX(i));
    s.cards.boundingSphere!.radius += widest * 1.5;
    // Small shaded interior lobes replace the broad solid green inner shell.
    const clumps: Part[] = [];
    for (const [x,y,z,r] of parts) for (let k = 0; k < 6; k++) {
      const dy = 1 - (k + 0.5) / 3, a = k * 2.39996, ring = Math.sqrt(1 - dy * dy);
      clumps.push([x + Math.cos(a) * ring * r * 0.41, y + dy * r * 0.41, z + Math.sin(a) * ring * r * 0.41, r * 0.34]);
    }
    const fill = name === 'pine' ? mergeGeometries(pineCore(16, 0.95)) : puff(clumps, detail > 1 ? 1 : 0, 41, 0.24, 0.78);
    const positions = fill.attributes.position, colors = fill.attributes.color;
    for (let i = 0; i < colors.count; i++) {
      const variation = 0.7 + 0.48 * fbm(positions.getX(i) * 5 + positions.getY(i) * 2, positions.getZ(i) * 5 + 31, 2);
      colors.setXYZ(i, colors.getX(i) * variation, colors.getY(i) * variation, colors.getZ(i) * variation);
    }
    s.hi = mergeGeometries([...wood[name], fill]);
  }
  return result;
}

interface Instance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  tint: number;
}

const REGION = 256;
const REGIONS = SIZE / REGION;

/** Complementary screen-door fades: both representations share the same pixel test. */
export const TREE_LOD = { near: 40, far: 160, nearFade: 8, farFade: 20 } as const;
export function treeLodWeights(distance: number, low = false): [number, number, number] {
  if (low) return [0, 0, 1];
  const mid = THREE.MathUtils.smoothstep(distance, TREE_LOD.near - TREE_LOD.nearFade / 2, TREE_LOD.near + TREE_LOD.nearFade / 2);
  const far = THREE.MathUtils.smoothstep(distance, TREE_LOD.far - TREE_LOD.farFade / 2, TREE_LOD.far + TREE_LOD.farFade / 2);
  return [1 - mid, mid * (1 - far), far];
}

interface Batch {
  list: Instance[];
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  tiers: THREE.InstancedMesh[][];
  prop: boolean;
  tree: boolean;
}

export function createScatter(quality: Pick<Quality, 'tier' | 'propRange'>, sunDir: THREE.Vector3,
  stage: { renderer: THREE.WebGLRenderer; sun: THREE.DirectionalLight; hemisphere: THREE.HemisphereLight }): {
  object: THREE.Group;
  update: (camera: THREE.Vector3) => void;
  stats: () => { tiers: number[]; trees: number[]; blended: number; total: number; allocatedInstances: number };
} {
  const low = quality.tier === 'low';
  const species = makeSpecies(low ? 0 : quality.tier === 'high' ? 2 : 1);
  const forest = new Forest();
  const names = Object.keys(species).filter((name) => !(name in TREE_SIZE));
  const lists = new Map<string, Instance[][]>();
  for (const name of names) lists.set(name, Array.from({ length: REGIONS * REGIONS }, () => []));

  const place = (name: string, x: number, z: number, scale: number, squash = 1, sink = 0.25): void => {
    if (name === 'rock' && roadClearance(x, z) < scale * 0.8 + 0.8) return;
    const ri = Math.floor((x + HALF) / REGION);
    const rj = Math.floor((z + HALF) / REGION);
    if (ri < 0 || rj < 0 || ri >= REGIONS || rj >= REGIONS) return;
    const s = species[name];
    const y = heightAt(x, z) - sink * scale;
    if (name in TREE_SIZE) {
      pick();
      forest.plant(name as TreeKind, x, y + sink * scale - 0.05, z, scale * TREE_SIZE[name as TreeKind]);
      addRound(x, z, s.trunkRadius * scale, y + s.trunkHeight * scale);
      return;
    }
    lists.get(name)![rj * REGIONS + ri].push({
      x, y, z, sx: scale, sy: scale * squash,
      tint: s.tints[Math.floor(pick() * s.tints.length)],
    });
    if (s.trunkRadius > 0) addRound(x, z, s.trunkRadius * scale, y + s.trunkHeight * scale);
    else if (name === 'rock' && scale > 1.1) addRound(x, z, scale * 0.8, y + scale * squash * 0.62);
  };

  const rand = seededRandom(9);
  const pick = seededRandom(10);
  const normal = new THREE.Vector3();
  // Not on a road, a field, or anything that has been built.
  const fields = FIELDS.map(fieldPolygon);
  const clear = (x: number, z: number): boolean =>
    Math.hypot(x - ABBEY.x, z - ABBEY.z) > 70 &&
    roadClearance(x, z) > 1.2 && !insideCity(x, z) &&
    !PLAZAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + 2) &&
    !fields.some((p) => inPolygon(x, z, p)) &&
    surfaceTop(x, z) - heightAt(x, z) < 0.05 && surfaceTop(x + 2, z + 2) - heightAt(x + 2, z + 2) < 0.05 &&
    surfaceTop(x - 2, z - 2) - heightAt(x - 2, z - 2) < 0.05;

  // The great tree beside the starting point, as in the concept art.
  place('great', START.x - 9, START.z - 3, 2.6);
  place('great', START.x - 27, START.z + 19, 2.15);
  place('great', START.x + 25, START.z + 21, 1.95);

  // Small roadside boulders frame the curves without filling their walkable width.
  for (const road of ROADS.filter((r) => r.kind === 'dirt')) {
    for (let i = 4; i < road.pts.length - 1; i += 9) {
      const a = road.pts[i], c = road.pts[i + 1], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const side = i % 2 ? -1 : 1, off = road.widths[i] / 2 + 2.7 + rand() * 2.5;
      const x = a[0] - (c[1] - a[1]) / len * off * side, z = a[1] + (c[0] - a[0]) / len * off * side;
      if (heightAt(x, z) > waterLevelAt(x, z) + 1 && clear(x, z)) place('rock', x, z, 0.7 + rand() * 1.5, 0.65);
    }
  }
  const STEP = 8;
  for (let gz = -HALF + 12; gz < HALF - 12; gz += STEP) {
    for (let gx = -HALF + 12; gx < HALF - 12; gx += STEP) {
      const x = gx + (rand() - 0.5) * STEP * 0.9;
      const z = gz + (rand() - 0.5) * STEP * 0.9;
      const roll = rand();
      const kind = rand();
      const size = rand();
      const h = heightAt(x, z);
      if (h < waterLevelAt(x, z) + 2 || !clear(x, z) || normalAt(x, z, normal).y < 0.8) continue;
      const bloom = blossomDensity(x, z);
      if (bloom > 0.05) {
        if (roll < bloom * 0.5) place('blossom', x, z, 0.9 + size * 0.8);
        continue;
      }
      const density = forestDensity(x, z);
      if (roll > density * 0.8) continue;
      const deep = 1 - sstep(0.6, 1, Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r);
      const high = sstep(55, 100, h) + (z < -800 || (x < -500 && z < -340) ? 0.9 : 0);
      let name = 'oak';
      if (kind < high + deep * 0.25) name = 'pine';
      else if (kind > 0.86 - deep * 0.06) name = 'cypress';
      const scale = (name === 'pine' ? 1.0 : 0.85) + size * (0.8 + deep * 0.7);
      place(name, x, z, scale);
    }
  }

  // Cypress dotted around the village and the city approach, as in the painting.
  for (let i = 0; i < 260; i++) {
    const nearCity = i % 3 === 0;
    const a = rand() * Math.PI * 2;
    const r = nearCity ? cityRadiusAt(a) + 14 + rand() * 90 : 40 + rand() * (VILLAGE.r + 60);
    const x = (nearCity ? CITY.x : VILLAGE.x) + Math.cos(a) * r;
    const z = (nearCity ? CITY.z : VILLAGE.z) + Math.sin(a) * r;
    const size = rand();
    if (heightAt(x, z) < 2.6 || !clear(x, z) || normalAt(x, z, normal).y < 0.82) continue;
    if (rand() < 0.5) place('cypress', x, z, 0.8 + size * 0.7);
    else place('oak', x, z, 0.7 + size * 0.6);
  }

  for (let gz = -HALF + 20; gz < HALF - 20; gz += 13) {
    for (let gx = -HALF + 20; gx < HALF - 20; gx += 13) {
      const x = gx + (rand() - 0.5) * 12;
      const z = gz + (rand() - 0.5) * 12;
      const roll = rand();
      const size = rand();
      const squash = rand();
      const h = heightAt(x, z);
      if (h < waterLevelAt(x, z) + 0.4 || !clear(x, z)) continue;
      const ny = normalAt(x, z, normal).y;
      const density = forestDensity(x, z);
      if (h > 2.2 && h < 110 && ny > 0.8 && roll < 0.06 + density * 0.2) {
        place('bush', x, z, 0.8 + size * 1.3, 0.8 + squash * 0.4, 0.1);
        continue;
      }
      // Boulders gather on steep ground, shores and high country.
      const chance = 0.012 + sstep(0.86, 0.7, ny) * 0.4 + sstep(60, 140, h) * 0.25 + (h < 3 ? 0.08 : 0);
      if (roll > 1 - chance) {
        const s = 0.4 + size * size * 2.6 + sstep(80, 160, h) * size * 2;
        place('rock', x, z, s, 0.55 + squash * 0.4, 0.2);
      }
    }
  }

  const leafMat = toon(0xffffff, { vertexColors: true, leafTint: true, sway: 0.022, lod: true });
  const looks: Record<Look, THREE.ShaderMaterial> | null = low ? null : {
    leaf: foliageMaterial({ texture: leafTexture(), dark: [0.4, 0.58, 0.66], light: [1.4, 1.3, 0.7] }, sunDir),
    blossom: foliageMaterial({ texture: blossomTexture(), dark: [0.7, 0.5, 0.62], light: [1.1, 1.2, 1.2] }, sunDir),
    needle: foliageMaterial({ texture: needleTexture(), dark: [0.48, 0.62, 0.72], light: [1.25, 1.3, 0.85] }, sunDir),
  };
  const stillMat = toon(0xffffff, { vertexColors: true, leafTint: true, lod: true });
  const group = new THREE.Group();
  group.name = 'scatter-three-lod';
  group.userData.lod = TREE_LOD;
  const batches: Batch[] = [];
  const dummy = new THREE.Object3D();
  const spin = seededRandom(11);
  const stats = { tiers: [0, 0, 0], trees: [0, 0, 0], blended: 0, total: 0, allocatedInstances: 0 };
  // A regional batch bounds only the instances currently assigned to that LOD.
  // Compact into these fixed buffers; no per-frame meshes/materials or allocations.
  for (let rj = 0; rj < REGIONS; rj++) for (let ri = 0; ri < REGIONS; ri++) {
    for (const name of names) {
      const list = lists.get(name)![rj * REGIONS + ri];
      if (!list.length) continue;
      const s = species[name];
      const mat = s.sway ? leafMat : stillMat;
      const definitions = low ? [[], [], [s.lo]] : [[s.hi, ...(s.cards ? [s.cards] : [])], [s.mid ?? s.hi, ...(s.midCards ? [s.midCards] : [])], [s.lo]];
      const tiers = definitions.map((geos, tier) => geos.map((geo, part) => {
        // The per-instance band belongs to this batch, never the shared species geometry.
        // Share immutable vertex/index buffers across regions, only LOD bands are unique.
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(geo.index);
        for (const [key, attribute] of Object.entries(geo.attributes)) geometry.setAttribute(key, attribute);
        geometry.boundingSphere = geo.boundingSphere!.clone();
        geometry.setAttribute('aLodBand', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 2), 2).setUsage(THREE.DynamicDrawUsage));
        const m = new THREE.InstancedMesh(geometry, part === 1 ? looks![s.look] : mat, list.length);
        m.name = `${name}-lod${tier}-${ri}-${rj}${part ? '-leaves' : ''}`;
        m.userData.treeTier = tier;
        m.userData.species = name;
        m.userData.tree = name !== 'rock' && name !== 'bush';
        m.userData.leafCards = part === 1;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3).setUsage(THREE.DynamicDrawUsage);
        m.boundingSphere = new THREE.Sphere();
        m.castShadow = part === 0 && s.shadow && tier < 2;
        if (m.castShadow) m.customDepthMaterial = lodDepthMaterial();
        m.receiveShadow = name === 'rock';
        m.matrixAutoUpdate = false;
        group.add(m);
        stats.allocatedInstances += list.length;
        return m;
      }));
      const matrices: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
      for (const inst of list) {
        dummy.position.set(inst.x, inst.y, inst.z);
        dummy.rotation.set(0, spin() * Math.PI * 2, 0);
        dummy.scale.set(inst.sx, inst.sy, inst.sx);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
        colors.push(new THREE.Color(inst.tint).offsetHSL((spin() - 0.5) * 0.035, 0, (spin() - 0.5) * 0.07));
      }
      stats.total += list.length;
      batches.push({ list, matrices, colors, tiers, prop: name === 'bush' || name === 'rock', tree: name !== 'bush' && name !== 'rock' });
    }
  }
  group.userData.species = Object.fromEntries(names.map(name => {
    const s = species[name];
    const tris = (g: THREE.BufferGeometry | null | undefined): number => g ? (g.index?.count ?? g.attributes.position?.count ?? 0) / 3 : 0;
    return [name, { placed: lists.get(name)!.reduce((n, list) => n + list.length, 0), triangles: low ? [0, 0, tris(s.lo)] : [tris(s.hi) + tris(s.cards), tris(s.mid ?? s.hi) + tris(s.midCards), tris(s.lo)], cards: low ? [0, 0, 0] : [tris(s.cards) / 2, tris(s.midCards) / 2, 0] }];
  }));
  group.add(forest.build(stage.renderer, stage.sun, stage.hemisphere, sunDir, low ? 0 : quality.tier === 'high' ? 2 : 1));
  const previous = new THREE.Vector3(Infinity, Infinity, Infinity);
  return {
    object: group,
    stats: () => ({ ...stats, tiers: [...stats.tiers], trees: [...stats.trees] }),
    update: (camera) => {
      forest.update(camera);
      if (previous.distanceToSquared(camera) < 0.25) return;
      previous.copy(camera);
      stats.tiers.fill(0); stats.trees.fill(0); stats.blended = 0;
      for (const b of batches) {
        for (const tier of b.tiers) for (const m of tier) m.count = 0;
        b.list.forEach((inst, i) => {
          const distance = Math.hypot(camera.x - inst.x, camera.y - inst.y, camera.z - inst.z);
          if (b.prop && distance > quality.propRange) return;
          const weights = treeLodWeights(distance, low);
          if (weights.filter(w => w > 0).length > 1) stats.blended++;
          let start = 0;
          weights.forEach((weight, tier) => {
            if (weight > 0) {
              stats.tiers[tier]++;
              if (b.tree) stats.trees[tier]++;
              for (const m of b.tiers[tier]) {
                const j = m.count++;
                m.setMatrixAt(j, b.matrices[i]);
                m.setColorAt(j, b.colors[i]);
                (m.geometry.attributes.aLodBand as THREE.InstancedBufferAttribute).setXY(j, start, start + weight);
              }
            }
            start += weight;
          });
        });
        for (const tier of b.tiers) for (const m of tier) {
          m.visible = m.count > 0;
          if (!m.count) continue;
          m.instanceMatrix.needsUpdate = true;
          m.instanceColor!.needsUpdate = true;
          m.geometry.attributes.aLodBand.needsUpdate = true;
          m.computeBoundingSphere();
        }
      }
    },
  };
}
