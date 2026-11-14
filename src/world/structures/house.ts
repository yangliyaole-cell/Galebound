import * as THREE from 'three';
import { Builder, archedProfile, place } from '../build';
import { addBox } from '../colliders';
import { detailCounters } from '../structure-detail';
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
  /** Dressed stone walls instead of plaster. */
  masonry?: boolean;
  /** Hipped roof (four slopes) instead of two gables. */
  hip?: boolean;
  /** A tall house with a pyramid roof. */
  tower?: boolean;
  /** Upper storeys jut out over the street on timber corbels. */
  jetty?: boolean;
  /** Gabled windows standing on the front slope of the roof. */
  dormers?: number;
  /** A small timber balcony on the first floor. */
  balcony?: boolean;
  /** Ground floor is a shop: open front, counter, striped awning and a hanging sign. */
  shop?: { awning: number; stripe: number; sign: number; goods: number[] };
  /** Ground floor opens in an arcade along its front. */
  arcade?: boolean;
  /** Climbing plants on the walls; the colour of their flowers, if any. */
  vines?: number | null;
  /** Window boxes of flowers. */
  flowers?: boolean;
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
/** Warmer washes and pale stone for the town. */
export const TOWN_WALLS = [0xf4ecda, 0xf3e3c3, 0xeed9c8, 0xf6eedf, 0xe9e0cc, 0xf0dcb8, 0xe8e2d4, 0xf5e6cf];
export const ROOFS = [0xc9623c, 0xd4734a, 0xba563a, 0xd07d4e, 0xc56a45, 0xb44f38];
export const TOWN_ROOFS = [...ROOFS, 0xa94a32, 0xd98a5a, 0xc87a4a, 0xb85e3e];
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
  const wallMat = h.masonry ? 'stone' : 'plaster';
  // A jettied house: ground floor flush, the storeys above pushed out over the street.
  const jut = h.jetty && h.floors > 1 ? 0.55 : 0;
  if (jut) {
    b.box(wallMat, h.x, floorY, h.z, w, FLOOR, d, h.rot, h.wall, 0.1);
    const [jx, jz] = at(0, jut / 2);
    b.box(wallMat, jx, floorY + FLOOR, jz, w, wallH - FLOOR, d + jut, h.rot, h.wall, 0.05);
    // Corbels carry the overhang.
    for (let k = 0; k <= Math.round(w / 1.3); k++) {
      const u = -w / 2 + 0.15 + (w - 0.3) * k / Math.round(w / 1.3);
      const [cx, cz] = at(u, d / 2 + jut / 2);
      b.box('wood', cx, floorY + FLOOR - 0.32, cz, 0.18, 0.3, jut + 0.05, h.rot, BEAM, 0);
    }
  } else b.box(wallMat, h.x, floorY, h.z, w, wallH, d, h.rot, h.wall, 0.1);

  const [rx, rz] = at(0, jut / 2);
  const dd = d + jut;
  const span = h.ridgeAlongFront ? dd : w;
  const length = h.ridgeAlongFront ? w : dd;
  const roofH = h.tower ? Math.max(w, dd) * 0.85 : span * 0.42 + 0.5;
  const roofRot = h.ridgeAlongFront ? h.rot + Math.PI / 2 : h.rot;
  if (h.tower) {
    b.pyramid('roof', rx, eave - 0.05, rz, w + 0.9, dd + 0.9, roofH, h.rot, h.roof);
    b.box('wood', rx, eave - 0.3, rz, w + 0.3, 0.3, dd + 0.3, h.rot, BEAM, 0);
  } else if (h.hip) {
    hipRoof(b, rx, eave, rz, span, length, roofH, roofRot, h.roof);
  } else {
    b.prism(wallMat, rx, eave, rz, span - 0.04, length - 0.04, roofH, roofRot, h.wall);
    b.roof(rx, eave, rz, span, length, roofH, roofRot, h.roof);
  }

  /** A point on one of the four walls (0 front, then anticlockwise), allowing for a jetty above the ground floor. */
  const facePoint = (face: number, u: number, v: number, out: number, half = face % 2 === 0 ? d / 2 : w / 2): [number, number] => {
    const p = half + out + (face === 0 && v >= FLOOR - 0.05 ? jut : 0);
    const shift = face % 2 === 1 && v >= FLOOR - 0.05 ? jut / 2 : 0;
    return face === 0 ? at(u, p) : face === 1 ? at(p, -u + shift) : face === 2 ? at(-u, -p) : at(-p, u + shift);
  };
  /** Puts a box on one of the four walls. u runs along the wall, v is height above the floor. */
  const onFace = (face: number, mat: 'wood' | 'plain' | 'stone' | 'cloth', u: number, v: number, bw: number, bh: number, bd: number, color: number, out = 0, flat = false): void => {
    const half = face % 2 === 0 ? d / 2 : w / 2;
    // Above a jetty the front wall stands further out, and the side walls are longer.
    const [x, z] = facePoint(face, u, v, out, half);
    if (flat) b.panel(mat, x, floorY + v, z, bw, bh, bd, h.rot + face * Math.PI / 2, color);
    else b.box(mat, x, floorY + v, z, bw, bh, bd, h.rot + (face * Math.PI) / 2, color, 0);
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
        const local = new THREE.Matrix4().makeRotationZ(0.72 * side).setPosition((w / 2 - 0.95) * side, f * FLOOR + 1.3, d / 2 + 0.05 + jut);
        b.slab('wood', 0.13, 2.5, 0.08, new THREE.Matrix4().multiplyMatrices(world, local), BEAM);
      }
    }
  }

  // Door, slightly off centre; a shop keeps the other side of the front for its counter.
  const shopW = h.shop ? Math.min(3.2, w - 2.6) : 0;
  const doorU = h.shop && shopW > 1.6 ? (rand() < 0.5 ? -1 : 1) * (w / 2 - 0.95) : (rand() - 0.5) * (w - 3.2);
  const shopU = shopW > 1.6 ? (doorU > 0 ? -1 : 1) * Math.max(0, w / 2 - shopW / 2 - 0.4) : NaN;
  if (h.shop && shopW > 1.6) shopFront(onFace, b, facePoint, h, shopU, shopW, floorY, rand);
  if (h.arcade) arcadeFront(b, at, h, floorY);
  // The balcony stands in front of a first-floor window, which becomes a glazed door.
  const balconyU = h.balcony && h.floors > 1 ? (doorU > 0 ? -1 : 1) * Math.min(w / 2 - 1.5, 0.9) : NaN;
  if (!Number.isNaN(balconyU)) balcony(onFace, balconyU, h, rand);
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
        if (face === 0 && f === 0 && (Math.abs(u - doorU) < 1.5 || Math.abs(u - shopU) < shopW / 2 + 0.6 || h.arcade)) continue;
        if (face === 0 && f === 1 && Math.abs(u - balconyU) < 1.3) continue;
        if (face === 2 && rand() < 0.3) continue;
        addWindow(face, u, f);
      }
    }
  }
  if (h.dormers && h.ridgeAlongFront && !h.tower) dormers(b, at, h, eave, roofH, dd, jut, rand);
  // A round window high in each gable.
  if (!h.ridgeAlongFront && !h.hip && !h.tower) {
    for (const face of [0, 2]) onFace(face, 'plain', 0, wallH + roofH * 0.28, 0.6, 0.6, 0.1, GLASS, 0.01);
  }

  if (h.chimney) {
    const [cx, cz] = h.ridgeAlongFront ? at(w * 0.27, -d * 0.18) : at(-w * 0.2, d * 0.2);
    b.box('stone', cx, eave + roofH * 0.25, cz, 0.75, roofH * 0.75 + 1.0, 0.75, h.rot, 0xc4bcae, 0.15);
    b.box('stone', cx, eave + roofH + 1.0, cz, 0.95, 0.18, 0.95, h.rot, 0xaaa294, 0);
  }

  b.detail(() => {
    detailCounters.houseFacades++;
    // Crisp cornice and exposed rafters give the overhang a readable thickness.
    for (let face = 0; face < 4; face++) {
      const fw = faceWidth(face);
      onFace(face, 'wood', 0, wallH - 0.19, fw + 0.22, 0.18, 0.22, BEAM, 0.055);
      onFace(face, 'stone', 0, -0.06, fw + 0.24, 0.18, 0.22, STONE, 0.045);
      if (h.simple) {
        const n = Math.max(1, Math.floor((fw - 1.2) / 2.5));
        for (let f = 0; f < h.floors; f++) for (let i = 0; i < n; i++) {
          const u = -fw / 2 + fw * (i + 0.5) / n, v = f * FLOOR + 1;
          if (face === 0 && f === 0 && (Math.abs(u - doorU) < 1.5 || Math.abs(u - shopU) < shopW / 2 + 0.6 || h.arcade)) continue;
          if (face === 0 && f === 1 && Math.abs(u - balconyU) < 1.3) continue;
          // The base city model has front-only windows. Supply the other facades nearby.
          onFace(face, 'plain', u, v, 0.8, 1.05, 0.12, GLASS, 0.018, true);
          const [wx, wz] = facePoint(face, u, v, 0.04);
          b.windowSurround(wx, floorY + v - 0.1, wz, 1.0, 1.25, 0.1, 0.18, h.rot + face * Math.PI / 2, BEAM);
          if (face !== 0 && h.simple === 2) for (const side of [-1, 1]) {
            onFace(face, 'wood', u + side * 0.66, v - 0.02, 0.32, 1.08, 0.09, h.shutters, 0.035, true);
          }
          onFace(face, 'wood', u, v, 0.045, 1.05, 0.16, 0xe9e2d2, 0.055, true);
          onFace(face, 'wood', u, v + 0.5, 0.8, 0.045, 0.16, 0xe9e2d2, 0.055, true);
          onFace(face, 'stone', u, v - 0.14, 1.15, 0.12, 0.36, STONE, 0.09);
          if (h.flowers && face === 0 && rand() < 0.45) windowBox(onFace, face, u, v, rand);
        }
      }
      // Volumetric corner strips use the procedural block normal relief for joints.
      for (const side of [-1, 1]) onFace(face, 'stone', side * (fw / 2 - 0.16), 0, 0.32, wallH - 0.22, 0.13, STONE, 0.025);
    }
    // Door planks, a latch and iron straps. A live door keeps its animated opening.
    if (!h.liveDoor) {
      for (let i = -2; i <= 2; i++) onFace(0, 'wood', doorU + i * 0.19, 0.05, 0.014, 1.94, 0.015, BEAM, 0.09);
      for (const v of [0.35, 1.45]) onFace(0, 'plain', doorU, v, 0.96, 0.045, 0.035, 0x46443b, 0.105);
      onFace(0, 'plain', doorU + 0.3, 0.93, 0.08, 0.16, 0.06, 0xc2a168, 0.13);
    }
    if (h.vines != null) vines(b, facePoint, h, wallH, floorY, rand);
    // Eave rafters are within the original roof's 0.5m overhang.
    const roofWorld = place(rx, eave, rz, roofRot);
    if (!h.tower) for (const side of [-1, 1]) for (let i = 0; i <= Math.floor(length / 1.4); i++) {
      const z = -length / 2 + i * 1.4;
      const local = new THREE.Matrix4().makeRotationZ(-Math.atan2(roofH, span / 2) * side)
        .setPosition(side * (span / 2 + 0.12), -0.12, z);
      b.slab('wood', 0.5, 0.13, 0.11, new THREE.Matrix4().multiplyMatrices(roofWorld, local), BEAM);
    }
  });

  const half = span / 2;
  addBox(rx, rz, w / 2, dd / 2, h.rot, (lx, lz) => {
    if (h.tower) return eave + Math.max(0, 1 - Math.max(Math.abs(lx) / (w / 2), Math.abs(lz) / (dd / 2))) * roofH;
    const across = Math.abs(h.ridgeAlongFront ? lz : lx);
    let rise = Math.max(0, 1 - across / half);
    if (h.hip) {
      const along = Math.abs(h.ridgeAlongFront ? lx : lz);
      rise = Math.min(rise, Math.max(0, (length / 2 - along) / half));
    }
    return eave + rise * roofH;
  });

  const [doorX, doorZ] = at(doorU - 0.5, d / 2 + 0.08);
  const [stepX, stepZ] = at(doorU, d / 2 + 1.5);
  const built = { doorX, doorZ, doorY: floorY, rot: h.rot, stepX, stepZ, topY: eave + roofH, spec: h };
  builtHouses.push(built);
  return built;
}

