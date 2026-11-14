import * as THREE from 'three';
import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { CITY, CITY_MAX_RADIUS, CITY_SQUARES, SOUTH_GATE, cityWallPolygon, cityRadiusAt, EAST_GATE_ANGLE, SOUTH_GATE_ANGLE, WALL_SEGMENTS } from '../layout';
import { squareLevel } from '../city-plan';
import { seededRandom } from '../noise';
import { wallRing, wallStairRamps } from './common';
import { PALACE, buildPalace } from './palace';
import { planCityParcels } from './city-parcels';
import { buildCityStreets } from './city-streets';
import { buildCityProps } from './city-props';
import { chimneySmoke } from './hamlets';
import { addHouse } from './house';
import { batchSettlementDetails } from './batch-details';
import { stall } from './village';

const STONE = 0xdad3c3;
const PALE = 0xe6e0d1;
const SLATE = 0x66799a;
const BANNER = 0xc8452f;


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
  // From a spring house on the northern downs, well clear of the town.
  const start = { x: CITY.x + Math.cos(-1.22) * (CITY_MAX_RADIUS + 190), z: CITY.z + Math.sin(-1.22) * (CITY_MAX_RADIUS + 190) };
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

function fountain(b: Builder, x: number, z: number, y: number, rand: () => number): void {
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
    const a = 2.3 + i * 1.6;
    const sx = x + Math.cos(a) * 12.5;
    const sz = z + Math.sin(a) * 12.5;
    stall(b, sx, sz, Math.atan2(x - sx, z - sz), awnings[i], rand);
  }
}

/**
 * The grand stair from the forecourt up the crag to the castle gate: broad flights
 * between two landings, a balustrade either side, and a ramp underfoot.
 */
const PALACE_GATE_R = PALACE.radius + 4;
function grandStair(b: Builder, rFrom: number, yFrom: number): { x: number; z: number; r: number }[] {
  const a = Math.PI, ux = Math.cos(a), uz = Math.sin(a);
  const rTo = PALACE_GATE_R, yTo = CITY.top, width = 10;
  const run = rFrom - rTo, rise = yTo - yFrom;
  const theta = Math.atan2(-uz, ux);
  // Flights of 0.17 m steps, with two level landings on the way up.
  const landings = [0.36, 0.68], landingLen = 3.2;
  const flights = run - landings.length * landingLen;
  const stepRise = 0.17, n = Math.ceil(rise / stepRise);
  const tread = flights / n;
  let r = rFrom, y = yFrom, k = 0;
  const landingAfter = landings.map((l) => Math.round(l * n));
  while (k < n && r > rTo) {
    const len = landingAfter.includes(k) ? landingLen + tread : tread;
    const mid = r - len / 2;
    const x = CITY.x + ux * mid, z = CITY.z + uz * mid;
    const top = y + stepRise;
    const ground = Math.min(heightAt(CITY.x + ux * r, CITY.z + uz * r), heightAt(CITY.x + ux * (r - len), CITY.z + uz * (r - len)));
    b.box('paving', x, Math.min(ground, y) - 0.6, z, len + 0.02, top - Math.min(ground, y) + 0.6, width, theta, 0xf4ead6, 0.2);
    b.detail(() => b.block(CITY.x + ux * (r - 0.1), top - 0.1, CITY.z + uz * (r - 0.1), width + 0.02, 0.12, 0.2, theta + Math.PI / 2, 0xf3ebdb, 0.03));
    // Balustraded cheek walls.
    for (const side of [-1, 1]) {
      const sx = x + Math.sin(theta) * (width / 2 + 0.35) * side, sz = z + Math.cos(theta) * (width / 2 + 0.35) * side;
      const base = Math.min(heightAt(sx, sz), y) - 0.8;
      b.box('stone', sx, base, sz, len + 0.05, top - base + 0.15, 0.7, theta, 0xe6dac2, 0.18);
      b.box('stone', sx, top + 0.15, sz, len + 0.08, 0.16, 0.8, theta, 0xf3ebdb, 0);
      b.box('stone', sx, top + 1.0, sz, len + 0.08, 0.12, 0.5, theta, 0xf3ebdb, 0);
      b.detail(() => {
        const m = Math.max(1, Math.round(len / 0.33));
        for (let i = 0; i < m; i++) {
          const t = mid + len / 2 - (i + 0.5) * len / m;
          const bx = CITY.x + ux * t + Math.sin(theta) * (width / 2 + 0.35) * side, bz = CITY.z + uz * t + Math.cos(theta) * (width / 2 + 0.35) * side;
          b.add('stone', new THREE.CylinderGeometry(0.06, 0.09, 0.69, 6).translate(0, 0.345, 0), 0xf3ebdb, place(bx, top + 0.31, bz), 0.15);
        }
      });
      addBox(sx, sz, len / 2 + 0.03, 0.4, theta, top + 1.12);
    }
    r -= len; y = top; k++;
  }
  // Walk up it as a ramp.
  const xm = CITY.x + ux * (rFrom + rTo) / 2, zm = CITY.z + uz * (rFrom + rTo) / 2;
  addBox(xm, zm, run / 2, width / 2, theta, (lx) => yFrom + rise * Math.min(1, Math.max(0, (run / 2 - lx * Math.sign(-ux)) / run)));
  const keep: { x: number; z: number; r: number }[] = [];
  for (let t = rTo; t <= rFrom + 4; t += 5) keep.push({ x: CITY.x + ux * t, z: CITY.z + uz * t, r: width / 2 + 3 });
  return keep;
}

