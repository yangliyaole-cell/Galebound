import * as THREE from 'three';
import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { CITY, CITY_STREETS, SOUTH_GATE, cityWallPolygon, cityRadiusAt, insideCity, roadClearance, EAST_GATE_ANGLE, SOUTH_GATE_ANGLE, WALL_SEGMENTS } from '../layout';
import { seededRandom } from '../noise';
import { wallRing } from './common';
import { buildPalace } from './palace';
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
  const start = { x: 566, z: -586 };
  const a = Math.atan2(start.z - CITY.z, start.x - CITY.x);
  const radius = cityRadiusAt(a);
  const end = { x: CITY.x + Math.cos(a) * (radius - 14), z: CITY.z + Math.sin(a) * (radius - 14) };
  const wallGround = heightAt(CITY.x + Math.cos(a) * radius, CITY.z + Math.sin(a) * radius);
  const level = Math.max(heightAt(start.x, start.z), heightAt(end.x, end.z), wallGround + 11.5) + 1;
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const dx = (end.x - start.x) / length, dz = (end.z - start.z) / length;
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
  b.box('stone', start.x - dx * 3, heightAt(start.x, start.z) - 2, start.z - dz * 3, 5, level - heightAt(start.x, start.z) + 7.6, 5, theta, STONE, 0.15);
  b.pyramid('roof', start.x - dx * 3, level + 5.6, start.z - dz * 3, 6, 6, 2.4, theta, SLATE);
  addBox(start.x - dx * 3, start.z - dz * 3, 2.5, 2.5, theta, level + 5.6);

  orbAt('aqueduct-mid', mx, mz, 1.3);
  orbAt('aqueduct-quarter', start.x + dx * length * 0.22, start.z + dz * length * 0.22, 1.3);
  orbAt('cistern', ex, ez, 1.2);
  return { ax: start.x, az: start.z, bx: ex, bz: ez };
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
    x: cx, z: cz, radius: CITY.wall, polygon: cityWallPolygon, segments: WALL_SEGMENTS, phase: Math.PI / 2 + step / 2,
    height: 9, thickness: 3.4, towerRadius: 4.6,
    gates: [
      { angle: SOUTH_GATE_ANGLE, width: 6.5, height: 7.6 },
      { angle: EAST_GATE_ANGLE, width: 5.6, height: 6.8 },
    ],
    roof: SLATE, color: STONE, stairs: [18, 1, 15, 5, 10],
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
  buildPalace(b, flags);

  const plaza = { x: cx + 18, z: cz + 100 };
  fountain(b, plaza.x, plaza.z, rand);
  // Keep the smaller town chapel in a genuine vacant parcel, clear of all lanes.
  let chapelScore = -Infinity;
  const cathedralAt = { x: cx, z: cz - 160 };
  for (let dx = -200; dx <= 200; dx += 7) for (let dz = -180; dz <= 160; dz += 7) {
    const x = cx + dx, z = cz + dz;
    if (!insideCity(x, z, 28) || Math.hypot(dx, dz) < 118 || distToLine(x, z, water) < 25) continue;
    const score = Math.min(30, roadClearance(x, z));
    if (score > chapelScore) { chapelScore = score; cathedralAt.x = x; cathedralAt.z = z; }
  }
  const ca = Math.atan2(cathedralAt.z - cz, cathedralAt.x - cx);
  cathedral(b, cathedralAt.x, cathedralAt.z, Math.atan2(Math.cos(ca), Math.sin(ca)), flags);

  const keepOut = [
    { x: plaza.x, z: plaza.z, r: 21 },
    { x: cathedralAt.x, z: cathedralAt.z, r: 21 },
    ...ring.gates.map((g) => ({ x: g.x, z: g.z, r: 13 })),
  ];
  // Parcels grow outwards from crooked streets, with a second, irregular back row.
  // A small spatial hash prevents overlaps without an O(N²) placement pass.
  const parcels = new Map<string, { x: number; z: number; r: number }[]>();
  let count = 0;
  for (const street of CITY_STREETS) {
    let travel = 0, next = rand() * 9;
    for (let i = 0; i < street.pts.length - 1; i++) {
      const [ax, az] = street.pts[i], [bx, bz] = street.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      while (next <= travel + len) {
        const t = (next - travel) / len;
        next += 10 + rand() * 7;
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
          if (rand() < (row ? 0.48 : 0.12)) continue;
          const w = 5.4 + rand() * 4, d = 5.3 + rand() * 3.1;
          const r = Math.hypot(w, d) / 2 + 0.8;
          const off = street.width / 2 + r + 1.5 + rand() * 2 + row * (11 + rand() * 4);
          const x = ax + (bx - ax) * t + nx * off * side;
          const z = az + (bz - az) * t + nz * off * side;
          if (!insideCity(x, z, r + 7) || Math.hypot(x - cx, z - cz) < 94 + r) continue;
          if (roadClearance(x, z) < r || keepOut.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r)) continue;
          if (distToLine(x, z, water) < r + 3) continue;
          const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
          let occupied = false;
          for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
            if (parcels.get(`${ix},${iz}`)?.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r)) occupied = true;
          }
          if (occupied) continue;
          const key = `${gx},${gz}`;
          if (!parcels.has(key)) parcels.set(key, []);
          parcels.get(key)!.push({ x, z, r });
          addHouse(b, {
            x, z, w, d, floors: 1 + Math.floor(rand() * 3.8),
            roof: rand() < 0.18 ? pick(SLATES, rand) : pick(ROOFS, rand), wall: pick(WALLS, rand),
            timber: rand() < 0.35, shutters: pick(SHUTTERS, rand), chimney: rand() < 0.7,
            rot: Math.atan2(-nx * side, -nz * side) + (rand() - 0.5) * 0.16,
            ridgeAlongFront: rand() < 0.6, simple: detail > 1 ? 1 : 2,
          }, rand);
          count++;
          if (count % 37 === 5) orbAt(`city-roof-${count}`, x, z, 1.2);
        }
      }
      travel += len;
    }
  }

  // Lamps along the avenue from the south gate.
  for (let k = 0; k < 6; k++) {
    for (const side of [1, -1]) {
      const lx = SOUTH_GATE.x + 5.5 * side;
      const lz = SOUTH_GATE.z - 8 - k * 3.8;
      const y = heightAt(lx, lz);
      b.cyl('wood', lx, y, lz, 0.07, 0.1, 3.2, 0x3a3430, 6, 0);
      b.box('plain', lx, y + 3.2, lz, 0.36, 0.46, 0.36, 0, 0xffe9a8, 0);
    }
  }
  return { object: b.build(), flags, info: { plaza, southGate: { x: SOUTH_GATE.x, z: SOUTH_GATE.z + 8 } } };
}
