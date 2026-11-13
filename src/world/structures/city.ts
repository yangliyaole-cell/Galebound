import * as THREE from 'three';
import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { CITY, EAST_GATE_ANGLE, SOUTH_GATE_ANGLE, WALL_SEGMENTS } from '../layout';
import { cobbleAt } from '../maps';
import { seededRandom } from '../noise';
import { wallRing, wrapStairs } from './common';
import { ROOFS, SHUTTERS, SLATES, WALLS, addHouse } from './house';
import { stall } from './village';

const STONE = 0xdad3c3;
const PALE = 0xe6e0d1;
const SLATE = 0x66799a;
const BANNER = 0xc8452f;

const pick = <T>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

interface Line {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

function distToLine(x: number, z: number, l: Line): number {
  const dx = l.bx - l.ax;
  const dz = l.bz - l.az;
  const t = Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(l.ax + dx * t - x, l.az + dz * t - z);
}

/** Arches carrying water from the eastern highland into the city. */
function aqueduct(b: Builder): Line {
  const start = { x: 506, z: -612 };
  const level = heightAt(start.x, start.z) + 0.4;
  let dx = CITY.x - start.x;
  let dz = CITY.z - start.z;
  const dl = Math.hypot(dx, dz);
  dx /= dl;
  dz /= dl;
  // Follow the line until the city hill rises to meet the channel.
  let length = 0;
  let left = false;
  for (let t = 4; t < dl; t += 2) {
    const h = heightAt(start.x + dx * t, start.z + dz * t);
    if (h < level - 3) left = true;
    if (left && h >= level - 0.6) {
      length = t;
      break;
    }
  }
  const bays = Math.max(1, Math.round(length / 13));
  const bay = length / bays;
  const theta = Math.atan2(-dz, dx);
  const width = 3.4;
  for (let i = 0; i < bays; i++) {
    const t = (i + 0.5) * bay;
    const mx = start.x + dx * t;
    const mz = start.z + dz * t;
    let ground = Infinity;
    for (let k = 0; k <= 4; k++) ground = Math.min(ground, heightAt(start.x + dx * (i + k / 4) * bay, start.z + dz * (i + k / 4) * bay));
    const base = ground - 2.5;
    const shape = archedProfile(
      -bay / 2, bay / 2, base, () => level,
      level - ground > 7 ? [{ x: 0, w: bay - 3.4, crown: level - 2.2 }] : [],
    );
    b.shape('stone', shape, width, place(mx, 0, mz, theta), i % 2 ? STONE : PALE);
    // Piers stop anyone walking through the masonry.
    const px = start.x + dx * i * bay;
    const pz = start.z + dz * i * bay;
    addBox(px, pz, 1.7, width / 2, theta, level - 2.2);
  }
  const mx = start.x + (dx * length) / 2;
  const mz = start.z + (dz * length) / 2;
  // Water channel between two kerbs.
  b.box('plain', mx, level, mz, length, 0.06, 1.1, theta, 0x4f9fd0, 0);
  for (const side of [1, -1]) {
    b.box('stone', mx + Math.sin(theta) * 1.5 * side, level, mz + Math.cos(theta) * 1.5 * side, length, 0.32, 0.4, theta, PALE, 0);
  }
  addBox(mx, mz, length / 2, width / 2, theta, level, level - 2.2);

  // It ends in a cistern on the hillside.
  const ex = start.x + dx * (length + 4.5);
  const ez = start.z + dz * (length + 4.5);
  b.cyl('stone', ex, heightAt(ex, ez) - 4, ez, 5.4, 5.8, level - heightAt(ex, ez) + 4.3, STONE, 16, 0.15);
  b.cyl('plain', ex, level + 0.2, ez, 4.6, 4.6, 0.12, 0x4f9fd0, 16, 0);
  addRound(ex, ez, 5.4, level + 0.3);
  // And begins at a spring house on the plateau.
  b.box('stone', start.x - dx * 3, heightAt(start.x, start.z) - 2, start.z - dz * 3, 5, 5.6, 5, theta, STONE, 0.15);
  b.pyramid('roof', start.x - dx * 3, heightAt(start.x, start.z) + 3.6, start.z - dz * 3, 6, 6, 2.4, theta, SLATE);
  addBox(start.x - dx * 3, start.z - dz * 3, 2.5, 2.5, theta, heightAt(start.x, start.z) + 3.6);

  orbAt('aqueduct-mid', mx, mz, 1.3);
  orbAt('aqueduct-quarter', start.x + dx * length * 0.22, start.z + dz * length * 0.22, 1.3);
  orbAt('cistern', ex, ez, 1.2);
  return { ax: start.x, az: start.z, bx: ex, bz: ez };
}

function castle(b: Builder, flags: FlagSpot[], rand: () => number): void {
  const { x, z } = CITY;
  const y = heightAt(x, z);
  const ring = wallRing(b, {
    x, z, radius: 31, segments: 8, phase: Math.PI / 8, height: 7, thickness: 2.6, towerRadius: 3.2,
    gates: [{ angle: Math.PI, width: 5, height: 6.2 }], roof: SLATE, color: PALE, stairs: [1],
  });
  for (const t of ring.towers) flags.push({ x: t.x, y: t.top + 9.5, z: t.z, color: BANNER, size: 0.9 });
  for (const t of ring.towers) b.cyl('wood', t.x, t.top + 7.8, t.z, 0.06, 0.06, 2.4, 0x4a4038, 5, 0);

  // The keep: a square tower with a terrace, climbed by stairs on three sides.
  const half = 7.5;
  const terrace = y + 24;
  b.box('stone', x, y - 3, z, half * 2, 27, half * 2, 0, PALE, 0.14);
  addBox(x, z, half, half, 0, terrace);
  for (let side = 0; side < 4; side++) {
    for (let k = -3; k <= 3; k++) {
      const u = k * 2.1;
      const [mx, mz] = side === 0 ? [u, half - 0.3] : side === 1 ? [half - 0.3, u] : side === 2 ? [u, -half + 0.3] : [-half + 0.3, u];
      // Leave gaps where the stairs arrive.
      if (side === 2 && k < -1) continue;
      b.box('stone', x + mx, terrace, z + mz, side % 2 ? 0.6 : 1.1, 1.1, side % 2 ? 1.1 : 0.6, 0, PALE, 0);
    }
    for (const h of [6, 12, 18]) {
      const [wx, wz] = side === 0 ? [0, half + 0.02] : side === 1 ? [half + 0.02, 0] : side === 2 ? [0, -half - 0.02] : [-half - 0.02, 0];
      for (const off of [-3, 3]) {
        const ox = side % 2 ? 0 : off;
        const oz = side % 2 ? off : 0;
        b.box('plain', x + wx + ox, y + h, z + wz + oz, side % 2 ? 0.12 : 0.9, 1.8, side % 2 ? 0.9 : 0.12, 0, 0x34526d, 0);
      }
    }
  }
  wrapStairs(b, x, z, half, 0, y, terrace, 3, 1.9, STONE);

  // A tall round tower on the corner the stairs leave free.
  const tx = x - half;
  const tz = z + half;
  b.cyl('stone', tx, y - 3, tz, 3.2, 3.5, 37, PALE, 16, 0.12);
  b.cyl('stone', tx, y + 33.5, tz, 3.7, 3.2, 0.9, PALE, 16, 0);
  b.cone('roof', tx, y + 34.4, tz, 4.3, 9.5, SLATE, 16);
  addRound(tx, tz, 3.4, y + 34.4);
  flags.push({ x: tx, y: y + 45.6, z: tz, color: BANNER, size: 1.2 });
  b.cyl('wood', tx, y + 43.6, tz, 0.07, 0.07, 3, 0x4a4038, 5, 0);

  // The great spire on the terrace.
  b.cyl('stone', x, terrace, z, 4.0, 4.3, 15, PALE, 16, 0.1);
  b.cyl('stone', x, terrace + 14.4, z, 4.6, 4.0, 1.0, PALE, 16, 0);
  b.cone('roof', x, terrace + 15.4, z, 5.3, 15, SLATE, 16);
  addRound(x, z, 4.3, terrace + 15.4);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.box('plain', x + Math.sin(a) * 4.12, terrace + 8, z + Math.cos(a) * 4.12, 0.8, 2.2, 0.14, a, 0x34526d, 0);
  }
  flags.push({ x, y: terrace + 33, z, color: BANNER, size: 1.6 });
  b.cyl('wood', x, terrace + 30, z, 0.09, 0.09, 4.2, 0x4a4038, 5, 0);
  orbAt('keep-terrace', x + 5.6, z - 5.6, 1.2);
  orbAt('keep-air', x + 14, z + 30, 22);

