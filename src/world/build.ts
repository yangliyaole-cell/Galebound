import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fracturedRock } from './rock-geometry';
import { fbm } from './noise';
import { structureDetail, registerStructureDetail, structureDetailRange, detailCounters } from './structure-detail';
import { toon } from '../render/toon';
import { plasterTexture, roofTexture, stoneTexture, woodTexture } from '../render/textures';

export type Mat = 'stone' | 'plaster' | 'roof' | 'wood' | 'plain' | 'rock' | 'cloth' | 'paving';

const textureSets = new Map<number, Record<'stone' | 'plaster' | 'roof' | 'wood', THREE.Texture>>();
const materialSets = new Map<string, Record<Mat, THREE.Material>>();
function getMaterials(detail = false): Record<Mat, THREE.Material> {
  const relief = structureDetail() > 0;
  const key = `${structureDetail()}-${detail}`;
  if (materialSets.has(key)) return materialSets.get(key)!;
  const range = detail ? { detailRange: structureDetailRange() } : {};
  const resolution = structureDetail() > 1 ? 512 : 256;
  if (!textureSets.has(resolution)) textureSets.set(resolution, {
    stone: stoneTexture(resolution), plaster: plasterTexture(resolution), roof: roofTexture(resolution), wood: woodTexture(resolution),
  });
  const textures = textureSets.get(resolution)!;
  const materials = {
    stone: toon(0xffffff, { pbr: 'masonry', vertexColors: true, texture: textures.stone, textureSize: 2.6, relief: relief ? 0.085 : 0, ...range }),
    plaster: toon(0xffffff, { pbr: 'plaster', vertexColors: true, texture: textures.plaster, textureSize: 3.4, ...range }),
    roof: toon(0xffffff, { pbr: 'roof', vertexColors: true, texture: textures.roof, textureSize: 2.2, relief: relief ? 0.045 : 0, ...range }),
    wood: toon(0xffffff, { pbr: 'wood', vertexColors: true, texture: textures.wood, textureSize: 1.5, relief: relief ? 0.025 : 0, ...range }),
    plain: toon(0xffffff, { vertexColors: true, ...range }),
    // Fractured rubble/wall stones: vertex colour (grain, moss) over the procedural rough-stone PBR (high/medium).
    rock: toon(0xffffff, { pbr: 'stone', vertexColors: true, ...range }),
    cloth: toon(0xffffff, { vertexColors: true, doubleSided: true, ...range }),
    // Street setts: same stone pattern at a smaller scale.
    paving: toon(0xffffff, { pbr: 'paving', vertexColors: true, texture: textures.stone, textureSize: 1.1, ...range }),
  };
  materialSets.set(key, materials);
  return materials;
}

const tmp = new THREE.Color();
const mat4 = new THREE.Matrix4();

/** Y rotation followed by a translation. */
export function place(x: number, y: number, z: number, rot = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
}

/**
 * Collects simple solids, tinted per vertex, and merges them into one mesh per
 * material. A whole village becomes a handful of draw calls.
 */
