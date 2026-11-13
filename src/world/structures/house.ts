import * as THREE from 'three';
import { Builder, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';

export interface HouseSpec {
  x: number;
  z: number;
  /** The front door faces local +Z, turned by this angle. */
  rot: number;
  w: number;
  d: number;
  floors: number;
  roof: number;
  wall: number;
  timber: boolean;
  /** Ridge parallel to the front (eaves over the door) rather than gable-on. */
  ridgeAlongFront: boolean;
  shutters: number;
  chimney: boolean;
  /** Leave the door out so an animated one can be hung there. */
  liveDoor?: boolean;
  /** 0: full detail. 1: plain windows. 2: plain windows on the front only. */
  simple?: number;
}

export interface BuiltHouse {
  /** Hinge of the front door, on the ground floor. */
  doorX: number;
  doorZ: number;
  doorY: number;
  rot: number;
  /** A point just outside the door. */
  stepX: number;
  stepZ: number;
  topY: number;
  spec: HouseSpec;
}

/** Registry of generated footprints, also used by the headless layout audit. */
export const builtHouses: BuiltHouse[] = [];

const BEAM = 0x5b4332;
const GLASS = 0x34526d;
const STONE = 0xd6cfbf;
const FLOOR = 2.7;

export const WALLS = [0xf4ecda, 0xf8f1e4, 0xecdfc8, 0xf1e4d0, 0xe8dcc8, 0xf6ead2];
export const ROOFS = [0xc9623c, 0xd4734a, 0xba563a, 0xd07d4e, 0xc56a45, 0xb44f38];
export const SLATES = [0x6b7f98, 0x5f738c, 0x7688a0];
export const SHUTTERS = [0x3f7f7a, 0x4a7a4a, 0x3d6a94, 0x8a4a3a, 0x6a5a8a, 0x2f6a5a];

export function addHouse(b: Builder, h: HouseSpec, rand: () => number): BuiltHouse {
  const c = Math.cos(h.rot);
  const s = Math.sin(h.rot);
  const at = (lx: number, lz: number): [number, number] => [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
  const { w, d } = h;

  let lo = Infinity;
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
    lo = Math.min(lo, heightAt(...at(lx, lz)));
  }
  const front = heightAt(...at(0, d / 2 + 0.6));
  const floorY = Math.max(front, lo) + 0.28;
  const wallH = h.floors * FLOOR + 0.15;
  const eave = floorY + wallH;

  b.box('stone', h.x, lo - 2, h.z, w + 0.3, floorY - lo + 2.02, d + 0.3, h.rot, STONE, 0.25);
  b.box('plaster', h.x, floorY, h.z, w, wallH, d, h.rot, h.wall, 0.1);

  const span = h.ridgeAlongFront ? d : w;
  const length = h.ridgeAlongFront ? w : d;
  const roofH = span * 0.42 + 0.5;
  const roofRot = h.ridgeAlongFront ? h.rot + Math.PI / 2 : h.rot;
  b.prism('plaster', h.x, eave, h.z, span - 0.04, length - 0.04, roofH, roofRot, h.wall);
  b.roof(h.x, eave, h.z, span, length, roofH, roofRot, h.roof);

  /** Puts a box on one of the four walls. u runs along the wall, v is height above the floor. */
  const onFace = (face: number, mat: 'wood' | 'plain' | 'stone', u: number, v: number, bw: number, bh: number, bd: number, color: number, out = 0): void => {
    const half = face % 2 === 0 ? d / 2 : w / 2;
    const p = half + out;
    const [x, z] = face === 0 ? at(u, p) : face === 1 ? at(p, -u) : face === 2 ? at(-u, -p) : at(-p, u);
    b.box(mat, x, floorY + v, z, bw, bh, bd, h.rot + (face * Math.PI) / 2, color, 0);
  };
  const faceWidth = (face: number): number => (face % 2 === 0 ? w : d);

  if (h.timber) {
    for (let face = 0; face < 4; face++) {
      const fw = faceWidth(face);
      for (let f = 0; f <= h.floors; f++) onFace(face, 'wood', 0, f * FLOOR - (f ? 0.1 : 0), fw + 0.12, 0.2, 0.1, BEAM, 0.02);
      for (const u of [-fw / 2 + 0.1, fw / 2 - 0.1]) onFace(face, 'wood', u, 0, 0.2, wallH, 0.1, BEAM, 0.02);
      // Studs and braces on the upper storeys.
      for (let f = 1; f < h.floors; f++) {
        const n = Math.max(2, Math.round(fw / 2.4));
        for (let i = 1; i < n; i++) onFace(face, 'wood', -fw / 2 + (fw * i) / n, f * FLOOR, 0.14, FLOOR, 0.08, BEAM, 0.02);
      }
    }
    // Diagonal braces on the front.
    const world = place(h.x, floorY, h.z, h.rot);
    for (const side of [1, -1]) {
      for (let f = 1; f < h.floors; f++) {
        const local = new THREE.Matrix4().makeRotationZ(0.72 * side).setPosition((w / 2 - 0.95) * side, f * FLOOR + 1.3, d / 2 + 0.05);
        b.slab('wood', 0.13, 2.5, 0.08, new THREE.Matrix4().multiplyMatrices(world, local), BEAM);
      }
    }
  }

  // Door, slightly off centre.
  const doorU = (rand() - 0.5) * (w - 3.2);
  if (!h.liveDoor) onFace(0, 'wood', doorU, 0, 1.05, 2.05, 0.12, 0x6d4c33, 0.02);
  onFace(0, 'wood', doorU, 2.05, 1.5, 0.2, 0.2, BEAM, 0.03);
  for (const side of [1, -1]) onFace(0, 'wood', doorU + 0.66 * side, 0, 0.18, 2.05, 0.2, BEAM, 0.03);
  onFace(0, 'stone', doorU, -0.3, 1.9, 0.3, 0.9, STONE, 0.4);

  const addWindow = (face: number, u: number, f: number): void => {
    const v = f * FLOOR + 1.0;
    if (h.simple) {
      onFace(face, 'plain', u, v, 0.8, 1.05, 0.1, GLASS, 0.01);
      for (const side of [1, -1]) onFace(face, 'wood', u + 0.62 * side, v - 0.02, 0.34, 1.08, 0.06, h.shutters, 0.03);
      return;
    }
    onFace(face, 'wood', u, v - 0.08, 0.95, 1.2, 0.08, BEAM, 0.0);
    onFace(face, 'plain', u, v, 0.78, 1.02, 0.1, GLASS, 0.01);
    onFace(face, 'wood', u, v, 0.05, 1.02, 0.12, 0xe9e2d2, 0.012);
    onFace(face, 'wood', u, v + 0.48, 0.78, 0.05, 0.12, 0xe9e2d2, 0.012);
    for (const side of [1, -1]) onFace(face, 'wood', u + 0.66 * side, v - 0.02, 0.36, 1.08, 0.06, h.shutters, 0.03);
    onFace(face, 'stone', u, v - 0.16, 1.1, 0.08, 0.24, STONE, 0.06);
    if (rand() < 0.3) {
      // A window box with flowers.
      onFace(face, 'wood', u, v - 0.42, 0.95, 0.2, 0.26, 0x7a5a3c, 0.14);
      onFace(face, 'plain', u, v - 0.24, 0.85, 0.18, 0.22, 0x4f9a45, 0.15);
      onFace(face, 'plain', u - 0.2, v - 0.1, 0.16, 0.1, 0.16, [0xe35b6a, 0xf2c94c, 0xf08fb0][Math.floor(rand() * 3)], 0.16);
      onFace(face, 'plain', u + 0.22, v - 0.12, 0.14, 0.1, 0.14, 0xf4f0e4, 0.16);
    }
  };
  for (let face = 0; face < 4; face++) {
    if (h.simple === 2 && face !== 0) continue;
    const fw = faceWidth(face);
    const n = Math.max(1, Math.floor((fw - 1.2) / 2.5));
    for (let f = 0; f < h.floors; f++) {
      for (let i = 0; i < n; i++) {
        const u = -fw / 2 + (fw * (i + 0.5)) / n;
        if (face === 0 && f === 0 && Math.abs(u - doorU) < 1.5) continue;
        if (face === 2 && rand() < 0.3) continue;
        addWindow(face, u, f);
      }
    }
  }
  // A round window high in each gable.
  if (!h.ridgeAlongFront) {
    for (const face of [0, 2]) onFace(face, 'plain', 0, wallH + roofH * 0.28, 0.6, 0.6, 0.1, GLASS, 0.01);
  }

  if (h.chimney) {
    const [cx, cz] = h.ridgeAlongFront ? at(w * 0.27, -d * 0.18) : at(-w * 0.2, d * 0.2);
    b.box('stone', cx, eave + roofH * 0.25, cz, 0.75, roofH * 0.75 + 1.0, 0.75, h.rot, 0xc4bcae, 0.15);
    b.box('stone', cx, eave + roofH + 1.0, cz, 0.95, 0.18, 0.95, h.rot, 0xaaa294, 0);
  }

  const half = span / 2;
  addBox(h.x, h.z, w / 2, d / 2, h.rot, (lx, lz) => {
    const across = Math.abs(h.ridgeAlongFront ? lz : lx);
    return eave + Math.max(0, 1 - across / half) * roofH;
  });

  const [doorX, doorZ] = at(doorU - 0.5, d / 2 + 0.08);
  const [stepX, stepZ] = at(doorU, d / 2 + 1.5);
  const built = { doorX, doorZ, doorY: floorY, rot: h.rot, stepX, stepZ, topY: eave + roofH, spec: h };
  builtHouses.push(built);
  return built;
}