  // The great hall along the north wall.
  const hall = addHouse(b, {
    x: x + 3, z: z - 19.5, rot: 0, w: 22, d: 8, floors: 2, roof: SLATE, wall: 0xefe8d8,
    timber: false, ridgeAlongFront: true, shutters: 0x6a4a3a, chimney: true, simple: 1,
  }, rand);
  orbAt('hall-roof', hall.spec.x, hall.spec.z, 1.2);
  addHouse(b, {
    x: x + 19, z: z + 9, rot: -Math.PI / 2, w: 8, d: 6, floors: 1, roof: SLATE, wall: 0xefe8d8,
    timber: true, ridgeAlongFront: true, shutters: 0x6a4a3a, chimney: false, simple: 1,
  }, rand);
  orbAt('castle-wall', ring.towers[5].x, ring.towers[5].z, 1.3);
}

function cathedral(b: Builder, x: number, z: number, rot: number, flags: FlagSpot[]): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [lx, lz] of [[-6, -13], [6, -13], [6, 13], [-6, 13]]) {
    const h = heightAt(...at(lx, lz));
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const floor = heightAt(...at(0, 13.5)) + 0.4;
  const wallH = 13;
  b.box('stone', x, lo - 3, z, 11, floor + wallH - lo + 3, 25, rot, PALE, 0.14);
  b.prism('stone', x, floor + wallH, z, 10.9, 24.9, 7.5, rot, PALE);
  b.roof(x, floor + wallH, z, 11, 25, 7.5, rot, SLATE, 0.6);
  addBox(x, z, 5.5, 12.5, rot, (lx) => floor + wallH + Math.max(0, 1 - Math.abs(lx) / 5.5) * 7.5);
  // Buttresses and tall windows down each side.
  for (const side of [1, -1]) {
    for (let k = -2; k <= 2; k++) {
      const [bx, bz] = at(6 * side, k * 4.6);
      b.box('stone', bx, lo - 3, bz, 1.5, floor + 9 - lo + 3, 1.1, rot, STONE, 0.14);
      const [wx, wz] = at(5.55 * side, k * 4.6 + 2.3);
      if (k < 2) b.box('plain', wx, floor + 4, wz, 0.14, 6, 1.0, rot, 0x4a6fa8, 0);
    }
  }
  // West front: door, rose window.
  const [dx, dz] = at(0, 12.56);
  b.box('wood', dx, floor - 0.4, dz, 2.6, 4.4, 0.2, rot, 0x6a4c34, 0.1);
  b.add('plain', new THREE.CylinderGeometry(2, 2, 0.2, 16).rotateX(Math.PI / 2), 0x5a7fc0, place(dx, floor + 9.2, dz, rot));
  b.add('stone', new THREE.TorusGeometry(2.05, 0.22, 6, 18), PALE, place(dx, floor + 9.2, dz, rot));
  // Bell tower beside the front.
  const [tx, tz] = at(-8.6, 9);
  const towerTop = floor + 31;
  b.box('stone', tx, lo - 3, tz, 6.6, towerTop - lo + 3, 6.6, rot, PALE, 0.14);
  for (let side = 0; side < 4; side++) {
    const a = rot + (side * Math.PI) / 2;
    b.box('plain', tx + Math.sin(a) * 3.32, towerTop - 6.5, tz + Math.cos(a) * 3.32, 1.6, 4, 0.12, a, 0x2a3440, 0);
  }
  b.box('stone', tx, towerTop, tz, 7.2, 0.7, 7.2, rot, PALE, 0);
  b.pyramid('roof', tx, towerTop + 0.7, tz, 7, 7, 12, rot, SLATE);
  addBox(tx, tz, 3.3, 3.3, rot, (lx, lz) => towerTop + 0.7 + Math.max(0, 1 - Math.max(Math.abs(lx), Math.abs(lz)) / 3.3) * 12);
  b.cyl('wood', tx, towerTop + 12.5, tz, 0.07, 0.07, 3, 0x4a4038, 5, 0);
  flags.push({ x: tx, y: towerTop + 14.8, z: tz, color: 0xf2e6b8, size: 1 });
  orbAt('belltower', tx, tz, 1.6);
  void hi;
}