/** Growable flat triangle soup: positions, normals and colours, non-indexed. */
class Soup {
  pos = new Float32Array(36 * 3 * 64);
  nor = new Float32Array(36 * 3 * 64);
  col = new Float32Array(36 * 3 * 64);
  n = 0;
  reserve(vertices: number): void {
    const need = (this.n + vertices) * 3;
    if (need <= this.pos.length) return;
    let size = this.pos.length * 2;
    while (size < need) size *= 2;
    for (const key of ['pos', 'nor', 'col'] as const) { const next = new Float32Array(size); next.set(this[key]); this[key] = next; }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    return g;
  }
}
// Box faces: normal, then the two in-plane axes (u x v = normal), as unit vectors.
const BOX_FACES = [
  [1, 0, 0, 0, 0, -1, 0, 1, 0], [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, -1, 0, 0, 0, 1, 0],
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

export class Builder {
  private readonly parts = new Map<Mat, THREE.BufferGeometry[]>();
  private readonly detailParts = new Map<string, Map<Mat, THREE.BufferGeometry[]>>();
  /** Boxes go straight into flat arrays: no geometry objects, so no garbage. */
  private readonly soups = new Map<string, Map<Mat, Soup>>();
  private detailing = false;

  private soup(mat: Mat, cell: string): Soup {
    let byMat = this.soups.get(cell);
    if (!byMat) this.soups.set(cell, byMat = new Map());
    let soup = byMat.get(mat);
    if (!soup) byMat.set(mat, soup = new Soup());
    return soup;
  }

  /** Decorative geometry is spatially merged and culled/faded, absent on low. */
  detail(generate: () => void): void {
    if (!structureDetail()) return;
    const previous = this.detailing;
    this.detailing = true;
    try { generate(); } finally { this.detailing = previous; }
  }

  /** Chipped, bevelled masonry with a single bevel segment, not a sharp box. */
  block(x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: number, bevel = 0.04): void {
    const edge = Math.min(bevel, w * 0.15, h * 0.15, d * 0.15);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + edge, edge); shape.lineTo(w / 2 - edge, edge);
    shape.lineTo(w / 2 - edge, h - edge); shape.lineTo(-w / 2 + edge, h - edge); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, d - edge * 2), bevelEnabled: true, bevelSize: edge, bevelThickness: edge, bevelSegments: structureDetail() > 1 ? 3 : 1, steps: 1 }).translate(0, 0, -d / 2 + edge);
    this.add('stone', g, color, place(x, y, z, rot), 0.17);
  }

  /** Fractured, bevelled stone. It uses unpatterned vertex color, never brick UVs. */
  rock(x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: number, seed: number, detail = 1, profile: 'rubble' | 'wall' = 'rubble'): THREE.BufferGeometry {
    const g = fracturedRock(w, h, d, seed, structureDetail(), detail, profile);
    this.add('rock', g, color, place(x, y, z, rot), 0.16);
    const colors = g.attributes.color, pos = g.attributes.position, normal = g.attributes.normal;
    for (let i = 0; i < colors.count; i++) {
      const grain = 0.87 + fbm(pos.getX(i) * 8 + seed, pos.getZ(i) * 8 + pos.getY(i), 2) * 0.17;
      const patch = THREE.MathUtils.smoothstep(fbm(pos.getX(i) * 3.4 + seed, pos.getZ(i) * 3.4, 2), 0.49, 0.7);
      const moss = patch * THREE.MathUtils.smoothstep(normal.getY(i), 0.45, 0.9) * 0.42;
      colors.setXYZ(i, colors.getX(i) * grain * (1 - moss * 0.66), colors.getY(i) * grain * (1 - moss * 0.24), colors.getZ(i) * grain * (1 - moss * 0.87));
    }
    return g;
  }

  /** A facade inset/shutter: its unseen back and edge faces are unnecessary. */
  panel(mat: Mat, x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: number): void {
    const a = -w / 2, b = w / 2, f = d / 2;
    this.emit(mat, [a, 0, f, b, 0, f, b, h, f, a, 0, f, b, h, f, a, h, f], color, place(x, y, z, rot), 0);
  }

  /**
   * Triangles given in local coordinates, transformed by `matrix` (rigid), with flat
   * normals and the same foot-darkening as `add`, written straight into the soups.
   */
  emit(mat: Mat, local: ArrayLike<number>, color: number, matrix: THREE.Matrix4 | null, shade = 0): void {
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < local.length; i += 3) { lo = Math.min(lo, local[i]); hi = Math.max(hi, local[i]); }
    const span = Math.max(1e-3, hi - lo), e = matrix?.elements;
    const count = local.length / 3;
    let cell = '';
    if (this.detailing) {
      let cx = 0, cz = 0;
      for (let i = 0; i < local.length; i += 3) {
        const x = local[i], y = local[i + 1], z = local[i + 2];
        cx += e ? e[0] * x + e[4] * y + e[8] * z + e[12] : x;
        cz += e ? e[2] * x + e[6] * y + e[10] * z + e[14] : z;
      }
      cell = `${Math.floor(cx / count / 128)},${Math.floor(cz / count / 128)}`;
    }
    const soup = this.soup(mat, cell);
    soup.reserve(count);
    tmp.set(color);
    const { r, g, b } = tmp, { pos, nor, col } = soup;
    let o = soup.n * 3;
    for (let i = 0; i < local.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const x = local[i + k * 3], y = local[i + k * 3 + 1], z = local[i + k * 3 + 2];
        pos[o + k * 3] = e ? e[0] * x + e[4] * y + e[8] * z + e[12] : x;
        pos[o + k * 3 + 1] = e ? e[1] * x + e[5] * y + e[9] * z + e[13] : y;
        pos[o + k * 3 + 2] = e ? e[2] * x + e[6] * y + e[10] * z + e[14] : z;
        const s = 1 - shade * (1 - (y - lo) / span);
        col[o + k * 3] = r * s; col[o + k * 3 + 1] = g * s; col[o + k * 3 + 2] = b * s;
      }
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
      const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 3; k++) { nor[o + k * 3] = nx; nor[o + k * 3 + 1] = ny; nor[o + k * 3 + 2] = nz; }
      o += 9;
    }
    soup.n += count;
  }

  /** Open window moulding with real inner/outer reveals, omitting its buried back. */
  windowSurround(x: number, y: number, z: number, w: number, h: number, frame: number, depth: number, rot: number, color: number): void {
    const outer = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
    const inner = [[-w / 2 + frame, frame], [w / 2 - frame, frame], [w / 2 - frame, h - frame], [-w / 2 + frame, h - frame]];
    const vertices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]): void => { vertices.push(...a, ...b, ...c, ...a, ...c, ...d); };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const of = [...outer[i], depth / 2], nf = [...outer[j], depth / 2];
      const inf = [...inner[i], depth / 2], inn = [...inner[j], depth / 2];
      quad(of, nf, inn, inf);
      quad([...outer[j], -depth / 2], nf, of, [...outer[i], -depth / 2]);
      quad(inf, inn, [...inner[j], -depth / 2], [...inner[i], -depth / 2]);
    }
    this.emit('wood', vertices, color, place(x, y, z, rot), 0.12);
  }

  /**
   * @param shade how much to darken the bottom of the solid, as cheap ambient occlusion
   */
  add(mat: Mat, geo: THREE.BufferGeometry, color: number, matrix?: THREE.Matrix4, shade = 0): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const span = Math.max(1e-3, box.max.y - box.min.y);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    tmp.set(color);
    for (let i = 0; i < pos.count; i++) {
      const k = 1 - shade * (1 - (pos.getY(i) - box.min.y) / span);
      colors.set([tmp.r * k, tmp.g * k, tmp.b * k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (matrix) g.applyMatrix4(matrix);
    let parts = this.parts;
    if (this.detailing) {
      g.computeBoundingBox();
      const centre = g.boundingBox!.getCenter(new THREE.Vector3());
      const cell = `${Math.floor(centre.x / 128)},${Math.floor(centre.z / 128)}`;
      if (!this.detailParts.has(cell)) this.detailParts.set(cell, new Map());
      parts = this.detailParts.get(cell)!;
    }
    const list = parts.get(mat);
    if (list) list.push(g);
    else parts.set(mat, [g]);
  }

  /** Box standing on (x, y, z), rotated about its vertical axis. Darkened towards its foot by `shade`. */
  box(mat: Mat, x: number, y: number, z: number, w: number, h: number, d: number, rot = 0, color = 0xffffff, shade = 0.12): void {
    const cell = this.detailing ? `${Math.floor(x / 128)},${Math.floor(z / 128)}` : '';
    const soup = this.soup(mat, cell);
    soup.reserve(36);
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hh = h / 2, hd = d / 2;
    tmp.set(color);
    const { r, g, b } = tmp;
    let o = soup.n * 3;
    const { pos, nor, col } = soup;
    for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of BOX_FACES) {
      const wnx = nx * c + nz * s, wnz = -nx * s + nz * c;
      for (const [cu, cv] of CORNERS) {
        // Local corner: centre of the face plus the two in-plane offsets.
        const lx = (nx + ux * cu + vx * cv) * hw, ly = (ny + uy * cu + vy * cv) * hh + hh, lz = (nz + uz * cu + vz * cv) * hd;
        pos[o] = x + lx * c + lz * s; pos[o + 1] = y + ly; pos[o + 2] = z - lx * s + lz * c;
        nor[o] = wnx; nor[o + 1] = ny; nor[o + 2] = wnz;
        const k = 1 - shade * (1 - ly / Math.max(1e-3, h));
        col[o] = r * k; col[o + 1] = g * k; col[o + 2] = b * k;
        o += 3;
      }
    }
    soup.n += 36;
  }

  /** Box given a full transform, for tilted beams and roof slabs. */
  slab(mat: Mat, w: number, h: number, d: number, matrix: THREE.Matrix4, color = 0xffffff): void {
    const local: number[] = [];
    for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of BOX_FACES) for (const [cu, cv] of CORNERS) {
      local.push((nx + ux * cu + vx * cv) * w / 2, (ny + uy * cu + vy * cv) * h / 2, (nz + uz * cu + vz * cv) * d / 2);
    }
    this.emit(mat, local, color, matrix, 0);
  }

  cyl(mat: Mat, x: number, y: number, z: number, top: number, bottom: number, h: number, color = 0xffffff, seg = 14, shade = 0.12): void {
    this.add(mat, new THREE.CylinderGeometry(top, bottom, h, seg).translate(0, h / 2, 0), color, place(x, y, z), shade);
  }

  cone(mat: Mat, x: number, y: number, z: number, r: number, h: number, color = 0xffffff, seg = 14, rot = 0): void {
    this.add(mat, new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), color, place(x, y, z, rot));
  }

  /** Four-sided pointed roof over a w x d rectangle. */
  pyramid(mat: Mat, x: number, y: number, z: number, w: number, d: number, h: number, rot = 0, color = 0xffffff): void {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4).rotateY(Math.PI / 4).scale(w, 1, d).translate(0, h / 2, 0);
    this.add(mat, g, color, place(x, y, z, rot));
  }

  /** Solid triangular prism: the gable of a house. Ridge runs along local Z. */
  prism(mat: Mat, x: number, y: number, z: number, w: number, d: number, h: number, rot = 0, color = 0xffffff): void {
    const a = [-w / 2, 0, -d / 2];
    const b = [w / 2, 0, -d / 2];
    const c = [w / 2, 0, d / 2];
    const e = [-w / 2, 0, d / 2];
    const r1 = [0, h, -d / 2];
    const r2 = [0, h, d / 2];
    const v = [a, e, r2, a, r2, r1, b, r1, r2, b, r2, c, e, c, r2, b, a, r1].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    this.add(mat, g, color, place(x, y, z, rot));
  }

  /**
   * Pitched roof of two overhanging slabs. Ridge runs along local Z.
   */
  roof(x: number, y: number, z: number, w: number, d: number, h: number, rot: number, color: number, overhang = 0.5): void {
    const angle = Math.atan2(h, w / 2);
    const length = Math.hypot(w / 2, h) + overhang;
    const world = place(x, y, z, rot);
    for (const side of [1, -1]) {
      // Each slab runs from the ridge down past the eave.
      const mid = (length / 2 - 0.05) * side;
      const local = new THREE.Matrix4()
        .makeRotationZ(-angle * side)
        .setPosition(Math.cos(angle) * mid, h - Math.sin(angle) * Math.abs(mid) + 0.08, 0);
      this.slab('roof', length, 0.2, d + overhang * 2, mat4.multiplyMatrices(world, local).clone(), color);
    }
    this.detail(() => {
      const rows = Math.ceil(length / 0.62);
      for (const side of [-1, 1]) for (let row = 1; row < rows; row++) {
        const t = row * length / rows;
        const local = new THREE.Matrix4().makeRotationZ(-angle * side)
          .setPosition(Math.cos(angle) * t * side, h - Math.sin(angle) * t + 0.205, 0);
        detailCounters.roofCourses++;
        const transform = new THREE.Matrix4().multiplyMatrices(world, local);
        if (structureDetail() < 2) this.slab('roof', 0.075, 0.06, d + overhang * 2 - 0.08, transform, color);
        else {
          // Individually separated, curved tile lips; the solid roof remains below.
          const count = Math.ceil((d + overhang * 2) / 0.55), tile = (d + overhang * 2) / count;
          const vertices: number[] = [];
          for (let k = 0; k < count; k++) for (let j = 0; j < 3; j++) {
            const z0 = -d / 2 - overhang + (k + 0.04 + j * 0.92 / 3) * tile;
            const z1 = z0 + tile * 0.92 / 3;
            const y0 = Math.sin(j / 3 * Math.PI) * 0.045, y1 = Math.sin((j + 1) / 3 * Math.PI) * 0.045;
            vertices.push(-0.075,y0,z0, -0.075,y1,z1, 0.075,y1,z1, -0.075,y0,z0, 0.075,y1,z1, 0.075,y0,z0);
          }
          this.emit('roof', vertices, color, transform, 0);
        }
      }
    });
    // Ridge cap.
    this.slab('roof', 0.36, 0.22, d + overhang * 2 + 0.1, mat4.multiplyMatrices(world, new THREE.Matrix4().setPosition(0, h + 0.14, 0)).clone(), color);
  }

  /** Flat shape in the XY plane, extruded along Z and centred on it. */
  shape(mat: Mat, shape: THREE.Shape, depth: number, matrix: THREE.Matrix4, color = 0xffffff): void {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -depth / 2);
    this.add(mat, g, color, matrix, 0.1);
  }

  build(castShadow = true): THREE.Group {
    // Fold the box soups in with the other parts of their material and cell.
    for (const [cell, byMat] of this.soups) for (const [mat, soup] of byMat) {
      if (!soup.n) continue;
      let parts = this.parts;
      if (cell) {
        if (!this.detailParts.has(cell)) this.detailParts.set(cell, new Map());
        parts = this.detailParts.get(cell)!;
      }
      const list = parts.get(mat);
      if (list) list.push(soup.geometry()); else parts.set(mat, [soup.geometry()]);
    }
    this.soups.clear();
    const group = new THREE.Group();
    const mats = getMaterials();
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mats[mat]);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.parts.clear();
    const detailMats = getMaterials(true);
    for (const [cell, parts] of this.detailParts) for (const [mat, list] of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), detailMats[mat]);
      mesh.name = `structure-detail-${cell}-${mat}`;
      // Thin relief receives shadows; it does not introduce detached/fading shadow casters.
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      registerStructureDetail(mesh);
      group.add(mesh);
    }
    this.detailParts.clear();
    return group;
  }
}

