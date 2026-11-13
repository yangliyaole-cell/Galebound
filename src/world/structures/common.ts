import * as THREE from 'three';
import { Builder, place, type Mat } from '../build';
import { addBox, addRound } from '../colliders';
import { heightAt } from '../heightmap';

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
  const verts = Array.from({ length: o.segments }, (_, i) => {
    const a = o.phase + i * step;
    const x = o.x + Math.cos(a) * o.radius;
    const z = o.z + Math.sin(a) * o.radius;
    return { x, z, a, ground: heightAt(x, z), top: heightAt(x, z) + o.height };
  });
  const result: RingResult = { towers: [], gates: [] };

  verts.forEach((v, i) => {
    const w = verts[(i + 1) % o.segments];
    const dx = w.x - v.x;
    const dz = w.z - v.z;
    const full = Math.hypot(dx, dz);
    const L = full - o.towerRadius * 1.2;
    const cx = (v.x + w.x) / 2;
    const cz = (v.z + w.z) / 2;
    const theta = Math.atan2(-dz, dx);
    const top = (lx: number): number => v.top + (w.top - v.top) * (lx / full + 0.5);
    let base = Infinity;
    for (let k = 0; k <= 6; k++) base = Math.min(base, heightAt(v.x + (dx * k) / 6, v.z + (dz * k) / 6));
    base -= 3;
    // Which side of the wall faces outward.
    const outward = (cx - o.x) * Math.sin(theta) + (cz - o.z) * Math.cos(theta) > 0 ? 1 : -1;
    const local = (lx: number, lz: number): [number, number] => [
      cx + lx * Math.cos(theta) + lz * Math.sin(theta),
      cz - lx * Math.sin(theta) + lz * Math.cos(theta),
    ];

    const midAngle = Math.atan2(cz - o.z, cx - o.x);
    const gate = o.gates.find((g) => Math.abs(Math.atan2(Math.sin(g.angle - midAngle), Math.cos(g.angle - midAngle))) < step * 0.3);
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, base);
    shape.lineTo(L / 2, base);
    shape.lineTo(L / 2, top(L / 2));
    shape.lineTo(-L / 2, top(-L / 2));
    shape.closePath();
    if (gate) {
      const ground = heightAt(cx, cz);
      const r = gate.width / 2;
      const hole = new THREE.Path();
      hole.moveTo(-r, base - 0.5);
      hole.lineTo(-r, ground + gate.height - r);
      hole.absarc(0, ground + gate.height - r, r, Math.PI, 0, true);
      hole.lineTo(r, base - 0.5);
      hole.closePath();
      shape.holes.push(hole);
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

    // Battlements along the outer edge.
    const merlons = Math.floor(L / 2.3);
    for (let k = 0; k < merlons; k++) {
      const lx = -L / 2 + ((k + 0.5) * L) / merlons;
      const [mx, mz] = local(lx, outward * (o.thickness / 2 - 0.28));
      b.box('stone', mx, top(lx) - 0.3, mz, 1.15, 1.3, 0.56, theta, o.color, 0);
    }

    if (o.stairs.includes(i) && !gate) {
      // A ramp of steps against the inside face, rising along the wall.
      const run = Math.min(L - 4, 18);
      const x1 = run / 2;
      const [sx, sz] = local(0, -outward * (o.thickness / 2 + 1.0));
      const [bx, bz] = local(-x1, -outward * (o.thickness / 2 + 1.0));
      const foot = heightAt(bx, bz);
      const head = top(x1);
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
    // Open-sided top: posts carry the roof, so the wall walk passes through.
    for (let k = 0; k < 6; k++) {
      const a = v.a + (k / 6) * Math.PI * 2 + 0.5;
      b.box('wood', v.x + Math.cos(a) * (r - 0.1), v.top, v.z + Math.sin(a) * (r - 0.1), 0.34, 3.3, 0.34, -a, 0x6a5240, 0);
      const a2 = a + Math.PI / 6;
      b.box('stone', v.x + Math.cos(a2) * (r + 0.05), v.top, v.z + Math.sin(a2) * (r + 0.05), 1.0, 1.0, 0.5, -a2 + Math.PI / 2, o.color, 0);
    }
    b.cone('roof', v.x, v.top + 3.25, v.z, r + 1.1, r * 1.5 + 1.2, o.roof, 16);
    result.towers.push({ x: v.x, z: v.z, top: v.top });
  }
  return result;
}
