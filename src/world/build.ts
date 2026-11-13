import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, fbm } from './noise';
import { structureDetail, registerStructureDetail, STRUCTURE_DETAIL_RANGE, detailCounters } from './structure-detail';
import { toon } from '../render/toon';
import { plasterTexture, roofTexture, stoneTexture, woodTexture } from '../render/textures';

export type Mat = 'stone' | 'plaster' | 'roof' | 'wood' | 'plain' | 'cloth';

const materialSets = new Map<string, Record<Mat, THREE.Material>>();
function getMaterials(detail = false): Record<Mat, THREE.Material> {
  const relief = structureDetail() > 0;
  const key = `${relief}-${detail}`;
  if (materialSets.has(key)) return materialSets.get(key)!;
  const range = detail ? { detailRange: STRUCTURE_DETAIL_RANGE, detailCounters } : {};
  const materials = {
    stone: toon(0xffffff, { vertexColors: true, texture: stoneTexture(), textureSize: 2.6, relief: relief ? 0.085 : 0, ...range }),
    plaster: toon(0xffffff, { vertexColors: true, texture: plasterTexture(), textureSize: 3.4, ...range }),
    roof: toon(0xffffff, { vertexColors: true, texture: roofTexture(), textureSize: 2.2, relief: relief ? 0.045 : 0, ...range }),
    wood: toon(0xffffff, { vertexColors: true, texture: woodTexture(), textureSize: 1.5, relief: relief ? 0.025 : 0, ...range }),
    plain: toon(0xffffff, { vertexColors: true, ...range }),
    cloth: toon(0xffffff, { vertexColors: true, doubleSided: true, ...range }),
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
export class Builder {
  private readonly parts = new Map<Mat, THREE.BufferGeometry[]>();
  private readonly detailParts = new Map<string, Map<Mat, THREE.BufferGeometry[]>>();
  private detailing = false;

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
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, d - edge * 2), bevelEnabled: true, bevelSize: edge, bevelThickness: edge, bevelSegments: 1, steps: 1 }).translate(0, 0, -d / 2 + edge);
    this.add('stone', g, color, place(x, y, z, rot), 0.17);
  }

  /** Rounded fractured rock: coordinate noise preserves shared edges and determinism. */
  rock(x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: number, seed: number): void {
    const g = new THREE.IcosahedronGeometry(1, structureDetail() ? 1 : 0);
    const p = g.attributes.position;
    const random = seededRandom(seed);
    const offset = random() * 100;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const k = 0.86 + 0.14 * fbm(px * 3 + offset, pz * 3 + py * 2 + offset, 2);
      // Stay within the old footprint; the base is buried rather than sliced flat.
      p.setXYZ(i, px * k * w * 0.53, (py * k * 0.5 + 0.47) * h, pz * k * d * 0.53);
    }
    g.computeVertexNormals();
    this.add('stone', g, color, place(x, y, z, rot), 0.22);
    const colors = g.attributes.color;
    for (let i = 0; i < colors.count; i++) {
      const moss = Math.max(0, g.attributes.normal.getY(i)) * 0.16;
      colors.setXYZ(i, colors.getX(i) * (1 - moss), colors.getY(i), colors.getZ(i) * (1 - moss * 1.7));
    }
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

  /** Box standing on (x, y, z), rotated about its vertical axis. */
  box(mat: Mat, x: number, y: number, z: number, w: number, h: number, d: number, rot = 0, color = 0xffffff, shade = 0.12): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, place(x, y, z, rot), shade);
  }

  /** Box given a full transform, for tilted beams and roof slabs. */
  slab(mat: Mat, w: number, h: number, d: number, matrix: THREE.Matrix4, color = 0xffffff): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d), color, matrix);
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
        this.slab('roof', 0.075, 0.06, d + overhang * 2 - 0.08, new THREE.Matrix4().multiplyMatrices(world, local), color);
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