type FaceFn = (face: number, mat: 'wood' | 'plain' | 'stone' | 'cloth', u: number, v: number, bw: number, bh: number, bd: number, color: number, out?: number, flat?: boolean) => void;
type PointFn = (face: number, u: number, v: number, out: number) => [number, number];

/** Four slopes rising to a short ridge (or a point), eaves overhanging all round. */
function hipRoof(b: Builder, x: number, y: number, z: number, span: number, length: number, h: number, rot: number, color: number): void {
  const o = 0.5, sx = span / 2 + o, sz = length / 2 + o, drop = o * h / (span / 2);
  const ridge = Math.max(0, (length - span) / 2);
  const A = [-sx, -drop, -sz], B = [sx, -drop, -sz], C = [sx, -drop, sz], D = [-sx, -drop, sz];
  const R1 = [0, h, -ridge], R2 = [0, h, ridge];
  const v = [D, C, R2, D, R2, R1, D, R1, A, B, A, R1, B, R1, R2, B, R2, C, A, B, C, A, C, D].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  b.add('roof', g, color, place(x, y + 0.12, z, rot));
  // Ridge and hip caps.
  if (ridge > 0.05) b.slab('roof', 0.34, 0.2, ridge * 2 + 0.2, new THREE.Matrix4().multiplyMatrices(place(x, y + 0.12, z, rot), new THREE.Matrix4().setPosition(0, h + 0.08, 0)), color);
}

