import * as THREE from 'three';
import { Builder, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import { CITY_SQUARES, CITY_STREETS, squareDistance, type CitySquare } from '../layout';
import { nearestStreet, squareLevel, streetProfiles } from '../city-plan';
import type { HouseSpec } from './house';

const IRON = 0x2e2a28;
const LIMESTONE = 0xeee4d0;
const WOOD = 0x8a6a48;
const DARK_WOOD = 0x6a4c34;
const AWNINGS = [0xc9482f, 0x3f6f9a, 0x4f8a5a, 0xe0b040, 0xa8456a, 0xd9773a];
const PRODUCE = [0xd9452f, 0xe8b84a, 0x5fa34a, 0xd98a4a, 0x8a5fb0, 0xf2d27a, 0xc4883e];
const FLOWERS = [0xe35b6a, 0xf2c94c, 0xf08fb0, 0xb48ad8, 0xfff6ea, 0x8a7ad8];
const CLOTH = [0xf4efe4, 0xd8e4ee, 0xe8c0b0, 0xc7d3bb, 0xe0d0a0, 0xa8c0d8, 0xf0e0e8];

const pick = <T>(a: T[], rand: () => number): T => a[Math.floor(rand() * a.length)];

/** A point on a square in its own frame: u along its long side, v across. */
function onSquare(q: CitySquare, u: number, v: number): [number, number] {
  const c = Math.cos(q.rot), s = Math.sin(q.rot);
  return [q.x + u * c + v * s, q.z - u * s + v * c];
}

/** Market stall: trestle counter heaped with produce under a striped awning. */
function stall(b: Builder, x: number, y: number, z: number, rot: number, rand: () => number): void {
  const at = (lx: number, lz: number): [number, number] => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)];
  b.box('wood', x, y, z, 2.8, 0.88, 1.2, rot, WOOD, 0.15);
  b.box('wood', x, y + 0.88, z, 2.95, 0.06, 1.32, rot, DARK_WOOD, 0);
  for (const [lx, lz] of [[-1.4, -0.65], [1.4, -0.65], [-1.4, 0.65], [1.4, 0.65]]) {
    const [px, pz] = at(lx, lz);
    b.box('wood', px, y, pz, 0.09, lz < 0 ? 2.55 : 2.15, 0.09, rot, DARK_WOOD, 0);
  }
  const awning = pick(AWNINGS, rand), world = place(x, y, z, rot);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Matrix4().multiplyMatrices(world, new THREE.Matrix4().makeRotationX(0.2).setPosition(-1.5 + (i + 0.5) * 3 / 7, 2.38, 0));
    b.slab('cloth', 3 / 7 + 0.005, 0.04, 1.75, m, i % 2 ? 0xf4ecda : awning);
  }
  b.box('cloth', ...([at(0, 0.88)[0], y + 2.02, at(0, 0.88)[1]] as [number, number, number]), 3.05, 0.2, 0.03, rot, awning, 0);
  // Heaped produce in shallow crates on the counter, and a few crates and sacks beside it.
  b.detail(() => {
    for (let i = 0; i < 5; i++) {
      const [gx, gz] = at(-1.1 + i * 0.55, -0.1);
      b.box('wood', gx, y + 0.94, gz, 0.48, 0.1, 0.62, rot, 0x9a7650, 0);
      const color = pick(PRODUCE, rand);
      for (let k = 0; k < 6; k++) {
        const [fx, fz] = at(-1.1 + i * 0.55 + (k % 3 - 1) * 0.14, -0.1 + (Math.floor(k / 3) - 0.5) * 0.22);
        b.add('plain', new THREE.SphereGeometry(0.075 + rand() * 0.03, 6, 4), color, place(fx, y + 1.06 + rand() * 0.04, fz), 0.25);
      }
    }
    const [cx, cz] = at(1.9, 0.2);
    b.box('wood', cx, y, cz, 0.6, 0.45, 0.45, rot + 0.3, 0x9a7650, 0.2);
    b.box('wood', cx + 0.05, y + 0.45, cz - 0.05, 0.55, 0.4, 0.42, rot - 0.2, 0xa8845a, 0.2);
    const [sx, sz] = at(-1.9, 0.3);
    b.add('cloth', new THREE.SphereGeometry(0.3, 8, 6).scale(1, 1.25, 0.9), 0xd8c8a0, place(sx, y + 0.34, sz, rot), 0.3);
  });
  addBox(x, z, 1.4, 0.62, rot, y + 0.94);
}

