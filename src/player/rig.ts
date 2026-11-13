import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { outlineMaterial, toon } from '../render/toon';

/**
 * Builds a jointed cartoon human from lofted cross-sections. Each joint owns
 * one merged, vertex-coloured mesh, so a whole character is about 15 draw calls.
 */

export interface RigStyle {
  skin: number;
  hair: number;
  top: number;
  trim: number;
  trousers: number;
  boots: number;
  leather: number;
  /** Scarf colour, or null for none. */
  scarf: number | null;
  /** Short shoulder cape. */
  mantle: number | null;
  hairStyle: 'spiky' | 'bun' | 'long' | 'bald';
  hat: 'none' | 'straw' | 'cap';
  /** Long skirt hiding the legs. */
  dress: number | null;
  apron: number | null;
  /** Overall size; 1 is the hero. */
  scale: number;
  /** Shoulder and hip width multiplier. */
  build: number;
  eye: number;
}

export const HERO_STYLE: RigStyle = {
  skin: 0xf2cfb2,
  hair: 0x5b3d2e,
  top: 0x353d4b,
  trim: 0x9a8354,
  trousers: 0x20242b,
  boots: 0x2a211d,
  leather: 0x4b3627,
  scarf: 0x8f2f2b,
  mantle: 0x24282f,
  hairStyle: 'spiky',
  hat: 'none',
  dress: null,
  apron: null,
  scale: 1,
  build: 1,
  eye: 0x3b6c8c,
};

export interface Pose {
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  spineX: number;
  spineY: number;
  spineZ: number;
  chestX: number;
  chestY: number;
  headX: number;
  headY: number;
  headZ: number;
  armLX: number;
  armLY: number;
  armLZ: number;
  armRX: number;
  armRY: number;
  armRZ: number;
  elbowL: number;
  elbowR: number;
  wristL: number;
  wristR: number;
  legLX: number;
  legLZ: number;
  legRX: number;
  legRZ: number;
  kneeL: number;
  kneeR: number;
  footL: number;
  footR: number;
}

/** Standing relaxed. Forward is +Z; a positive x angle swings a limb backward. */
export const REST: Pose = {
  bodyY: 0, bodyPitch: 0, bodyRoll: 0, bodyYaw: 0,
  spineX: 0, spineY: 0, spineZ: 0, chestX: 0, chestY: 0,
  headX: 0, headY: 0, headZ: 0,
  armLX: 0, armLY: 0, armLZ: 0.1, armRX: 0, armRY: 0, armRZ: -0.1,
  elbowL: -0.12, elbowR: -0.12, wristL: 0, wristR: 0,
  legLX: 0, legLZ: 0.02, legRX: 0, legRZ: -0.02,
  kneeL: 0, kneeR: 0, footL: 0, footR: 0,
};
export const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Mesh | null;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  footL: THREE.Group;
  footR: THREE.Group;
  hipHeight: number;
}

interface Ring {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
}

const tmpColor = new THREE.Color();

function paint(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  tmpColor.set(color);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A smooth skin stretched over elliptical rings, like a lathe with a varying profile. */
function loft(rings: Ring[], seg: number, color: number, capTop = true, capBottom = true): THREE.BufferGeometry {
  const rs = rings[0].y <= rings[rings.length - 1].y ? rings : [...rings].reverse();
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rs) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push((r.x ?? 0) + r.rx * Math.cos(a), r.y, (r.z ?? 0) + r.rz * Math.sin(a));
    }
  }
  for (let i = 0; i < rs.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  const cap = (ring: Ring, base: number, up: boolean): void => {
    const c = pos.length / 3;
    pos.push(ring.x ?? 0, ring.y, ring.z ?? 0);
    for (let j = 0; j < seg; j++) {
      const a = base + j;
      const b = base + ((j + 1) % seg);
      if (up) idx.push(c, b, a);
      else idx.push(c, a, b);
    }
  };
  if (capBottom) cap(rs[0], 0, false);
  if (capTop) cap(rs[rs.length - 1], (rs.length - 1) * seg, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return paint(geo, color);
}

function ball(r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number, detail = 10): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, detail, Math.max(6, detail - 2)).scale(sx, sy, sz).translate(x, y, z), color);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return paint(g.translate(x, y, z), color);
}

