import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../render/toon';
import { plasterTexture, roofTexture, stoneTexture, woodTexture } from '../render/textures';

export type Mat = 'stone' | 'plaster' | 'roof' | 'wood' | 'plain' | 'cloth';

let materials: Record<Mat, THREE.Material> | null = null;
function getMaterials(): Record<Mat, THREE.Material> {
  materials ??= {
    stone: toon(0xffffff, { vertexColors: true, texture: stoneTexture(), textureSize: 2.6 }),
    plaster: toon(0xffffff, { vertexColors: true, texture: plasterTexture(), textureSize: 3.4 }),
    roof: toon(0xffffff, { vertexColors: true, texture: roofTexture(), textureSize: 2.2 }),
    wood: toon(0xffffff, { vertexColors: true, texture: woodTexture(), textureSize: 1.5 }),
    plain: toon(0xffffff, { vertexColors: true }),
    cloth: toon(0xffffff, { vertexColors: true, doubleSided: true }),
  };
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
    const list = this.parts.get(mat);
    if (list) list.push(g);
    else this.parts.set(mat, [g]);
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
