import * as THREE from 'three';
import { Builder, archedProfile, place, type Mat } from '../build';
import { addBox, addRound } from '../colliders';
import { structureDetail, detailCounters } from '../structure-detail';
import { seededRandom } from '../noise';
import { seatRock } from '../rock-geometry';
import { heightAt } from '../heightmap';

export const wallStairRamps: { x: number; z: number; theta: number; run: number; foot: number; head: number }[] = [];

const X = new THREE.Vector3(1, 0, 0);
const dir = new THREE.Vector3();
const quat = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const mid = new THREE.Vector3();

/** A straight bar between two points. */
export function beam(b: Builder, mat: Mat, a: THREE.Vector3, c: THREE.Vector3, thick: number, color: number, tall = thick): void {
  dir.subVectors(c, a);
  const len = dir.length();
  quat.setFromUnitVectors(X, dir.normalize());
  mid.addVectors(a, c).multiplyScalar(0.5);
  b.slab(mat, len, tall, thick, new THREE.Matrix4().compose(mid, quat, one), color);
}

/** Post-and-rail fence following the ground along a path. */
export function fence(b: Builder, pts: [number, number][], color = 0x8a6a48): void {
  const posts: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2.6));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      posts.push(new THREE.Vector3(x, heightAt(x, z), z));
    }
  }
  const up = new THREE.Vector3();
  const up2 = new THREE.Vector3();
  posts.forEach((p, i) => {
    b.box('wood', p.x, p.y - 0.3, p.z, 0.16, 1.4, 0.16, i * 0.7, color, 0.2);
    if (i === 0) return;
    const q = posts[i - 1];
    for (const h of [0.5, 0.92]) {
      beam(b, 'wood', up.copy(q).setY(q.y + h), up2.copy(p).setY(p.y + h), 0.07, color, 0.12);
    }
  });
}

/**
 * Stairs that climb round the outside of a square tower, one flight per side.
 * The collider under each flight is a ramp, so they are simply walked up.
 */
export function wrapStairs(
  b: Builder, cx: number, cz: number, half: number, rot: number,
  y0: number, y1: number, flights: number, width = 1.8, color = 0xcfc8b8,
): void {
  const rise = (y1 - y0) / flights;
  const out = half + width / 2;
  for (let i = 0; i < flights; i++) {
    const theta = rot + (i * Math.PI) / 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const ya = y0 + i * rise;
    const yb = ya + rise;
    // Flight: a wedge of masonry, solid down to the ground.
    const x = cx + out * s;
    const z = cz + out * c;
    const base = Math.min(heightAt(x, z), y0) - 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, base);
    shape.lineTo(half, base);
    shape.lineTo(half, yb);
    shape.lineTo(-half, ya);
    shape.closePath();
    b.shape('stone', shape, width, place(x, 0, z, theta), color);
    addBox(x, z, half, width / 2, theta, (lx) => ya + ((lx + half) / (2 * half)) * rise);
    // Landing at the corner.
    const lx = cx + out * c + out * s;
    const lz = cz - out * s + out * c;
    b.box('stone', lx, base, lz, width, yb - base, width, theta, color, 0.1);
    addBox(lx, lz, width / 2, width / 2, theta, yb);
  }
}

export interface RingGate {
  angle: number;
  width: number;
  height: number;
}

export interface RingOptions {
  x: number;
  z: number;
  radius: number;
  polygon?: [number, number][];
  segments: number;
  /** Angle of the first tower. */
  phase: number;
  height: number;
  thickness: number;
  towerRadius: number;
  gates: RingGate[];
  roof: number;
  color: number;
  /** Segments (by index) that get a stair up to the wall walk, on the inside. */
  stairs: number[];
}

export interface RingResult {
  towers: { x: number; z: number; top: number }[];
  /** Ground point just inside each gate, in the same order as the options. */
  gates: { x: number; z: number; top: number; angle: number }[];
}

/**
 * A ring of curtain wall with a tower at every corner. The wall walk slopes
 * with the land and passes through open-sided tower tops, so it can be
 * followed all the way round.
 */