export interface Opening {
  x: number;
  w: number;
  /** Height of the top of the arch. */
  crown: number;
}

/**
 * Outline of a wall seen side-on, with round-headed openings cut up from its
 * foot. The arches are part of the outline itself, not holes, so the shape
 * always triangulates.
 */
export function archedProfile(
  left: number, right: number, bottom: number, top: (x: number) => number, openings: Opening[], steps = 1,
): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(left, bottom);
  for (const o of [...openings].sort((p, q) => p.x - q.x)) {
    const r = o.w / 2;
    shape.lineTo(o.x - r, bottom);
    shape.lineTo(o.x - r, o.crown - r);
    shape.absarc(o.x, o.crown - r, r, Math.PI, 0, true);
    shape.lineTo(o.x + r, bottom);
  }
  shape.lineTo(right, bottom);
  for (let i = 0; i <= steps; i++) {
    const x = right + ((left - right) * i) / steps;
    shape.lineTo(x, top(x));
  }
  shape.closePath();
  return shape;
}

/** Places where a light orb should appear, collected while the world is built. */
export interface Spot {
  id: string;
  x: number;
  z: number;
  /** Height above whatever surface is there. */
  up: number;
}
export const orbSpots: Spot[] = [];
export function orbAt(id: string, x: number, z: number, up = 1.2): void {
  orbSpots.push({ id, x, z, up });
}