function fountain(b: Builder, x: number, z: number, rand: () => number): void {
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 0.8, z, 3.7, 3.9, 1.6, PALE, 16, 0.2);
  b.cyl('plain', x, y + 0.62, z, 3.3, 3.3, 0.1, 0x4f9fd0, 16, 0);
  b.cyl('stone', x, y + 0.6, z, 0.5, 0.7, 2.4, PALE, 10, 0);
  b.cyl('stone', x, y + 2.9, z, 1.5, 0.6, 0.35, PALE, 12, 0);
  b.cyl('plain', x, y + 3.2, z, 1.3, 1.3, 0.08, 0x4f9fd0, 12, 0);
  b.add('stone', new THREE.SphereGeometry(0.36, 10, 8), PALE, place(x, y + 3.75, z));
  addRound(x, z, 3.7, y + 0.8);
  addRound(x, z, 0.8, y + 3.3);
  orbAt('fountain', x, z, 1.2);
  const awnings = [0xc9482f, 0x3f7f9a, 0xe0b040];
  for (let i = 0; i < 3; i++) {
    const a = 2.3 + i * 1.1;
    const sx = x + Math.cos(a) * 10.5;
    const sz = z + Math.sin(a) * 10.5;
    stall(b, sx, sz, Math.atan2(x - sx, z - sz), awnings[i], rand);
  }
}