export function wallRing(b: Builder, o: RingOptions): RingResult {
  const step = (Math.PI * 2) / o.segments;
  const points = o.polygon ?? Array.from({ length: o.segments }, (_, i) => {
    const a = o.phase + i * step;
    return [o.x + Math.cos(a) * o.radius, o.z + Math.sin(a) * o.radius];
  });
  const verts = points.map(([x, z]) => ({ x, z, a: Math.atan2(z - o.z, x - o.x), ground: heightAt(x, z), top: heightAt(x, z) + o.height }));
  const gateSegments = o.gates.map((g) => {
    let best = Infinity, index = 0;
    verts.forEach((v, i) => {
      const w = verts[(i + 1) % verts.length];
      const a = Math.atan2((v.z + w.z) / 2 - o.z, (v.x + w.x) / 2 - o.x);
      const d = Math.abs(Math.atan2(Math.sin(g.angle - a), Math.cos(g.angle - a)));
      if (d < best) { best = d; index = i; }
    });
    return index;
  });
  const result: RingResult = { towers: [], gates: [] };

  verts.forEach((v, i) => {
    const w = verts[(i + 1) % verts.length];
    const dx = w.x - v.x;
    const dz = w.z - v.z;
    const full = Math.hypot(dx, dz);
    const L = full - o.towerRadius * 1.2;
    const cx = (v.x + w.x) / 2;
    const cz = (v.z + w.z) / 2;
    const theta = Math.atan2(-dz, dx);
    const top = (lx: number): number => {
      const t = lx / full + 0.5;
      return Math.max(v.top + (w.top - v.top) * t, heightAt(v.x + dx * t, v.z + dz * t) + o.height);
    };
    let base = Infinity;
    for (let k = 0; k <= 6; k++) base = Math.min(base, heightAt(v.x + (dx * k) / 6, v.z + (dz * k) / 6));
    base -= 3;
    // Which side of the wall faces outward.
    const outward = (cx - o.x) * Math.sin(theta) + (cz - o.z) * Math.cos(theta) > 0 ? 1 : -1;
    const local = (lx: number, lz: number): [number, number] => [
      cx + lx * Math.cos(theta) + lz * Math.sin(theta),
      cz - lx * Math.sin(theta) + lz * Math.cos(theta),
    ];

    const gate = o.gates[gateSegments.indexOf(i)];
    const shape = archedProfile(
      -L / 2, L / 2, base, top,
      gate ? [{ x: 0, w: gate.width, crown: heightAt(cx, cz) + gate.height }] : [], 12,
    );
    if (gate) {
      const ground = heightAt(cx, cz);
      const r = gate.width / 2;
      const side = (L / 2 - r) / 2;
      for (const sgn of [1, -1]) {
        const off = (r + side) * sgn;
        addBox(...local(off, 0), side, o.thickness / 2, theta, (lx) => top(lx + off));
        // Flanking gate towers.
        const [tx, tz] = local((r + 2.6) * sgn, outward * 1.2);
        const th = top(0) + 3.5;
        b.box('stone', tx, base, tz, 5, th - base, o.thickness + 2.6, theta, o.color, 0.12);
        b.pyramid('roof', tx, th, tz, 6, o.thickness + 3.6, 4.2, theta, o.roof);
        addBox(tx, tz, 2.5, o.thickness / 2 + 1.3, theta, th);
      }
      addBox(cx, cz, r, o.thickness / 2, theta, () => top(0), ground + gate.height - 0.2);
      // Doors standing open inside the arch.
      for (const sgn of [1, -1]) {
        const [dx2, dz2] = local((r - 0.2) * sgn, -outward * (o.thickness / 2 + r * 0.45));
        b.box('wood', dx2, ground - 0.2, dz2, 0.22, gate.height - r * 0.4, r * 0.95, theta, 0x6a4c34, 0.1);
      }
      const [gx, gz] = local(0, -outward * (o.thickness / 2 + 4));
      result.gates.push({ x: gx, z: gz, top: top(0), angle: gate.angle });
    } else {
      addBox(cx, cz, L / 2, o.thickness / 2, theta, top);
    }
    b.shape('stone', shape, o.thickness, place(cx, 0, cz, theta), o.color);

    b.detail(() => {
      const random = seededRandom(Math.round(cx * 91 + cz * 57));
      const course = 0.82, columns = Math.ceil(L / 2.15), bw = L / columns;
      for (let row = 0; row < Math.ceil((top(0) - base) / course); row++) {
        for (let k = 0; k < columns; k++) {
          const lx = -L / 2 + (k + 0.5 + (row % 2) * 0.48) * bw;
          if (lx + bw / 2 > L / 2) continue;
          const [px, pz] = local(lx, 0);
          const y = base + row * course;
          if (y + course > top(lx) - 0.06 || y < heightAt(px, pz) - 0.6) continue;
          // Keep the gate's entire arch clear, including its springing curve.
          if (gate && Math.abs(lx) < gate.width / 2 + bw / 2 + 0.12 && y < heightAt(cx, cz) + gate.height + 0.55) continue;
          const [bx, bz] = local(lx, outward * (o.thickness / 2 + 0.015));
          b.block(bx, y + 0.025, bz, bw - 0.055, course - 0.055, 0.13 + random() * 0.06, theta,
            new THREE.Color(o.color).multiplyScalar(0.89 + random() * 0.16).getHex(), 0.035);
          detailCounters.wallBlocks++;
        }
      }
      // A low battered plinth stays below the player's step height.
      for (let k = 0; k < columns; k++) {
        const lx = -L / 2 + (k + 0.5) * bw;
        if (gate && Math.abs(lx) < gate.width / 2 + bw / 2) continue;
        const [px, pz] = local(lx, outward * (o.thickness / 2 - 0.04));
        b.block(px, heightAt(px, pz) - 0.12, pz, bw - 0.025, 0.42, 0.52, theta, o.color, 0.05);
      }
      if (gate) {
        const r = gate.width / 2, ground = heightAt(cx, cz), spring = ground + gate.height - r;
        // Individual radial voussoirs, separated by fine mortar gaps.
        for (let k = 0; k < 15; k++) {
          const a = Math.PI * k / 15 + 0.014, c = Math.PI * (k + 1) / 15 - 0.014;
          const ring = new THREE.Shape();
          ring.moveTo(Math.cos(a) * (r + 0.035), spring + Math.sin(a) * (r + 0.035));
          ring.lineTo(Math.cos(a) * (r + 0.52), spring + Math.sin(a) * (r + 0.52));
          ring.lineTo(Math.cos(c) * (r + 0.52), spring + Math.sin(c) * (r + 0.52));
          ring.lineTo(Math.cos(c) * (r + 0.035), spring + Math.sin(c) * (r + 0.035)); ring.closePath();
          const [px, pz] = local(0, outward * (o.thickness / 2 + 0.09));
          b.shape('stone', ring, 0.22, place(px, 0, pz, theta), k % 3 ? o.color : 0xe8dfcc);
          detailCounters.archStones++;
        }
        for (const sign of [-1, 1]) for (let y = ground; y + 0.7 < spring; y += 0.75) {
          const [px, pz] = local(sign * (r + 0.27), outward * (o.thickness / 2 + 0.08));
          b.block(px, y, pz, 0.48, 0.72, 0.24, theta, o.color);
        }
      }
    });

    // Battlements along the outer edge.
    const merlons = Math.floor(L / 2.3);
    for (let k = 0; k < merlons; k++) {
      const lx = -L / 2 + ((k + 0.5) * L) / merlons;
      const [mx, mz] = local(lx, outward * (o.thickness / 2 - 0.28));
      if (structureDetail()) b.block(mx, top(lx) - 0.3, mz, 1.15, 1.3, 0.56, theta, o.color, 0.06);
      else b.box('stone', mx, top(lx) - 0.3, mz, 1.15, 1.3, 0.56, theta, o.color, 0);
    }

    if (o.stairs.includes(i) && !gate) {
      // A ramp of steps against the inside face, rising along the wall.
      const run = Math.min(L - 4, 18);
      const x1 = run / 2;
      const [sx, sz] = local(0, -outward * (o.thickness / 2 + 1.0));
      const [bx, bz] = local(-x1, -outward * (o.thickness / 2 + 1.0));
      const head = top(x1);
      // The foot is where the ground meets it; lift it if the ground swells higher along the way up.
      let foot = heightAt(bx, bz);
      for (let u = -x1; u <= x1 * 0.7; u += 0.5) {
        const t = (u + x1) / run, [gx, gz] = local(u, -outward * (o.thickness / 2 + 1.0));
        foot = Math.max(foot, (heightAt(gx, gz) + 0.02 - t * head) / (1 - t));
      }
      wallStairRamps.push({ x: sx, z: sz, theta, run, foot, head });
      const ramp = new THREE.Shape();
      ramp.moveTo(-x1, base);
      ramp.lineTo(x1, base);
      ramp.lineTo(x1, head);
      ramp.lineTo(-x1, foot);
      ramp.closePath();
      b.shape('stone', ramp, 2, place(sx, 0, sz, theta), o.color);
      addBox(sx, sz, x1, 1, theta, (lx) => foot + ((lx + x1) / run) * (head - foot));
    }
  });

  for (const v of verts) {
    let base = v.ground;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      base = Math.min(base, heightAt(v.x + Math.cos(a) * o.towerRadius, v.z + Math.sin(a) * o.towerRadius));
    }
    base -= 3;
    const r = o.towerRadius;
    b.cyl('stone', v.x, base, v.z, r, r * 1.1, v.top - base, o.color, 16, 0.14);
    b.cyl('stone', v.x, v.top - 0.5, v.z, r + 0.35, r + 0.35, 0.5, o.color, 16, 0);
    addRound(v.x, v.z, r + 0.3, v.top);
    b.detail(() => {
      for (const h of [0.18, (v.top - v.ground) * 0.48, v.top - v.ground - 1.8]) {
        const radius = r * (1.1 - 0.1 * (v.ground + h - base) / (v.top - base)) + 0.12;
        b.cyl('stone', v.x, v.ground + h, v.z, radius, radius, 0.23, o.color, 16, 0.18);
        detailCounters.towerBands++;
      }
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        const y = v.top - 3.8, radius = r * (1.1 - 0.1 * (y - base) / (v.top - base)) + 0.035;
        const px = v.x + Math.sin(a) * radius, pz = v.z + Math.cos(a) * radius;
        b.box('plain', px, y, pz, 0.19, 1.35, 0.045, a, 0x41453e, 0);
        for (const sign of [-1, 1]) b.block(px + Math.cos(a) * sign * 0.2, y - 0.12, pz - Math.sin(a) * sign * 0.2, 0.17, 1.58, 0.12, a, o.color, 0.02);
        b.block(px, y - 0.22, pz, 0.65, 0.14, 0.19, a, o.color, 0.025);
      }
    });
    // Open-sided top: posts carry the roof, so the wall walk passes through.
    for (let k = 0; k < 6; k++) {
      const a = v.a + (k / 6) * Math.PI * 2 + 0.5;
      b.box('wood', v.x + Math.cos(a) * (r - 0.1), v.top, v.z + Math.sin(a) * (r - 0.1), 0.34, 3.3, 0.34, -a, 0x6a5240, 0);
      const a2 = a + Math.PI / 6;
      b.box('stone', v.x + Math.cos(a2) * (r + 0.05), v.top, v.z + Math.sin(a2) * (r + 0.05), 1.0, 1.0, 0.5, -a2 + Math.PI / 2, o.color, 0);
    }
    b.cone('roof', v.x, v.top + 3.25, v.z, r + 1.1, r * 1.5 + 1.2, o.roof, 16);
    addRound(v.x, v.z, r + 1.1, (lx, lz) => v.top + 3.25 + (r * 1.5 + 1.2) * Math.max(0, 1 - Math.hypot(lx, lz) / (r + 1.1)), v.top + 3.25);
    result.towers.push({ x: v.x, z: v.z, top: v.top });
  }
  return result;
}