/** A cone lock of hair, base at the given point, pointing along the euler direction from -Y. */
function spike(r: number, h: number, x: number, y: number, z: number, rx: number, rz: number, color: number, flat = 0.6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 6, 1).rotateX(Math.PI).translate(0, -h / 2, 0).scale(1, 1, flat);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz, 'YZX')));
  return paint(g.translate(x, y, z), color);
}

const bodyMaterial = toon(0xffffff, { vertexColors: true, plain: true, rim: 0.3 });
const eyeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const hull = outlineMaterial(0.009);

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function attach(parent: THREE.Object3D, parts: THREE.BufferGeometry[], outline: boolean): THREE.Mesh {
  const geo = mergeGeometries(parts);
  const mesh = new THREE.Mesh(geo, bodyMaterial);
  mesh.castShadow = true;
  parent.add(mesh);
  if (outline) parent.add(new THREE.Mesh(geo, hull));
  return mesh;
}

export function buildRig(style: RigStyle, hero: boolean, outline: boolean): Rig {
  const seg = hero ? 18 : 10;
  const b = style.build;
  const hipHeight = 0.92;
  const root = new THREE.Group();
  root.scale.setScalar(style.scale);
  const body = joint(root, 0, hipHeight, 0);

  // ---- hips
  const hips: THREE.BufferGeometry[] = [
    loft([
      { y: -0.13, rx: 0.05 * b, rz: 0.055 }, { y: -0.08, rx: 0.128 * b, rz: 0.098 },
      { y: 0, rx: 0.142 * b, rz: 0.104 }, { y: 0.075, rx: 0.126 * b, rz: 0.092 },
    ], seg, style.trousers),
    loft([{ y: 0.025, rx: 0.136 * b, rz: 0.1 }, { y: 0.075, rx: 0.133 * b, rz: 0.098 }], seg, style.leather),
    box(0.04, 0.045, 0.02, 0, 0.05, 0.1, style.trim),
  ];
  if (style.dress !== null) {
    hips.push(loft([
      { y: 0.07, rx: 0.13 * b, rz: 0.095 }, { y: -0.2, rx: 0.19 * b, rz: 0.17 },
      { y: -0.6, rx: 0.25 * b, rz: 0.24 }, { y: -0.72, rx: 0.27 * b, rz: 0.26 },
    ], seg, style.dress, false, true));
  } else {
    // The skirt of the tunic.
    hips.push(loft([
      { y: 0.06, rx: 0.132 * b, rz: 0.098 }, { y: -0.06, rx: 0.165 * b, rz: 0.125 },
      { y: -0.17, rx: 0.19 * b, rz: 0.15 }, { y: -0.185, rx: 0.165 * b, rz: 0.128 },
    ], seg, style.top, false, true));
    hips.push(loft([{ y: -0.15, rx: 0.192 * b, rz: 0.152 }, { y: -0.178, rx: 0.194 * b, rz: 0.154 }], seg, style.trim, false, false));
  }
  if (style.apron !== null) hips.push(box(0.2, 0.42, 0.02, 0, -0.16, 0.13, style.apron, -0.12));
  if (hero) {
    hips.push(box(0.075, 0.1, 0.085, -0.15, -0.035, 0.03, style.leather));
    hips.push(box(0.08, 0.02, 0.09, -0.15, 0.015, 0.03, style.trim));
  }
  attach(body, hips, outline);

  // ---- waist
  const spine = joint(body, 0, 0.06, 0);
  attach(spine, [
    loft([
      { y: 0, rx: 0.123 * b, rz: 0.088 }, { y: 0.08, rx: 0.11 * b, rz: 0.08 },
      { y: 0.21, rx: 0.128 * b, rz: 0.092 },
    ], seg, style.top, false, false),
  ], outline);

  // ---- chest, neck and shoulders
  const chest = joint(spine, 0, 0.2, 0);
  const chestParts: THREE.BufferGeometry[] = [
    loft([
      { y: -0.02, rx: 0.126 * b, rz: 0.09 }, { y: 0.08, rx: 0.152 * b, rz: 0.106 },
      { y: 0.17, rx: 0.16 * b, rz: 0.106, z: -0.004 }, { y: 0.235, rx: 0.13 * b, rz: 0.088 },
      { y: 0.275, rx: 0.058, rz: 0.055 },
    ], seg, style.top),
    loft([{ y: 0.25, rx: 0.045, rz: 0.045 }, { y: 0.35, rx: 0.041, rz: 0.042 }], seg, style.skin, false, false),
  ];
  if (hero) {
    // A satchel strap across the chest.
    chestParts.push(box(0.035, 0.42, 0.012, 0.02, 0.1, 0.103, style.leather, 0.02, 0, 0.62));
    chestParts.push(box(0.035, 0.42, 0.012, 0.02, 0.1, -0.1, style.leather, -0.02, 0, -0.62));
  }
  if (style.mantle !== null) {
    chestParts.push(loft([
      { y: 0.29, rx: 0.07, rz: 0.068 }, { y: 0.24, rx: 0.15 * b, rz: 0.108 },
      { y: 0.165, rx: 0.212 * b, rz: 0.135 }, { y: 0.12, rx: 0.222 * b, rz: 0.14 },
      { y: 0.105, rx: 0.2 * b, rz: 0.122 },
    ], seg, style.mantle, false, true));
    chestParts.push(loft([{ y: 0.135, rx: 0.223 * b, rz: 0.142 }, { y: 0.112, rx: 0.225 * b, rz: 0.143 }], seg, style.trim, false, false));
    // A hood folded down at the back.
    chestParts.push(ball(0.085, 1.25, 0.72, 0.8, 0, 0.235, -0.115, style.mantle, seg));
  }
  if (style.scarf !== null) {
    const ring = new THREE.TorusGeometry(0.07, 0.04, 8, seg).rotateX(Math.PI / 2).scale(1.05, 0.95, 1).translate(0, 0.3, 0.004);
    chestParts.push(paint(ring, style.scarf));
    chestParts.push(ball(0.036, 1, 0.9, 0.8, 0.055, 0.28, -0.075, style.scarf, 8));
  }
  attach(chest, chestParts, outline);

  // ---- head
  const head = joint(chest, 0, 0.335, 0);
  const headParts: THREE.BufferGeometry[] = [
    loft([
      { y: -0.02, rx: 0.03, rz: 0.03, z: 0.036 }, { y: 0.008, rx: 0.074, rz: 0.07, z: 0.022 },
      { y: 0.05, rx: 0.104, rz: 0.098, z: 0.008 }, { y: 0.1, rx: 0.118, rz: 0.112 },
      { y: 0.16, rx: 0.117, rz: 0.114, z: -0.004 }, { y: 0.21, rx: 0.088, rz: 0.09, z: -0.008 },
      { y: 0.24, rx: 0.036, rz: 0.04, z: -0.01 },
    ], hero ? 22 : 12, style.skin),
    ball(0.022, 0.5, 1, 0.8, 0.117, 0.088, 0.004, style.skin, 8),
    ball(0.022, 0.5, 1, 0.8, -0.117, 0.088, 0.004, style.skin, 8),
    ball(0.011, 1, 0.9, 1, 0, 0.066, 0.119, style.skin, 6),
    box(0.03, 0.006, 0.01, 0, 0.03, 0.094, 0xb5665c),
    box(0.045, 0.009, 0.012, 0.047, 0.142, 0.106, style.hair, 0, -0.25, 0.1),
    box(0.045, 0.009, 0.012, -0.047, 0.142, 0.106, style.hair, 0, 0.25, -0.1),
  ];
  const h = style.hair;
  if (style.hairStyle !== 'bald') {
    headParts.push(loft([
      { y: 0.105, rx: 0.125, rz: 0.118, z: -0.014 }, { y: 0.165, rx: 0.127, rz: 0.126, z: -0.01 },
      { y: 0.218, rx: 0.098, rz: 0.102, z: -0.012 }, { y: 0.255, rx: 0.042, rz: 0.046, z: -0.012 },
    ], hero ? 22 : 12, h));
    headParts.push(ball(0.118, 1.04, 1.0, 0.74, 0, 0.075, -0.045, h, hero ? 14 : 8));
  }
  if (style.hairStyle === 'spiky') {
    // Fringe across the forehead, longer locks at the sides, tufts at the back.
    for (const [a, len, tilt] of [[-1.15, 0.13, 0.5], [-0.72, 0.1, 0.34], [-0.36, 0.09, 0.2], [0.02, 0.075, 0.05], [0.4, 0.095, -0.2], [0.78, 0.105, -0.36], [1.18, 0.13, -0.5]]) {
      headParts.push(spike(0.04, len, Math.sin(a) * 0.112, 0.178, Math.cos(a) * 0.1, -0.12 - Math.cos(a) * 0.14, tilt * 0.35, h, 0.55));
    }
    for (const [a, len] of [[2.1, 0.13], [2.6, 0.15], [3.14, 0.16], [3.7, 0.15], [4.2, 0.13]]) {
      headParts.push(spike(0.045, len, Math.sin(a) * 0.105, 0.09, Math.cos(a) * 0.1, 0.55, Math.sin(a) * 0.25, h, 0.7));
    }
    headParts.push(spike(0.03, 0.09, 0.02, 0.245, -0.02, Math.PI - 0.5, 0.35, h, 0.6));
    headParts.push(spike(0.035, 0.08, -0.05, 0.235, 0.0, Math.PI - 0.3, -0.7, h, 0.6));
  } else if (style.hairStyle === 'bun') {
    headParts.push(ball(0.055, 1, 1, 1, 0, 0.2, -0.11, h, 8));
  } else if (style.hairStyle === 'long') {
    headParts.push(loft([
      { y: 0.12, rx: 0.12, rz: 0.06, z: -0.075 }, { y: -0.05, rx: 0.115, rz: 0.05, z: -0.085 },
      { y: -0.2, rx: 0.085, rz: 0.035, z: -0.095 },
    ], 10, h));
  }
  if (style.hat === 'straw') {
    headParts.push(loft([{ y: 0.19, rx: 0.3, rz: 0.3 }, { y: 0.215, rx: 0.13, rz: 0.13 }, { y: 0.29, rx: 0.1, rz: 0.1 }], 14, 0xe2c77a));
    headParts.push(loft([{ y: 0.215, rx: 0.134, rz: 0.134 }, { y: 0.235, rx: 0.128, rz: 0.128 }], 14, 0x8a4b3a, false, false));
  } else if (style.hat === 'cap') {
    headParts.push(loft([{ y: 0.175, rx: 0.13, rz: 0.13 }, { y: 0.23, rx: 0.115, rz: 0.12 }, { y: 0.265, rx: 0.05, rz: 0.06 }], 12, style.trim));
  }
  attach(head, headParts, outline);

  let eyes: THREE.Mesh | null = null;
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const x = 0.046 * side;
      if (hero) {
        parts.push(ball(0.03, 0.95, 1.22, 0.3, x, 0, 0.099, 0xffffff, 10));
        parts.push(ball(0.021, 0.95, 1.25, 0.3, x, -0.003, 0.106, style.eye, 10));
        parts.push(ball(0.012, 1, 1.3, 0.3, x, -0.004, 0.11, 0x15121a, 8));
        parts.push(ball(0.0065, 1, 1, 0.3, x + 0.009, 0.012, 0.113, 0xffffff, 6));
      } else {
        parts.push(ball(0.015, 1, 1.4, 0.4, x, 0, 0.105, 0x2a1d1a, 6));
      }
    }
    eyes = new THREE.Mesh(mergeGeometries(parts), eyeMaterial);
    eyes.position.y = 0.094;
    head.add(eyes);
  }

  // ---- arms
  const makeArm = (side: number): [THREE.Group, THREE.Group, THREE.Group] => {
    const arm = joint(chest, 0.172 * b * side, 0.2, 0);
    const sleeve = style.top;
    const upper: THREE.BufferGeometry[] = [
      ball(0.06, 1, 0.96, 1, 0, -0.004, 0, sleeve, seg > 12 ? 12 : 8),
      loft([
        { y: 0, rx: 0.056, rz: 0.056 }, { y: -0.1, rx: 0.052, rz: 0.054 },
        { y: -0.2, rx: 0.046, rz: 0.048 }, { y: -0.275, rx: 0.043, rz: 0.044 },
      ], seg > 12 ? 12 : 8, sleeve, false, true),
    ];
    if (hero) {
      // Bands where the wind cloths are sewn on.
      upper.push(loft([{ y: -0.03, rx: 0.058, rz: 0.06 }, { y: -0.055, rx: 0.057, rz: 0.059 }], 12, style.trim, false, false));
      upper.push(loft([{ y: -0.235, rx: 0.049, rz: 0.051 }, { y: -0.262, rx: 0.048, rz: 0.05 }], 12, style.trim, false, false));
    }
    attach(arm, upper, outline);
    const fore = joint(arm, 0, -0.27, 0);
    const lower: THREE.BufferGeometry[] = [
      ball(0.045, 1, 1, 1, 0, 0, 0, sleeve, 8),
      loft([
        { y: 0, rx: 0.044, rz: 0.045 }, { y: -0.07, rx: 0.046, rz: 0.047 },
        { y: -0.2, rx: 0.035, rz: 0.036 }, { y: -0.255, rx: 0.03, rz: 0.032 },
      ], seg > 12 ? 12 : 8, hero ? style.skin : sleeve, false, true),
    ];
    if (hero) {
      lower.push(loft([
        { y: -0.085, rx: 0.049, rz: 0.05 }, { y: -0.15, rx: 0.044, rz: 0.045 }, { y: -0.225, rx: 0.036, rz: 0.038 },
      ], 12, style.leather, false, false));
      lower.push(loft([{ y: -0.085, rx: 0.051, rz: 0.052 }, { y: -0.1, rx: 0.05, rz: 0.051 }], 12, style.trim, false, false));
    }
    attach(fore, lower, outline);
    const hand = joint(fore, 0, -0.25, 0);
    attach(hand, [
      loft([
        { y: 0, rx: 0.03, rz: 0.022 }, { y: -0.035, rx: 0.04, rz: 0.023 },
        { y: -0.078, rx: 0.036, rz: 0.021 }, { y: -0.108, rx: 0.02, rz: 0.014 },
      ], 8, style.skin).rotateY(Math.PI / 2),
      ball(0.014, 1, 1.7, 1, 0, -0.04, 0.034, style.skin, 6),
    ], outline);
    return [arm, fore, hand];
  };
  const [armL, foreL, handL] = makeArm(1);
  const [armR, foreR, handR] = makeArm(-1);

  // ---- legs
  const makeLeg = (side: number): [THREE.Group, THREE.Group, THREE.Group] => {
    const leg = joint(body, 0.078 * b * side, -0.02, 0);
    attach(leg, [
      loft([
        { y: 0.02, rx: 0.08, rz: 0.086 }, { y: -0.12, rx: 0.08, rz: 0.086 },
        { y: -0.3, rx: 0.064, rz: 0.068 }, { y: -0.445, rx: 0.054, rz: 0.057 },
      ], seg > 12 ? 12 : 8, style.trousers),
    ], outline);
    const shin = joint(leg, 0, -0.44, 0);
    attach(shin, [
      ball(0.056, 1, 1, 1.05, 0, 0, 0, style.trousers, 8),
      loft([
        { y: 0, rx: 0.054, rz: 0.057 }, { y: -0.1, rx: 0.058, rz: 0.064, z: -0.008 },
        { y: -0.28, rx: 0.044, rz: 0.048 }, { y: -0.42, rx: 0.04, rz: 0.044 },
      ], seg > 12 ? 12 : 8, style.trousers, false, false),
      loft([
        { y: -0.13, rx: 0.068, rz: 0.074, z: -0.006 }, { y: -0.16, rx: 0.064, rz: 0.07, z: -0.006 },
        { y: -0.3, rx: 0.052, rz: 0.056 }, { y: -0.43, rx: 0.048, rz: 0.052 },
      ], seg > 12 ? 12 : 8, style.boots, true, false),
      loft([{ y: -0.125, rx: 0.07, rz: 0.076, z: -0.006 }, { y: -0.15, rx: 0.069, rz: 0.075, z: -0.006 }], 12, style.leather, true, false),
    ], outline);
    const foot = joint(shin, 0, -0.42, 0);
    // Lofted along the foot's length, then laid flat.
    const sole = (len: number, w: number, hgt: number): Ring => ({ y: len, rx: w, rz: hgt, z: 0.06 - hgt });
    attach(foot, [
      loft([
        sole(-0.068, 0.028, 0.03), sole(-0.035, 0.046, 0.052), sole(0.03, 0.05, 0.05),
        sole(0.1, 0.052, 0.038), sole(0.155, 0.044, 0.028), sole(0.185, 0.022, 0.016),
      ], 10, style.boots).rotateX(Math.PI / 2),
    ], outline);
    return [leg, shin, foot];
  };
  const [legL, shinL, footL] = makeLeg(1);
  const [legR, shinR, footR] = makeLeg(-1);

  return {
    root, body, spine, chest, head, eyes, armL, armR, foreL, foreR, handL, handR,
    legL, legR, shinL, shinR, footL, footR, hipHeight,
  };
}