/** Open shop front: dark interior, counter with wares, striped awning and a sign on an iron bracket. */
function shopFront(onFace: FaceFn, b: Builder, point: PointFn, h: HouseSpec, u: number, width: number, floorY: number, rand: () => number): void {
  const shop = h.shop!;
  onFace(0, 'plain', u, 0.1, width, 2.15, 0.06, 0x2b2119, 0.01);
  onFace(0, 'wood', u, 2.25, width + 0.4, 0.22, 0.22, BEAM, 0.04);
  for (const side of [-1, 1]) onFace(0, 'wood', u + side * (width / 2 + 0.1), 0, 0.22, 2.3, 0.22, BEAM, 0.04);
  onFace(0, 'wood', u, 0, width, 0.95, 0.5, 0x8a6a48, 0.3);
  onFace(0, 'wood', u, 0.95, width + 0.1, 0.06, 0.6, 0x6d5238, 0.3);
  b.detail(() => {
    // Wares on the counter: crates of produce, loaves, cloth.
    const n = Math.max(2, Math.floor(width / 0.55));
    for (let i = 0; i < n; i++) {
      const color = shop.goods[i % shop.goods.length];
      const gu = u - width / 2 + 0.3 + (width - 0.6) * i / Math.max(1, n - 1);
      onFace(0, 'wood', gu, 1.01, 0.42, 0.12, 0.34, 0x9a7650, 0.33);
      onFace(0, 'plain', gu, 1.13, 0.34, 0.09 + rand() * 0.06, 0.26, color, 0.34);
    }
  });
  // Awning: a sloped cloth on two iron rods, striped.
  const [ax, az] = point(0, u, 2.5, 0.75);
  const stripes = Math.max(3, Math.round((width + 0.6) / 0.42));
  for (let i = 0; i < stripes; i++) {
    const su = -(width + 0.6) / 2 + (i + 0.5) * (width + 0.6) / stripes;
    const m = new THREE.Matrix4().multiplyMatrices(place(ax, floorY + 2.42, az, h.rot), new THREE.Matrix4().makeRotationX(0.42).setPosition(su, 0, 0));
    b.slab('cloth', (width + 0.6) / stripes + 0.01, 0.04, 1.6, m, i % 2 ? shop.stripe : shop.awning);
  }
  // Scalloped valance along the front edge.
  const [vx, vz] = point(0, u, 2.0, 1.47);
  b.box('cloth', vx, floorY + 1.98, vz, width + 0.6, 0.22, 0.03, h.rot, shop.awning, 0);
  // Hanging sign beside the door side of the shop.
  const signU = u + (u > 0 ? -1 : 1) * (width / 2 + 0.55);
  onFace(0, 'wood', signU, 3.05, 0.06, 0.06, 0.95, 0x2e2a28, 0.47);
  onFace(0, 'wood', signU, 2.5, 0.62, 0.5, 0.05, shop.sign, 0.85);
  onFace(0, 'plain', signU, 2.62, 0.3, 0.26, 0.07, 0xe8c76a, 0.85);
}

