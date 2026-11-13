import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '../core/quality';
import { toon } from '../render/toon';
import { addRound, surfaceTop } from './colliders';
import { heightAt, normalAt, sstep } from './heightmap';
import { CITY, FOREST, HALF, SIZE, START, VILLAGE } from './layout';
import { blossomDensity, cobbleAt, fieldAt, forestDensity, roadAt } from './maps';
import { fbm, seededRandom } from './noise';

type Part = [number, number, number, number];

function finish(geo: THREE.BufferGeometry, colors: number[], leaf: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const count = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Array(count).fill(leaf), 1));
  return g;
}

/** A cluster of lumpy spheres: the crown of a tree, or a bush. */
function puff(parts: Part[], detail: number, seed: number, lumpiness = 0.2): THREE.BufferGeometry {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y, , r] of parts) {
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const geos = parts.map(([x, y, z, r], pi) => {
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
      colors.push(v * 0.93, v, v * 0.84);
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
    colors.push(0.38 * v, 0.27 * v, 0.19 * v);
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

interface Species {
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
  /** Height of the bare trunk, for collision. */
  trunkHeight: number;
  trunkRadius: number;
  sway: boolean;
  shadow: boolean;
  tints: number[];
}

function makeSpecies(): Record<string, Species> {
  const oakParts: Part[] = [
    [0, 4.0, 0, 2.0], [1.6, 3.3, 0.4, 1.45], [-1.5, 3.4, -0.5, 1.5], [0.3, 5.3, 0.3, 1.4],
    [-0.4, 3.1, 1.5, 1.3], [0.5, 3.2, -1.6, 1.35], [-1.0, 4.7, 0.9, 1.1], [1.1, 4.6, -0.8, 1.15],
  ];
  const oakLo: Part[] = [[0, 4.1, 0, 2.3], [1.3, 3.3, 0.3, 1.5], [-1.2, 3.5, -0.3, 1.6]];
  const cypressHi = puff([[0, 3.6, 0, 1]], 2, 5, 0.12).scale(0.62, 3.0, 0.62).translate(0, -7.0, 0);
  const cypressLo = puff([[0, 3.6, 0, 1]], 1, 5, 0.1).scale(0.62, 3.0, 0.62).translate(0, -7.0, 0);
  const pineTiers = (sides: number): THREE.BufferGeometry[] => [
    cone(2.0, 2.8, 1.6, sides, 0.72), cone(1.65, 2.6, 3.2, sides, 0.82),
    cone(1.25, 2.4, 4.7, sides, 0.92), cone(0.8, 2.2, 6.1, sides, 1.0),
  ];
  const greens = [0x5fb548, 0x6cc04a, 0x55a640, 0x78c552, 0x4f9e44];
  return {
    oak: {
      hi: mergeGeometries([trunk(0.2, 0.42, 3.4, 8, 0.25), puff(oakParts, 2, 1)]),
      lo: mergeGeometries([trunk(0.2, 0.42, 3.4, 5, 0.25), puff(oakLo, 1, 1)]),
      trunkHeight: 2.6, trunkRadius: 0.4, sway: true, shadow: true, tints: greens,
    },
    great: {
      hi: mergeGeometries([trunk(0.26, 0.5, 3.6, 12, 0.3), puff([...oakParts, [1.9, 4.4, 1.2, 1.2], [-1.9, 4.3, 0.9, 1.25], [0.2, 4.2, -2.0, 1.2]], 3, 4, 0.16)]),
      lo: mergeGeometries([trunk(0.26, 0.5, 3.6, 6, 0.3), puff(oakParts, 2, 4)]),
      trunkHeight: 2.6, trunkRadius: 0.48, sway: true, shadow: true, tints: [0x62b84a],
    },
    blossom: {
      hi: mergeGeometries([trunk(0.18, 0.36, 3.2, 8, -0.3), puff(oakParts, 2, 9)]),
      lo: mergeGeometries([trunk(0.18, 0.36, 3.2, 5, -0.3), puff(oakLo, 1, 9)]),
      trunkHeight: 2.5, trunkRadius: 0.36, sway: true, shadow: true,
      tints: [0xf7a9c4, 0xf9bdd2, 0xf48fb1, 0xfbd0de],
    },
    cypress: {
      hi: mergeGeometries([trunk(0.14, 0.2, 1.4, 6), cypressHi.translate(0, 0.6, 0)]),
      lo: mergeGeometries([trunk(0.14, 0.2, 1.4, 4), cypressLo.translate(0, 0.6, 0)]),
      trunkHeight: 6, trunkRadius: 0.45, sway: true, shadow: true,
      tints: [0x356f42, 0x2f6a45, 0x3c7a48],
    },
    pine: {
      hi: mergeGeometries([trunk(0.12, 0.3, 3, 7), ...pineTiers(9)]),
      lo: mergeGeometries([trunk(0.12, 0.3, 3, 4), cone(1.9, 6.6, 1.6, 6, 0.85)]),
      trunkHeight: 6, trunkRadius: 0.4, sway: true, shadow: true,
      tints: [0x2f6b4f, 0x35755a, 0x2a6148, 0x3d7f5c],
    },
    bush: {
      hi: puff([[0, 0.5, 0, 0.75], [0.6, 0.4, 0.2, 0.55], [-0.5, 0.42, -0.3, 0.6]], 1, 3, 0.25),
      lo: puff([[0, 0.5, 0, 0.9]], 0, 3, 0.2),
      trunkHeight: 0, trunkRadius: 0, sway: true, shadow: false,
      tints: [0x4f9e44, 0x5fb548, 0x468f3f, 0x6aa84a],
    },
    rock: {
      hi: rockGeometry(1, 2),
      lo: rockGeometry(0, 2),
      trunkHeight: 0, trunkRadius: 0, sway: false, shadow: true,
      tints: [0xb3b0a4, 0xa5a297, 0xc0bcae, 0x9a988f],
    },
  };
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

interface RegionMeshes {
  cx: number;
  cz: number;
  hi: THREE.InstancedMesh[];
  lo: THREE.InstancedMesh[];
  props: boolean[];
}

export function createScatter(quality: Quality): {
  object: THREE.Group;
  update: (camera: THREE.Vector3) => void;
} {
  const species = makeSpecies();
  const names = Object.keys(species);
  const lists = new Map<string, Instance[][]>();
  for (const name of names) lists.set(name, Array.from({ length: REGIONS * REGIONS }, () => []));

  const place = (name: string, x: number, z: number, scale: number, squash = 1, sink = 0.25): void => {
    const ri = Math.floor((x + HALF) / REGION);
    const rj = Math.floor((z + HALF) / REGION);
    if (ri < 0 || rj < 0 || ri >= REGIONS || rj >= REGIONS) return;
    const s = species[name];
    const y = heightAt(x, z) - sink * scale;
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
  const clear = (x: number, z: number): boolean =>
    roadAt(x, z) < 0.12 && cobbleAt(x, z) < 0.12 && fieldAt(x, z) < 0.1 &&
    surfaceTop(x, z) - heightAt(x, z) < 0.05 && surfaceTop(x + 2, z + 2) - heightAt(x + 2, z + 2) < 0.05 &&
    surfaceTop(x - 2, z - 2) - heightAt(x - 2, z - 2) < 0.05;

  // The great tree beside the starting point, as in the concept art.
  place('great', START.x - 9, START.z - 3, 2.6);

  const STEP = 8;
  for (let gz = -HALF + 12; gz < HALF - 12; gz += STEP) {
    for (let gx = -HALF + 12; gx < HALF - 12; gx += STEP) {
      const x = gx + (rand() - 0.5) * STEP * 0.9;
      const z = gz + (rand() - 0.5) * STEP * 0.9;
      const roll = rand();
      const kind = rand();
      const size = rand();
      const h = heightAt(x, z);
      if (h < 2 || !clear(x, z) || normalAt(x, z, normal).y < 0.8) continue;
      const bloom = blossomDensity(x, z);
      if (bloom > 0.05) {
        if (roll < bloom * 0.5) place('blossom', x, z, 0.9 + size * 0.8);
        continue;
      }
      const density = forestDensity(x, z);
      if (roll > density * 0.8) continue;
      const deep = 1 - sstep(0.6, 1, Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r);
      const high = sstep(55, 100, h) + (z < -800 ? 0.5 : 0);
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
    const r = nearCity ? CITY.wall + 14 + rand() * 90 : 40 + rand() * (VILLAGE.r + 60);
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
      if (h < 0.4 || !clear(x, z)) continue;
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

  const leafMat = toon(0xffffff, { vertexColors: true, leafTint: true, sway: 0.022 });
  const stillMat = toon(0xffffff, { vertexColors: true, leafTint: true });
  const group = new THREE.Group();
  const regions: RegionMeshes[] = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const spin = seededRandom(11);

  for (let rj = 0; rj < REGIONS; rj++) {
    for (let ri = 0; ri < REGIONS; ri++) {
      const region: RegionMeshes = {
        cx: (ri + 0.5) * REGION - HALF,
        cz: (rj + 0.5) * REGION - HALF,
        hi: [], lo: [], props: [],
      };
      for (const name of names) {
        const list = lists.get(name)![rj * REGIONS + ri];
        if (!list.length) continue;
        const s = species[name];
        const mat = s.sway ? leafMat : stillMat;
        const hi = new THREE.InstancedMesh(s.hi, mat, list.length);
        const lo = new THREE.InstancedMesh(s.lo, mat, list.length);
        list.forEach((inst, i) => {
          dummy.position.set(inst.x, inst.y, inst.z);
          dummy.rotation.set(0, spin() * Math.PI * 2, 0);
          dummy.scale.set(inst.sx, inst.sy, inst.sx);
          dummy.updateMatrix();
          hi.setMatrixAt(i, dummy.matrix);
          lo.setMatrixAt(i, dummy.matrix);
          color.set(inst.tint).offsetHSL((spin() - 0.5) * 0.03, 0, (spin() - 0.5) * 0.07);
          hi.setColorAt(i, color);
          lo.setColorAt(i, color);
        });
        hi.castShadow = s.shadow;
        hi.receiveShadow = name === 'rock';
        for (const m of [hi, lo]) {
          m.matrixAutoUpdate = false;
          m.computeBoundingSphere();
          group.add(m);
        }
        region.hi.push(hi);
        region.lo.push(lo);
        region.props.push(name === 'bush' || name === 'rock');
      }
      regions.push(region);
    }
  }

  const half = REGION * 0.71;
  return {
    object: group,
    update: (camera) => {
      for (const r of regions) {
        const d = Math.max(0, Math.hypot(camera.x - r.cx, camera.z - r.cz) - half);
        const detailed = d < quality.treeDetailRange;
        for (let i = 0; i < r.hi.length; i++) {
          const shown = !r.props[i] || d < quality.propRange;
          r.hi[i].visible = shown && detailed;
          r.lo[i].visible = shown && !detailed;
        }
      }
    },
  };
}