function barrel(b: Builder, x: number, y: number, z: number, rand: () => number): void {
  b.cyl('wood', x, y, z, 0.32, 0.3, 0.86, rand() < 0.5 ? 0x7a5a3c : 0x8a6a48, 10, 0.2);
  b.detail(() => {
    for (const h of [0.14, 0.7]) b.cyl('plain', x, y + h, z, 0.335, 0.335, 0.05, 0x3a3430, 10, 0);
  });
  addRound(x, z, 0.34, y + 0.86);
}

function crates(b: Builder, x: number, y: number, z: number, rot: number, rand: () => number): void {
  b.box('wood', x, y, z, 0.7, 0.55, 0.55, rot, 0x9a7650, 0.2);
  if (rand() < 0.6) b.box('wood', x + 0.1, y + 0.55, z, 0.6, 0.48, 0.5, rot + 0.25, 0xa8845a, 0.2);
  addBox(x, z, 0.38, 0.3, rot, y + 0.55);
}

/** Iron lantern post on a stone foot. */
function lamp(b: Builder, x: number, y: number, z: number): void {
  b.cyl('stone', x, y, z, 0.22, 0.28, 0.45, LIMESTONE, 8, 0.15);
  b.cyl('wood', x, y + 0.45, z, 0.055, 0.08, 3.1, IRON, 8, 0);
  b.box('plain', x, y + 3.5, z, 0.3, 0.42, 0.3, 0, 0xffd98a, 0);
  b.detail(() => {
    for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) b.box('wood', x + dx, y + 3.48, z + dz, 0.04, 0.46, 0.04, 0, IRON, 0);
    b.cyl('wood', x, y + 3.55, z, 0.31, 0.24, 0.2, IRON, 4, 0);
    b.cone('wood', x, y + 4.12, z, 0.27, 0.32, IRON, 4, Math.PI / 4);
  });
  b.cone('wood', x, y + 3.92, z, 0.25, 0.2, IRON, 4, Math.PI / 4);
  addRound(x, z, 0.25, y + 3.5);
}

function bench(b: Builder, x: number, y: number, z: number, rot: number): void {
  const at = (lx: number, lz: number): [number, number] => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)];
  for (const side of [-0.8, 0.8]) { const [px, pz] = at(side, 0); b.box('stone', px, y, pz, 0.22, 0.42, 0.5, rot, LIMESTONE, 0.1); }
  b.box('wood', x, y + 0.42, z, 1.9, 0.08, 0.5, rot, WOOD, 0);
  const [bx, bz] = at(0, -0.24);
  b.box('wood', bx, y + 0.5, bz, 1.9, 0.42, 0.06, rot, WOOD, 0);
  addBox(x, z, 0.95, 0.27, rot, y + 0.5);
}

/** Round stone planter with a clipped shrub and flowers spilling over its rim. */
function planter(b: Builder, x: number, y: number, z: number, rand: () => number): void {
  b.cyl('stone', x, y, z, 0.62, 0.48, 0.62, LIMESTONE, 12, 0.15);
  b.add('plain', new THREE.IcosahedronGeometry(0.55, 1).scale(1, 1.25, 1), 0x4f7f3a, place(x, y + 1.15, z), 0.3);
  b.detail(() => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rand();
      b.add('plain', new THREE.IcosahedronGeometry(0.13, 0), pick(FLOWERS, rand), place(x + Math.cos(a) * 0.55, y + 0.62, z + Math.sin(a) * 0.55), 0.1);
    }
  });
  addRound(x, z, 0.62, y + 0.62);
}