/** A row of round arches across the ground floor, carrying the storeys above. */
function arcadeFront(b: Builder, at: (lx: number, lz: number) => [number, number], h: HouseSpec, floorY: number): void {
  const n = Math.max(2, Math.round(h.w / 3));
  const bay = h.w / n, depth = 1.35;
  const shape = archedProfile(-h.w / 2, h.w / 2, floorY - 0.35, () => floorY + 3.4,
    Array.from({ length: n }, (_, i) => ({ x: -h.w / 2 + (i + 0.5) * bay, w: bay - 0.75, crown: floorY + 2.85 })));
  const [x, z] = at(0, h.d / 2 + depth - 0.25);
  b.shape('stone', shape, 0.5, place(x, 0, z, h.rot), 0xe6dccb);
  const [rx, rz] = at(0, h.d / 2 + depth / 2);
  b.box('stone', rx, floorY + 3.4, rz, h.w, 0.3, depth + 0.2, h.rot, 0xe6dccb, 0);
  // Overhead only: people walk under it.
  addBox(rx, rz, h.w / 2, depth / 2 + 0.1, h.rot, floorY + 3.7, floorY + 3.3);
  for (let i = 0; i <= n; i++) {
    const [px, pz] = at(-h.w / 2 + i * bay, h.d / 2 + depth - 0.25);
    addBox(px, pz, 0.38, 0.27, h.rot, floorY + 3.4);
  }
}