export const dryWallSections: { x: number; z: number; ground: number; top: number }[] = [];

/** Broken dry-stone boundaries with uneven caps, following the ground. */
export function dryStoneWall(b: Builder, pts: [number, number][], rand: () => number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1], dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz), rot = Math.atan2(-dz, dx);
    const blocks = Math.ceil(len / 1.6);
    for (let k = 0; k < blocks; k++) {
      if (rand() < 0.12) continue;
      const t = (k + 0.5) / blocks, x = a[0] + t * dx, z = a[1] + t * dz;
      const h = 0.45 + rand() * 0.4;
      const width = len / blocks - 0.05, depth = 0.7 + rand() * 0.2, angle = rot + (rand() - 0.5) * 0.14;
      const ground = heightAt(x, z) - 0.15;
      if (!structureDetail()) b.box('stone', x, ground, z, width, h, depth, angle, k % 4 ? 0xbebaa4 : 0xa4ad83);
      else {
        const random = seededRandom(Math.round(x * 71 + z * 97));
        const supports: THREE.BufferGeometry[] = [];
        const footing = b.rock(x, 0, z, width * 1.03, 0.39, depth, angle, 0xa6a38f, k + i * 123, 1, 'wall');
        seatRock(footing, [], heightAt); supports.push(footing);
        // Four legible staggered courses; broad, flattened fractured stones, not pancakes.
        for (let row = 0; row < 4; row++) {
          const course: THREE.BufferGeometry[] = [];
          for (let part = 0; part < 2; part++) {
            if (row === 3 && random() < 0.1) continue;
            const off = (part - 0.5) * width * 0.46 + (row % 2 ? 0.08 : -0.04);
            const geo = b.rock(x + Math.cos(angle) * off, 0, z - Math.sin(angle) * off,
              width * (0.51 + random() * 0.08), 0.23 + h * 0.09 + random() * 0.03,
              depth * (0.9 - row * 0.035), angle + (random() - 0.5) * 0.16,
              row % 2 ? 0xb7b39f : 0xc3bba7, k * 47 + row * 7 + part, 1, 'wall');
            seatRock(geo, supports, heightAt); course.push(geo);
            detailCounters.dryCourses++;
          }
          supports.push(...course);
        }
        const cap = b.rock(x, 0, z, width * 0.96, 0.23, depth * 0.95, angle, 0xb4b69a, k + 19, 1, 'wall');
        seatRock(cap, supports, heightAt);
        dryWallSections.push({ x, z, ground: heightAt(x, z), top: cap.boundingBox!.max.y });
      }
    }
  }
}