/** Stone well with a timber gallows and a bucket. */
function well(b: Builder, x: number, y: number, z: number, rot: number): void {
  b.cyl('stone', x, y - 0.2, z, 1.25, 1.35, 1.05, LIMESTONE, 16, 0.2);
  b.cyl('plain', x, y + 0.75, z, 1.0, 1.0, 0.05, 0x2f4f5f, 14, 0);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const side of [-1, 1]) b.box('wood', x + side * 1.1 * c, y + 0.8, z - side * 1.1 * s, 0.16, 1.9, 0.16, rot, DARK_WOOD, 0);
  b.box('wood', x, y + 2.6, z, 2.5, 0.14, 0.14, rot, DARK_WOOD, 0);
  b.roof(x, y + 2.7, z, 1.2, 2.9, 0.75, rot + Math.PI / 2, 0xb85e3e, 0.25);
  b.cyl('wood', x, y + 1.45, z, 0.18, 0.15, 0.32, 0x7a5a3c, 8, 0.1);
  b.cyl('plain', x, y + 1.77, z, 0.012, 0.012, 0.85, 0x6a5a48, 4, 0);
  addRound(x, z, 1.35, y + 0.85);
}

/** Robed figure on a pedestal, one arm raised. */
function statue(b: Builder, x: number, y: number, z: number, rot: number): void {
  b.box('stone', x, y, z, 2.2, 0.5, 2.2, rot, LIMESTONE, 0.1);
  b.box('stone', x, y + 0.5, z, 1.5, 2.1, 1.5, rot, 0xf2eadb, 0.1);
  b.box('stone', x, y + 2.6, z, 1.8, 0.3, 1.8, rot, LIMESTONE, 0);
  const top = y + 2.9;
  b.cyl('stone', x, top, z, 0.32, 0.55, 1.7, 0xf6f0e4, 12, 0.1);
  b.cyl('stone', x, top + 1.7, z, 0.27, 0.32, 0.6, 0xf6f0e4, 12, 0);
  b.add('stone', new THREE.SphereGeometry(0.2, 12, 10), 0xf6f0e4, place(x, top + 2.5, z));
  const arm = new THREE.Matrix4().multiplyMatrices(place(x, top, z, rot), new THREE.Matrix4().makeRotationZ(-0.5).setPosition(0.38, 2.4, 0));
  b.slab('stone', 0.14, 0.75, 0.14, arm, 0xf6f0e4);
  const staff = new THREE.Matrix4().multiplyMatrices(place(x, top, z, rot), new THREE.Matrix4().makeRotationZ(-0.08).setPosition(-0.42, 1.4, 0.1));
  b.slab('stone', 0.07, 2.9, 0.07, staff, 0xf6f0e4);
  addBox(x, z, 1.1, 1.1, rot, y + 2.9);
}

/** Tall pole with a long heraldic banner (blue with a gold device). */
function bannerPole(b: Builder, x: number, y: number, z: number, rot: number, color: number): void {
  b.cyl('stone', x, y, z, 0.3, 0.38, 0.5, LIMESTONE, 8, 0.1);
  b.cyl('wood', x, y + 0.5, z, 0.06, 0.07, 7.5, IRON, 6, 0);
  const at = (lx: number): [number, number] => [x + lx * Math.cos(rot), z - lx * Math.sin(rot)];
  const [cx, cz] = at(0.55);
  b.box('wood', cx, y + 7.6, cz, 1.2, 0.06, 0.06, rot, IRON, 0);
  b.box('cloth', cx, y + 4.4, cz, 0.95, 3.2, 0.03, rot, color, 0);
  b.box('cloth', cx, y + 5.6, cz, 0.36, 0.5, 0.05, rot, 0xe0b84a, 0);
  b.box('cloth', cx, y + 4.2, cz, 0.95, 0.12, 0.04, rot, 0xe0b84a, 0);
  addRound(x, z, 0.38, y + 0.5);
}