/** Timber balcony on the first floor with a rail and pots of flowers. */
function balcony(onFace: FaceFn, u: number, h: HouseSpec, rand: () => number): void {
  const v = FLOOR;
  onFace(0, 'plain', u, v + 0.1, 0.95, 2.0, 0.08, GLASS, 0.01);
  onFace(0, 'wood', u, v + 0.1, 0.07, 2.0, 0.12, 0xe9e2d2, 0.015);
  onFace(0, 'wood', u, v - 0.12, 2.6, 0.14, 1.05, 0x6d5238, 0.52);
  for (let k = 0; k < 7; k++) onFace(0, 'wood', u - 1.2 + k * 0.4, v + 0.02, 0.06, 0.9, 0.06, 0x5b4332, 1.0);
  onFace(0, 'wood', u, v + 0.92, 2.6, 0.08, 0.1, 0x5b4332, 1.0);
  for (const side of [-1, 1]) onFace(0, 'wood', u + side * 1.25, v + 0.02, 0.06, 0.9, 1.0, 0x5b4332, 0.55);
  for (let k = 0; k < 3; k++) {
    const pu = u - 0.9 + k * 0.9;
    onFace(0, 'plain', pu, v + 0.02, 0.28, 0.24, 0.28, 0xb5653d, 0.82);
    onFace(0, 'plain', pu, v + 0.26, 0.34, 0.26, 0.34, rand() < 0.5 ? 0x4f8a3d : 0x5d9a48, 0.82);
    onFace(0, 'plain', pu, v + 0.44, 0.2, 0.12, 0.2, [0xe35b6a, 0xf2c94c, 0xf08fb0, 0xb48ad8, 0xffffff][Math.floor(rand() * 5)], 0.82);
  }
  void h;
}

