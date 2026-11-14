import * as THREE from 'three';
import { Builder, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';
import { CITY, CITY_SQUARES, CITY_STREETS, EAST_GATE, SOUTH_GATE, squareDistance, type CitySquare, type Road } from '../layout';
import { cityBase, nearestStreet, squareLevel, streetProfiles } from '../city-plan';
import { seededRandom } from '../noise';
import type { HouseSpec } from './house';
import { wallStairRamps } from './common';

/** Keep masonry off the stair ramps that climb the inside of the curtain wall. */
function onWallRamp(x: number, z: number): boolean {
  return wallStairRamps.some((r) => {
    const c = Math.cos(r.theta), s = Math.sin(r.theta), dx = x - r.x, dz = z - r.z;
    return Math.abs(dx * c - dz * s) < r.run / 2 + 1.5 && Math.abs(dx * s + dz * c) < 2.6;
  });
}

const SETT = 0xf4ead6;
const SETT_DARK = 0xd8ccb4;
const KERB = 0xeae0cc;
const WALL = 0xe6dac2;
const COPING = 0xf3ebdb;
const PATTERN = 0xa8b4c6;

const tmpColor = new THREE.Color();

/** Whether a point lies on paving that belongs to some other street than `own`, or on a square. */
function paved(x: number, z: number, own: Road | null, margin = 0.2): boolean {
  if (CITY_SQUARES.some((q) => squareDistance(q, x, z) < margin)) return true;
  const hit = nearestStreet(x, z, (r) => r !== own);
  return !!hit && hit.d < hit.half + margin;
}

/** Whether a point is inside a house footprint (with a small pad). */
function makeHouseTest(plots: HouseSpec[]): (x: number, z: number, pad: number) => boolean {
  const grid = new Map<string, HouseSpec[]>();
  for (const h of plots) {
    const k = `${Math.floor(h.x / 16)},${Math.floor(h.z / 16)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(h);
  }
  return (x, z, pad) => {
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
      for (const h of grid.get(`${i},${j}`) ?? []) {
        const dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
        if (Math.abs(dx * c - dz * s) < h.w / 2 + pad && Math.abs(dx * s + dz * c) < h.d / 2 + pad) return true;
      }
    }
    return false;
  };
}

interface Sample { x: number; z: number; dx: number; dz: number; half: number; level: number; s: number }

/** The centre line of a street every ~`step` metres, with its paved level and half width. */
function samples(road: Road, step: number): Sample[] {
  const p = streetProfiles.get(road)!, out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < road.pts.length - 1; i++) {
    const a = road.pts[i], b = road.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n || (i === road.pts.length - 2 && k === n); k++) {
      const t = k / n;
      out.push({
        x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len,
        half: (road.widths[i] + (road.widths[i + 1] - road.widths[i]) * t) / 2, level: p[i] + (p[i + 1] - p[i]) * t, s: s + len * t,
      });
    }
    s += len;
  }
  return out;
}

/** Through a gate the way is a smooth ramp, never steps. */
const nearGate = (x: number, z: number): boolean => [SOUTH_GATE, EAST_GATE].some((g) => Math.hypot(x - g.x, z - g.z) < 16);

/** Steep enough that the street is laid as steps rather than a ramp. */
const STEP_GRADE = 0.105;

/**
 * Paving, steps, kerbs and retaining walls for every town street, and the paved
 * squares with their parapets. Walls only stand where the cut or fill is real and
 * no house front already holds the ground.
 */
/** `open` marks ground that must stay unwalled, such as the foot of the grand stair. */
export function buildCityStreets(b: Builder, plots: HouseSpec[], open: (x: number, z: number) => boolean = () => false): void {
  const inHouse = makeHouseTest(plots);
  const rand = seededRandom(4471);
  for (const road of CITY_STREETS) {
    const line = samples(road, 1.6);
    paveStreet(b, road, line, rand);
    stepStreet(b, road, line);
    edgeStreet(b, road, line, inHouse, rand);
  }
  for (const q of CITY_SQUARES) paveSquare(b, q, (x, z, pad) => inHouse(x, z, pad) || open(x, z));
}

/** Ribbon of setts across the street, with a shallow central gutter on the wider ones. */
function paveStreet(b: Builder, road: Road, line: Sample[], rand: () => number): void {
  const across = road.width >= 5 ? 6 : 4;
  const positions: number[] = [], colors: number[] = [];
  const vert = (x: number, y: number, z: number, color: number): void => {
    positions.push(x, y, z);
    tmpColor.set(color);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
  };
  for (let k = 0; k < line.length - 1; k++) {
    const p = line[k], q = line[k + 1];
    const grade = Math.abs(q.level - p.level) / Math.max(1e-3, q.s - p.s);
    const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
    if ((road.stairs || grade > STEP_GRADE) && !nearGate(mx, mz)) continue;
    if (CITY_SQUARES.some((sq) => squareDistance(sq, mx, mz) < -1.5)) continue;
    const wear = 0.94 + rand() * 0.08;
    for (let j = 0; j < across; j++) {
      const u0 = -1 + (2 * j) / across, u1 = -1 + (2 * (j + 1)) / across;
      const corner = (s: Sample, u: number): [number, number, number] => {
        const x = s.x - s.dz * s.half * u, z = s.z + s.dx * s.half * u;
        // A central gutter dips a few centimetres; the setts never sink below the ground.
        const dip = across === 6 ? 0.05 * Math.max(0, 1 - Math.abs(u) * 3) : 0;
        return [x, Math.max(s.level + 0.03 - dip, heightAt(x, z) + 0.03), z];
      };
      const a = corner(p, u0), c = corner(p, u1), d = corner(q, u1), e = corner(q, u0);
      const tone = (u: number): number => {
        tmpColor.set(Math.abs(u) < 0.2 && across === 6 ? SETT_DARK : SETT).multiplyScalar(wear);
        return tmpColor.getHex();
      };
      vert(...a, tone(u0)); vert(...e, tone(u0)); vert(...d, tone(u1));
      vert(...a, tone(u0)); vert(...d, tone(u1)); vert(...c, tone(u1));
    }
  }
  if (!positions.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  b.add('paving', g, 0xffffff);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

/** Flights of steps wherever the street is too steep to ramp. */
function stepStreet(b: Builder, road: Road, line: Sample[]): void {
  const total = line[line.length - 1].s;
  const p = streetProfiles.get(road)!;
  // Walk the street at fine resolution and lay a tread every `tread` metres while it is steep.
  const at = (s: number): Sample => {
    let k = 0;
    while (k < line.length - 2 && line[k + 1].s < s) k++;
    const a = line[k], c = line[k + 1], t = Math.min(1, Math.max(0, (s - a.s) / Math.max(1e-3, c.s - a.s)));
    return { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, dx: a.dx, dz: a.dz, half: a.half + (c.half - a.half) * t, level: a.level + (c.level - a.level) * t, s };
  };
  void p;
  let s = 0;
  while (s < total - 0.2) {
    const here = at(s), ahead = at(Math.min(total, s + 2));
    const grade = Math.abs(ahead.level - here.level) / Math.max(1e-3, ahead.s - here.s);
    if ((!road.stairs && grade <= STEP_GRADE) || nearGate(here.x, here.z)) { s += 0.8; continue; }
    // Rise about 0.16 m; long shallow treads (a cordonata) where the lane is gentle.
    const tread = Math.min(2.4, Math.max(0.36, 0.16 / Math.max(grade, 0.02)));
    const end = at(Math.min(total, s + tread)), mid = at(Math.min(total, s + tread / 2));
    // Where it crosses or runs into another street or a square, that paving takes over.
    if (paved(mid.x, mid.z, road, -0.3)) { s += tread; continue; }
    const top = Math.max(here.level, end.level) + 0.02;
    const bottom = Math.min(here.level, end.level) - 0.5;
    const theta = Math.atan2(-mid.dz, mid.dx);
    b.box('paving', mid.x, bottom, mid.z, tread + 0.04, top - bottom, mid.half * 2, theta, SETT, 0.25);
    // Nosing: a slightly paler worn lip on each step.
    const downhill = end.level < here.level ? 1 : -1;
    b.detail(() => b.box('paving', mid.x + mid.dx * (tread / 2 - 0.09) * downhill, top - 0.1, mid.z + mid.dz * (tread / 2 - 0.09) * downhill,
      0.2, 0.13, mid.half * 2 + 0.02, theta, COPING, 0));
    s += tread;
  }
}

/** Kerbs along ramped streets; retaining walls where the street is cut into or built out from the hill. */
function edgeStreet(b: Builder, road: Road, line: Sample[], inHouse: (x: number, z: number, pad: number) => boolean, rand: () => number): void {
  for (let k = 0; k < line.length - 1; k++) {
    const p = line[k], q = line[k + 1];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.2) continue;
    const theta = Math.atan2(-(q.z - p.z), q.x - p.x);
    for (const side of [-1, 1]) {
      const off = (p.half + q.half) / 2 + 0.3;
      const mx = (p.x + q.x) / 2 - p.dz * off * side, mz = (p.z + q.z) / 2 + p.dx * off * side;
      if (paved(mx, mz, road, 0.6) || inHouse(mx, mz, 0.4) || onWallRamp(mx, mz)) continue;
      const level = (p.level + q.level) / 2;
      // The hill as it would be without the street, a few metres out from its edge.
      const hill = cityBase(mx - p.dz * 3 * side, mz + p.dx * 3 * side);
      const drop = level - hill;
      if (Math.abs(drop) < 0.7) {
        if (!road.stairs) b.box('stone', mx, level - 0.2, mz, len + 0.05, 0.32, 0.32, theta, KERB, 0.1);
        continue;
      }
      // Built out: the wall rises from the slope below to a parapet. Cut in: it holds the bank above.
      const base = Math.min(level, hill) - 0.8;
      const top = drop > 0 ? level + 0.85 : hill + 0.2;
      const tone = rand() < 0.25 ? 0xd8cfb4 : WALL;
      b.box('stone', mx, base, mz, len + 0.08, top - base, 0.6, theta, tone, 0.18);
      b.box('stone', mx, top, mz, len + 0.12, 0.14, 0.74, theta, COPING, 0);
      addBox(mx, mz, len / 2 + 0.05, 0.3, theta, top + 0.14);
    }
  }
}

/** Boundary radius of a square in direction `angle` from its centre (local frame). */
function rimRadius(q: CitySquare, angle: number): number {
  let lo = 0, hi = Math.hypot(q.rx, q.rz) + 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const lx = Math.cos(angle) * mid, lz = Math.sin(angle) * mid;
    const c = Math.cos(q.rot), s = Math.sin(q.rot);
    // Local (u, v) back to world; squareDistance uses u = dx c - dz s, v = dx s + dz c.
    const x = q.x + lx * c + lz * s, z = q.z - lx * s + lz * c;
    if (squareDistance(q, x, z) < 0) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * A square paved in rings of setts, with a compass star of darker stone at its
 * centre; kerbs round its edge, a balustrade where it stands out over the slope
 * and a retaining wall where the hill rises behind it.
 */
function paveSquare(b: Builder, q: CitySquare, inHouse: (x: number, z: number, pad: number) => boolean): void {
  const level = squareLevel.get(q)!;
  const c = Math.cos(q.rot), s = Math.sin(q.rot);
  const world = (lx: number, lz: number): [number, number] => [q.x + lx * c + lz * s, q.z - lx * s + lz * c];
  const sectors = 96, rings = q.kind === 'well' ? 8 : 18;
  const rim = Array.from({ length: sectors }, (_, i) => rimRadius(q, (i / sectors) * Math.PI * 2));
  const small = Math.min(q.rx, q.rz);
  const tone = (lx: number, lz: number): number => {
    const r = Math.hypot(lx, lz), a = Math.atan2(lz, lx);
    const star = small * (q.kind === 'well' ? 0.42 : 0.3) * (0.42 + 0.58 * Math.pow(Math.abs(Math.cos(a * 4)), 6));
    const band = Math.abs(r - small * 0.62) < 0.45 || Math.abs(r - small * 0.66) < 0.12;
    if (r < star) return r < star * 0.35 ? 0xd7c48f : PATTERN;
    if (band) return PATTERN;
    return SETT;
  };
  const positions: number[] = [], colors: number[] = [];
  const point = (i: number, k: number): [number, number, number, number] => {
    const a = (i / sectors) * Math.PI * 2, r = rim[i % sectors] * (k / rings);
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    const [x, z] = world(lx, lz);
    return [x, Math.max(level + 0.04, heightAt(x, z) + 0.03), z, tone(lx, lz)];
  };
  const push = (v: [number, number, number, number]): void => {
    positions.push(v[0], v[1], v[2]);
    tmpColor.set(v[3]);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
  };
  for (let i = 0; i < sectors; i++) for (let k = 0; k < rings; k++) {
    const a = point(i, k), d = point(i + 1, k), e = point(i + 1, k + 1), f = point(i, k + 1);
    push(a); push(f); push(e);
    if (k > 0) { push(a); push(e); push(d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  b.add('paving', g, 0xffffff);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // Edge: kerb, balustrade or retaining wall, opening wherever a street comes in.
  for (let i = 0; i < sectors; i++) {
    const a0 = (i / sectors) * Math.PI * 2, a1 = ((i + 1) / sectors) * Math.PI * 2;
    const [x0, z0] = world(Math.cos(a0) * (rim[i] + 0.25), Math.sin(a0) * (rim[i] + 0.25));
    const [x1, z1] = world(Math.cos(a1) * (rim[(i + 1) % sectors] + 0.25), Math.sin(a1) * (rim[(i + 1) % sectors] + 0.25));
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
    const street = nearestStreet(mx, mz);
    if (street && street.d < street.half + 1.2) continue;
    if (inHouse(mx, mz, 0.3) || onWallRamp(mx, mz)) continue;
    const theta = Math.atan2(-(z1 - z0), x1 - x0);
    const outX = mx + (mx - q.x) / Math.hypot(mx - q.x, mz - q.z) * 3, outZ = mz + (mz - q.z) / Math.hypot(mx - q.x, mz - q.z) * 3;
    const hill = cityBase(outX, outZ), drop = level - hill;
    if (drop > 1.0) {
      // Stands out over the slope: a wall down to the hill and a balustrade on top.
      const base = hill - 0.8;
      b.box('stone', mx, base, mz, len + 0.1, level - base + 0.1, 0.7, theta, WALL, 0.2);
      balustrade(b, mx, level + 0.1, mz, len, theta);
      addBox(mx, mz, len / 2, 0.35, theta, level + 1.15);
    } else if (drop < -1.0) {
      b.box('stone', mx, level - 0.3, mz, len + 0.1, hill - level + 0.5, 0.7, theta, WALL, 0.18);
      b.box('stone', mx, hill + 0.2, mz, len + 0.14, 0.14, 0.84, theta, COPING, 0);
      addBox(mx, mz, len / 2, 0.35, theta, hill + 0.34);
    } else {
      b.box('stone', mx, level - 0.15, mz, len + 0.05, 0.36, 0.36, theta, KERB, 0.1);
    }
  }
  void CITY;
}

/** Stone rail on short turned balusters, the kind that edges a terrace. */
function balustrade(b: Builder, x: number, y: number, z: number, len: number, theta: number): void {
  b.box('stone', x, y, z, len + 0.1, 0.18, 0.5, theta, COPING, 0);
  b.box('stone', x, y + 0.86, z, len + 0.1, 0.14, 0.42, theta, COPING, 0);
  b.detail(() => {
    const n = Math.max(1, Math.round(len / 0.32));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * len / n;
      const bx = x + Math.cos(theta) * u, bz = z - Math.sin(theta) * u;
      b.add('stone', new THREE.CylinderGeometry(0.06, 0.09, 0.68, 6).translate(0, 0.34, 0), COPING, place(bx, y + 0.18, bz), 0.15);
    }
  });
  b.box('stone', x, y + 0.18, z, len * 0.08, 0.68, 0.3, theta, COPING, 0);
}