/** A sagging line between two points with cloth hanging off it: bunting or washing. */
function line(b: Builder, a: THREE.Vector3, c: THREE.Vector3, sag: number, items: number, item: (p: THREE.Vector3, k: number, theta: number) => void): void {
  const n = 16, pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3().lerpVectors(a, c, t).setY(a.y + (c.y - a.y) * t - sag * 4 * t * (1 - t)));
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
    const m = new THREE.Matrix4().lookAt(p, q, new THREE.Vector3(0, 1, 0)).setPosition(new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5));
    b.slab('wood', 0.025, 0.025, len, m, 0x4a4038);
  }
  const theta = Math.atan2(-(c.z - a.z), c.x - a.x);
  for (let k = 0; k < items; k++) {
    const t = (k + 0.5) / items;
    item(new THREE.Vector3().lerpVectors(a, c, t).setY(a.y + (c.y - a.y) * t - sag * 4 * t * (1 - t)), k, theta);
  }
}

function makeHouseTest(plots: HouseSpec[]): (x: number, z: number, pad: number) => boolean {
  const grid = new Map<string, HouseSpec[]>();
  for (const h of plots) {
    const k = `${Math.floor(h.x / 16)},${Math.floor(h.z / 16)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(h);
  }
  return (x, z, pad) => {
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const h of grid.get(`${i},${j}`) ?? []) {
      const dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
      if (Math.abs(dx * c - dz * s) < h.w / 2 + pad && Math.abs(dx * s + dz * c) < h.d / 2 + pad) return true;
    }
    return false;
  };
}

/**
 * Street life that stands still: market stalls, wells and statues on the squares,
 * lanterns, benches and planters, bunting across the avenue and washing across
 * the lanes. Placed after the houses so lines can be strung between facades.
 */
export function buildCityProps(b: Builder, plots: HouseSpec[], rand: () => number): void {
  const inHouse = makeHouseTest(plots);
  // Square furniture keeps out of the way of every street crossing the square.
  const inWay = (x: number, z: number): boolean => { const s = nearestStreet(x, z); return !!s && s.d < s.half + 1; };
  for (const q of CITY_SQUARES) {
    const y = squareLevel.get(q)! + 0.04;
    const small = Math.min(q.rx, q.rz);
    // Lanterns and benches round the edge, planters at the corners.
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const [lx, lz] = onSquare(q, u * (q.rx - 2.2), v * (q.rz - 2.2));
      if (squareDistance(q, lx, lz) < -0.8 && !inWay(lx, lz)) lamp(b, lx, y, lz);
      const [px, pz] = onSquare(q, u * (q.rx - 4.2), v * (q.rz - 2.4));
      if (q.kind !== 'well' && squareDistance(q, px, pz) < -1 && !inWay(px, pz)) planter(b, px, y, pz, rand);
    }
    if (q.kind === 'well') {
      well(b, q.x, y, q.z, q.rot);
      const [bx, bz] = onSquare(q, 0, q.rz - 2);
      if (!inWay(bx, bz)) bench(b, bx, y, bz, q.rot + Math.PI);
      for (let k = 0; k < 3; k++) { const [x, z] = onSquare(q, q.rx - 2.5 - k * 0.8, -q.rz + 2.2); if (!inWay(x, z)) barrel(b, x, y, z, rand); }
    }
    if (q.kind === 'market') {
      // Two rows of stalls along the long sides, leaving the middle and the fountain clear.
      for (const v of [-1, 1]) for (let u = -q.rx + 6; u <= q.rx - 6; u += 4.6) {
        if (Math.abs(u) < 7) continue;
        const [x, z] = onSquare(q, u, v * (small * 0.55));
        stall(b, x, y, z, q.rot + (v > 0 ? Math.PI : 0), rand);
      }
      for (let k = 0; k < 6; k++) {
        const [x, z] = onSquare(q, (rand() - 0.5) * q.rx * 1.6, (rand() < 0.5 ? -1 : 1) * small * 0.82);
        if (inWay(x, z)) continue;
        if (rand() < 0.5) barrel(b, x, y, z, rand); else crates(b, x, y, z, rand() * 3, rand);
      }
    }
    if (q.kind === 'forecourt') {
      const [sx, sz] = onSquare(q, 0, 0);
      statue(b, sx, y, sz, q.rot + Math.PI / 2);
      for (const u of [-1, 1]) for (const v of [-1, 1]) {
        const [x, z] = onSquare(q, u * (q.rx - 5), v * (q.rz - 4));
        bannerPole(b, x, y, z, q.rot, 0x3d5a9a);
      }
    }
    if (q.kind === 'cathedral') {
      for (const u of [-1, 1]) {
        const [x, z] = onSquare(q, u * q.rx * 0.45, 0);
        if (!inWay(x, z)) bench(b, x, y, z, q.rot + Math.PI / 2 * u);
      }
    }
    for (let k = 0; k < (q.kind === 'well' ? 1 : 3); k++) {
      const [x, z] = onSquare(q, (rand() - 0.5) * q.rx, (rand() < 0.5 ? -1 : 1) * (q.rz - 1.6));
      if (squareDistance(q, x, z) < -0.6 && !inWay(x, z)) bench(b, x, y, z, Math.atan2(q.x - x, q.z - z));
    }
  }

  // Lanterns up the avenue and the high street, alternating sides; bunting across the avenue;
  // washing strung over the narrow lanes, wherever houses face each other.
  for (const road of CITY_STREETS) {
    const prof = streetProfiles.get(road)!;
    let since = 0, sinceLine = 0;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], c = road.pts[i + 1], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      since += len; sinceLine += len;
      if (len < 1e-3) continue;
      const nx = -(c[1] - a[1]) / len, nz = (c[0] - a[0]) / len, half = road.widths[i] / 2, y = prof[i];
      if (CITY_SQUARES.some((q) => squareDistance(q, a[0], a[1]) < 3)) continue;
      const lit = road.id === 'avenue' || road.id === 'high-street' || road.id === 'east-street';
      if (lit && since > 26) {
        since = 0;
        const side = i % 2 ? 1 : -1;
        const lx = a[0] + nx * (half - 0.45) * side, lz = a[1] + nz * (half - 0.45) * side;
        // Not where another street crosses.
        const other = nearestStreet(lx, lz, (r) => r !== road);
        if (!other || other.d > other.half + 1) lamp(b, lx, y + 0.04, lz);
      }
      const both = inHouse(a[0] + nx * (half + 1.2), a[1] + nz * (half + 1.2), 0) && inHouse(a[0] - nx * (half + 1.2), a[1] - nz * (half + 1.2), 0);
      if (!both) continue;
      if (road.id === 'avenue' && sinceLine > 30) {
        sinceLine = 0;
        const h = y + 6.4;
        line(b, new THREE.Vector3(a[0] + nx * (half + 0.5), h, a[1] + nz * (half + 0.5)), new THREE.Vector3(a[0] - nx * (half + 0.5), h, a[1] - nz * (half + 0.5)), 0.7,
          Math.round(half * 2 / 0.55), (p, k, theta) => {
            const tri = new THREE.BufferGeometry();
            tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, -0.42, 0], 3));
            b.add('cloth', tri, AWNINGS[k % AWNINGS.length], place(p.x, p.y, p.z, theta));
          });
      } else if ((road.stairs || road.width < 4.5) && sinceLine > 14 && rand() < 0.5) {
        sinceLine = 0;
        const h = y + 4.6 + rand() * 1.2;
        line(b, new THREE.Vector3(a[0] + nx * (half + 0.4), h, a[1] + nz * (half + 0.4)), new THREE.Vector3(a[0] - nx * (half + 0.4), h - 0.3, a[1] - nz * (half + 0.4)), 0.35,
          3 + Math.floor(rand() * 4), (p, _k, theta) => {
            const w = 0.45 + rand() * 0.5, hh = 0.5 + rand() * 0.5;
            b.add('cloth', new THREE.PlaneGeometry(w, hh).translate(0, -hh / 2, 0), pick(CLOTH, rand), place(p.x, p.y, p.z, theta));
          });
      }
    }
  }
  void orbAt;
}