export function applyPose(rig: Rig, p: Pose): void {
  rig.body.position.y = rig.hipHeight + p.bodyY;
  rig.body.rotation.set(p.bodyPitch, p.bodyYaw, p.bodyRoll);
  rig.spine.rotation.set(p.spineX, p.spineY, p.spineZ);
  rig.chest.rotation.set(p.chestX, p.chestY, 0);
  rig.head.rotation.set(p.headX, p.headY, p.headZ);
  rig.armL.rotation.set(p.armLX, p.armLY, p.armLZ);
  rig.armR.rotation.set(p.armRX, p.armRY, p.armRZ);
  rig.foreL.rotation.x = p.elbowL;
  rig.foreR.rotation.x = p.elbowR;
  rig.handL.rotation.x = p.wristL;
  rig.handR.rotation.x = p.wristR;
  rig.legL.rotation.set(p.legLX, 0, p.legLZ);
  rig.legR.rotation.set(p.legRX, 0, p.legRZ);
  rig.shinL.rotation.x = p.kneeL;
  rig.shinR.rotation.x = p.kneeR;
  rig.footL.rotation.x = p.footL;
  rig.footR.rotation.x = p.footR;
}

export function blendPose(current: Pose, target: Pose, k: number): void {
  for (const key of POSE_KEYS) current[key] += (target[key] - current[key]) * k;
}