export interface CityInfo {
  plaza: { x: number; z: number };
  southGate: { x: number; z: number };
}

export function buildCity(detail: number): { object: THREE.Group; flags: FlagSpot[]; info: CityInfo } {
  const b = new Builder();
  const rand = seededRandom(91);
  const flags: FlagSpot[] = [];
  const { x: cx, z: cz } = CITY;
  const step = (Math.PI * 2) / WALL_SEGMENTS;

  const ring = wallRing(b, {
    x: cx, z: cz, radius: CITY.wall, segments: WALL_SEGMENTS, phase: Math.PI / 2 + step / 2,
    height: 9, thickness: 3.4, towerRadius: 4.6,
    gates: [
      { angle: SOUTH_GATE_ANGLE, width: 6.5, height: 7.6 },
      { angle: EAST_GATE_ANGLE, width: 5.6, height: 6.8 },
    ],
    roof: SLATE, color: STONE, stairs: [18, 0, 15, 5, 10],
  });
  ring.towers.forEach((t, i) => {
    if (i % 2) return;
    flags.push({ x: t.x, y: t.top + 12.6, z: t.z, color: i % 4 ? BANNER : 0x3f6f9a, size: 1 });
    b.cyl('wood', t.x, t.top + 10.6, t.z, 0.07, 0.07, 3, 0x4a4038, 5, 0);
  });
  orbAt('wall-south', ring.towers[0].x, ring.towers[0].z, 1.3);
  orbAt('wall-west', ring.towers[5].x, ring.towers[5].z, 1.3);
  orbAt('wall-north', ring.towers[10].x, ring.towers[10].z, 1.3);
  orbAt('wall-east', ring.towers[14].x, ring.towers[14].z, 1.3);

  const water = aqueduct(b);
  castle(b, flags, rand);

  const plaza = { x: cx, z: cz + 108 };
  fountain(b, plaza.x, plaza.z, rand);
  const ca = Math.PI / 2 - 0.95;
  const cathedralAt = { x: cx + Math.cos(ca) * 92, z: cz + Math.sin(ca) * 92 };
  cathedral(b, cathedralAt.x, cathedralAt.z, Math.atan2(Math.cos(ca), Math.sin(ca)), flags);

  const keepOut = [
    { x: plaza.x, z: plaza.z, r: 21 },
    { x: cathedralAt.x, z: cathedralAt.z, r: 21 },
    ...ring.gates.map((g) => ({ x: g.x, z: g.z, r: 13 })),
  ];
  const onStreet = (x: number, z: number): boolean => cobbleAt(x, z) > 0.8;

  // Houses crowd the hillside in rings, each facing down the slope.
  const spacing = detail > 0 ? 12.2 : 15.5;
  let count = 0;
  for (let r = 52; r <= 161; r += 13.5) {
    const n = Math.floor((Math.PI * 2 * r) / spacing);
    const offset = rand() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = offset + (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.03;
      const rr = r + (rand() - 0.5) * 3;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const w = 6.2 + rand() * 2.2;
      const d = 6 + rand() * 1.6;
      const floors = 2 + Math.floor(rand() * 2.3);
      const roof = rand() < 0.13 ? pick(SLATES, rand) : pick(ROOFS, rand);
      const wall = pick(WALLS, rand);
      const timber = rand() < 0.35;
      const along = rand() < 0.5;
      const shutters = pick(SHUTTERS, rand);
      const chimney = rand() < 0.6;
      const tx = -Math.sin(a) * 4;
      const tz = Math.cos(a) * 4;
      const ox = Math.cos(a) * 4;
      const oz = Math.sin(a) * 4;
      if (onStreet(x, z) || onStreet(x + tx, z + tz) || onStreet(x - tx, z - tz) || onStreet(x + ox, z + oz) || onStreet(x - ox, z - oz)) continue;
      if (keepOut.some((q) => Math.hypot(q.x - x, q.z - z) < q.r)) continue;
      if (distToLine(x, z, water) < 8) continue;
      addHouse(b, {
        x, z, w, d, floors, roof, wall, timber, shutters, chimney,
        rot: Math.atan2(Math.cos(a), Math.sin(a)),
        ridgeAlongFront: along,
        simple: detail > 1 ? 1 : 2,
      }, rand);
      count++;
      if (count % 37 === 5) orbAt(`city-roof-${count}`, x, z, 1.2);
    }
  }

  // Lamps along the avenue from the south gate.
  for (let k = 0; k < 6; k++) {
    for (const side of [1, -1]) {
      const lx = cx + 4.2 * side;
      const lz = cz + CITY.wall - 10 - k * 9;
      const y = heightAt(lx, lz);
      b.cyl('wood', lx, y, lz, 0.07, 0.1, 3.2, 0x3a3430, 6, 0);
      b.box('plain', lx, y + 3.2, lz, 0.36, 0.46, 0.36, 0, 0xffe9a8, 0);
    }
  }
  return { object: b.build(), flags, info: { plaza, southGate: { x: cx, z: cz + CITY.wall + 8 } } };
}