/** Window box of flowers under a sill. */
function windowBox(onFace: FaceFn, face: number, u: number, v: number, rand: () => number): void {
  onFace(face, 'wood', u, v - 0.42, 0.95, 0.2, 0.26, 0x7a5a3c, 0.14);
  onFace(face, 'plain', u, v - 0.24, 0.88, 0.2, 0.24, 0x4f9a45, 0.15);
  const palette = [0xe35b6a, 0xf2c94c, 0xf08fb0, 0xb48ad8, 0xfff6ea];
  for (let k = 0; k < 4; k++) onFace(face, 'plain', u - 0.33 + k * 0.22, v - 0.08 + rand() * 0.05, 0.15, 0.11, 0.15, palette[Math.floor(rand() * palette.length)], 0.16 + rand() * 0.06);
}

/** Gabled windows in the front slope of the roof. */
function dormers(b: Builder, at: (lx: number, lz: number) => [number, number], h: HouseSpec, eave: number, roofH: number, dd: number, jut: number, rand: () => number): void {
  const n = Math.min(h.dormers!, Math.max(1, Math.floor(h.w / 3)));
  for (let i = 0; i < n; i++) {
    const u = -h.w / 2 + (i + 0.5) * h.w / n;
    // Front face of the dormer a third of the way up the slope.
    const lz = jut / 2 + dd / 2 - dd * 0.17;
    const base = eave + roofH * 0.3;
    const [x, z] = at(u, lz - 0.7);
    b.box('plaster', x, base - 0.4, z, 1.3, 1.85, 1.4, h.rot, h.wall, 0.05);
    b.prism('plaster', x, base + 1.45, z, 1.3, 1.4, 0.75, h.rot + Math.PI / 2, h.wall);
    b.roof(x, base + 1.45, z, 1.3, 1.4, 0.75, h.rot, h.roof, 0.18);
    const [gx, gz] = at(u, lz + 0.01);
    b.box('plain', gx, base, gz, 0.7, 0.95, 0.06, h.rot, GLASS, 0);
    b.detail(() => {
      const [fx, fz] = at(u, lz + 0.04);
      b.windowSurround(fx, base - 0.08, fz, 0.9, 1.12, 0.09, 0.12, h.rot, 0xe9e2d2);
    });
    void rand;
  }
}

/** Climbing plants: leafy clumps up a wall, sometimes in flower (wisteria, roses). */
function vines(b: Builder, point: PointFn, h: HouseSpec, wallH: number, floorY: number, rand: () => number): void {
  const face = rand() < 0.6 ? 0 : rand() < 0.5 ? 1 : 3;
  const fw = face % 2 === 0 ? h.w : h.d;
  const u0 = (rand() < 0.5 ? -1 : 1) * (fw / 2 - 0.6 - rand() * 0.6);
  const top = wallH * (0.55 + rand() * 0.4);
  const leaf = [0x4a7a34, 0x5b8a3c, 0x3f6e30, 0x6a9a44];
  const geo = new THREE.IcosahedronGeometry(1, 0);
  for (let k = 0; k < 26; k++) {
    const v = Math.pow(rand(), 0.8) * top;
    // Spreads wider as it climbs, and trails along under the eaves.
    const spread = 0.3 + v / top * 1.6;
    const u = u0 + (rand() - 0.5) * spread * 2;
    if (Math.abs(u) > fw / 2 - 0.1) continue;
    const r = 0.22 + rand() * 0.24;
    const [x, z] = point(face, u, v, r * 0.45);
    const flower = h.vines && rand() < 0.4;
    b.add('plain', geo.clone().scale(r, r * 0.9, r * 0.6), flower ? h.vines! : leaf[k % leaf.length], place(x, floorY + v, z, h.rot + face * Math.PI / 2), 0.2);
  }
}