export interface CityInfo {
  plaza: { x: number; z: number };
  southGate: { x: number; z: number };
  houseCount: number;
}

export function buildCity(detail: number): { object: THREE.Group; flags: FlagSpot[]; info: CityInfo } {
  const b = new Builder();
  const rand = seededRandom(91);
  const flags: FlagSpot[] = [];
  const { x: cx, z: cz } = CITY;

  const ring = wallRing(b, {
    x: cx, z: cz, radius: CITY.wall, polygon: cityWallPolygon, segments: WALL_SEGMENTS, phase: 0,
    height: 11, thickness: 3.8, towerRadius: 5,
    gates: [
      { angle: SOUTH_GATE_ANGLE, width: 6.5, height: 7.6 },
      { angle: EAST_GATE_ANGLE, width: 5.6, height: 6.8 },
    ],
    roof: SLATE, color: STONE, stairs: [4, 13, 22, 31, 38],
  });
  ring.towers.forEach((t, i) => {
    if (i % 3) return;
    flags.push({ x: t.x, y: t.top + 12.6, z: t.z, color: i % 2 ? BANNER : 0x3f6f9a, size: 1 });
    b.cyl('wood', t.x, t.top + 10.6, t.z, 0.07, 0.07, 3, 0x4a4038, 5, 0);
  });
  /** The wall tower nearest a compass direction, for the four wall orbs. */
  const towerToward = (angle: number) => ring.towers.reduce((best, t) => {
    const d = (p: { x: number; z: number }) => Math.abs(Math.atan2(Math.sin(Math.atan2(p.z - cz, p.x - cx) - angle), Math.cos(Math.atan2(p.z - cz, p.x - cx) - angle)));
    return d(t) < d(best) ? t : best;
  });
  for (const [id, angle] of [['wall-south', Math.PI / 2 + 0.4], ['wall-west', Math.PI], ['wall-north', -Math.PI / 2], ['wall-east', 0.1]] as const) {
    const t = towerToward(angle);
    orbAt(id, t.x, t.z, 1.3);
  }

  const water = aqueduct(b);
  buildPalace(b, flags);

  const market = CITY_SQUARES.find((q) => q.kind === 'market')!;
  fountain(b, market.x, market.z, squareLevel.get(market)!, rand);
  // The cathedral closes the upper end of its square, its front turned to it.
  const square = CITY_SQUARES.find((q) => q.kind === 'cathedral')!;
  const tx = Math.cos(square.rot), tz = -Math.sin(square.rot);
  const cathedralAt = { x: square.x + tx * (square.rx + 13), z: square.z + tz * (square.rx + 13) };
  cathedral(b, cathedralAt.x, cathedralAt.z, Math.atan2(square.x - cathedralAt.x, square.z - cathedralAt.z), flags);

  const fore = CITY_SQUARES.find((q) => q.kind === 'forecourt')!;
  const foreR = Math.hypot(fore.x - cx, fore.z - cz) - fore.rz + 0.5;
  const stairKeep = grandStair(b, foreR, squareLevel.get(fore)!);
  const keepOut = [
    ...stairKeep,
    { x: cathedralAt.x, z: cathedralAt.z, r: 22 },
    ...ring.gates.map((g) => ({ x: g.x, z: g.z, r: 13 })),
    // Houses keep off the stair ramps that climb the inside of the curtain wall.
    ...wallStairRamps.filter((r) => Math.hypot(r.x - cx, r.z - cz) < CITY_MAX_RADIUS + 40)
      .flatMap((r) => [-1, -0.5, 0, 0.5, 1].map((t) => ({ x: r.x + t * r.run / 2 * Math.cos(r.theta), z: r.z - t * r.run / 2 * Math.sin(r.theta), r: 3.6 }))),
  ];
  const parcels = planCityParcels(keepOut, (x, z) => distToLine(x, z, water));
  const smoke: number[] = [];
  parcels.forEach((h, i) => {
    const built = addHouse(b, { ...h, simple: detail > 1 ? 1 : 2 }, rand);
    // Smoke from a few of the chimneys: someone is always cooking somewhere.
    if (h.chimney && !h.tower && i % 6 === 0) {
      const u = h.ridgeAlongFront ? h.w * 0.27 : -h.w * 0.2, v = h.ridgeAlongFront ? -h.d * 0.18 : h.d * 0.2;
      const c = Math.cos(h.rot), sn = Math.sin(h.rot);
      smoke.push(h.x + u * c + v * sn, built.topY + 1.2, h.z - u * sn + v * c, (i * 0.618) % 1);
    }
    // Keep the existing four city roof ids; increased density must not add orbs.
    const count = i + 1;
    if (count <= 116 && count % 37 === 5) orbAt(`city-roof-${count}`, h.x, h.z, 1.2);
  });
  buildCityStreets(b, parcels);

  buildCityProps(b, parcels, rand);

  const object = batchSettlementDetails(b.build());
  object.add(chimneySmoke(smoke));
  return { object, flags, info: { plaza: { x: market.x, z: market.z }, houseCount: parcels.length, southGate: { x: SOUTH_GATE.x, z: SOUTH_GATE.z + 8 } } };
}
