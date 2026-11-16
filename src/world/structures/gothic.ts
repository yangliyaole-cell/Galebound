import * as THREE from 'three';
import { Builder, place, type Mat } from '../build';
import { addBox } from '../colliders';
import { plant } from '../flora/garden';

/**
 * The stonemason's kit for Cloudfall Abbey: pointed arches, moulded orders,
 * geometric tracery, clustered piers, rib vaults and the furnishings that
 * stand among them. Everything is built from the same few proportions, so the
 * parts agree with one another the way a real building's do.
 */

/** Rise of an equilateral pointed arch of unit span. */
export const EQ = Math.sqrt(3) / 2;
const V2 = (x: number, y: number): THREE.Vector2 => new THREE.Vector2(x, y);

/**
 * A two-centred pointed arch as a polyline: up the left jamb from `base`, over the
 * apex, down the right jamb. `grow` offsets the whole curve outward concentrically.
 */
export function archPoints(w: number, spring: number, rise: number, seg = 8, base = spring, grow = 0): THREE.Vector2[] {
  const r0 = (rise * rise + w * w / 4) / w, c = r0 - w / 2, r = r0 + grow;
  const phi = Math.atan2(Math.sqrt(Math.max(0, r * r - c * c)), c);
  const pts: THREE.Vector2[] = [];
  if (base < spring - 1e-6) pts.push(V2(-w / 2 - grow, base));
  for (let i = 0; i <= seg; i++) { const a = Math.PI - phi * i / seg; pts.push(V2(c + Math.cos(a) * r, spring + Math.sin(a) * r)); }
  for (let i = 1; i <= seg; i++) { const a = phi * (1 - i / seg); pts.push(V2(-c + Math.cos(a) * r, spring + Math.sin(a) * r)); }
  if (base < spring - 1e-6) pts.push(V2(w / 2 + grow, base));
  return pts;
}
/** Height of a pointed arch of span `w` and rise `rise` at a distance `x` from its axis. */
export function archHeight(w: number, rise: number, x: number): number {
  const r = (rise * rise + w * w / 4) / w, c = r - w / 2, d = Math.min(Math.abs(x), w / 2) + c;
  return Math.sqrt(Math.max(0, r * r - d * d));
}
/** The stone between two concentric pointed arches `t` apart, with legs down to `base`. */
export function archBand(w: number, spring: number, rise: number, t: number, seg = 8, base = spring): THREE.Shape {
  const inner = archPoints(w, spring, rise, seg, base), outer = archPoints(w, spring, rise, seg, base, t);
  return new THREE.Shape([...outer, ...inner.reverse()]);
}
export function ringShape(cx: number, cy: number, outer: number, inner: number, n = 24): THREE.Shape {
  const circle = (r: number): THREE.Vector2[] => Array.from({ length: n }, (_, i) => V2(cx + Math.cos(i / n * Math.PI * 2) * r, cy + Math.sin(i / n * Math.PI * 2) * r));
  const s = new THREE.Shape(circle(outer));
  if (inner > 0) s.holes.push(new THREE.Path(circle(inner).reverse()));
  return s;
}
/** An n-pointed star, for inlays, bosses and finials. */
export function starShape(points: number, outer: number, inner: number, turn = 0): THREE.Shape {
  return new THREE.Shape(Array.from({ length: points * 2 }, (_, i) => {
    const a = turn + i / (points * 2) * Math.PI * 2, r = i % 2 ? inner : outer;
    return V2(Math.sin(a) * r, Math.cos(a) * r);
  }));
}

export interface Opening {
  /** Centre, measured along the wall from its midpoint. */
  u: number; w: number;
  /** World heights of the sill and of the springing of the arch. */
  sill: number; spring: number;
  /** Rise of the arch; equilateral when omitted. */
  rise?: number;
  /** Cut down to the floor and passable. */
  door?: boolean;
}
/** Rotation that turns local +X along the direction (dx, dz). */
export const along = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/**
 * A straight wall from `a` to `c` with pointed openings cut through it, and the
 * colliders to match: solid between doors, a lintel over each.
 */
export function wall(b: Builder, mat: Mat, a: [number, number], c: [number, number], y0: number, y1: number | ((u: number) => number),
  thick: number, color: number, openings: Opening[] = [], collide = true, holes: THREE.Path[] = []): void {
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz), rot = along(dx, dz);
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  const top = typeof y1 === 'number' ? () => y1 : y1;
  const outline: THREE.Vector2[] = [V2(-len / 2, y0)];
  const doors = openings.filter((o) => o.door).sort((p, q) => p.u - q.u);
  for (const o of doors) {
    const arch = archPoints(o.w, o.spring, o.rise ?? o.w * EQ, 8, y0);
    for (const p of arch) outline.push(V2(p.x + o.u, p.y));
  }
  outline.push(V2(len / 2, y0));
  const steps = typeof y1 === 'number' ? 1 : Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= steps; i++) { const u = len / 2 - len * i / steps; outline.push(V2(u, top(u))); }
  const shape = new THREE.Shape(outline);
  for (const o of openings) {
    if (o.door) continue;
    shape.holes.push(new THREE.Path(archPoints(o.w, o.spring, o.rise ?? o.w * EQ, 8, o.sill).map((p) => V2(p.x + o.u, p.y))));
  }
  shape.holes.push(...holes);
  b.shape(mat, shape, thick, place(mx, 0, mz, rot), color);
  if (collide) wallSolid(a, c, thick, y1, openings);
}
/** The colliders of a wall: solid between its doors, with a lintel over each. */
export function wallSolid(a: [number, number], c: [number, number], thick: number, y1: number | ((u: number) => number), openings: Opening[] = [], bottom = -Infinity): void {
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz), rot = along(dx, dz);
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  const top = typeof y1 === 'number' ? () => y1 : y1;
  const doors = openings.filter((o) => o.door).sort((p, q) => p.u - q.u);
  const ux = dx / len, uz = dz / len;
  let from = -len / 2;
  const solid = (u0: number, u1: number, under = bottom): void => {
    if (u1 - u0 < 0.05) return;
    const m = (u0 + u1) / 2;
    addBox(mx + ux * m, mz + uz * m, (u1 - u0) / 2, thick / 2, rot, (lx) => top(m + lx), under);
  };
  for (const o of doors) {
    solid(from, o.u - o.w / 2);
    solid(o.u - o.w / 2, o.u + o.w / 2, o.spring + (o.rise ?? o.w * EQ) * 0.55);
    from = o.u + o.w / 2;
  }
  solid(from, len / 2);
}

/** Moulded orders round an opening: bands of stone stepping back into the wall, the innermost one gilded if asked. */
export function orders(b: Builder, mat: Mat, m: THREE.Matrix4, o: { w: number; sill: number; spring: number; rise?: number },
  count: number, color: number, face = 0.16, step = 0.14, gilt = 0, u = 0): void {
  for (let k = 0; k < count; k++) {
    const grow = k * face, rise = o.rise ?? o.w * EQ;
    const band = new THREE.Shape([...archPoints(o.w, o.spring, rise, 10, o.sill, grow + face), ...archPoints(o.w, o.spring, rise, 10, o.sill, grow).reverse()]);
    const depth = step * (k + 1);
    const g = new THREE.ExtrudeGeometry(band, { depth, bevelEnabled: false }).translate(u, 0, 0);
    b.add(k === 0 && gilt ? 'gilt' : mat, g, k === 0 && gilt ? gilt : color, m, 0.04);
  }
}

/**
 * Geometric tracery filling a pointed window whose arch is equilateral: each level
 * splits the light in two under an oculus, exactly as the masons drew it.
 * Built in the wall's own frame, centred on the wall plane.
 */
export function tracery(b: Builder, mat: Mat, m: THREE.Matrix4, w: number, sill: number, spring: number, levels: number,
  color: number, bar = 0.16, depth = 0.3, x0 = 0, shift = 0): void {
  if (levels <= 0 || w < 0.9) return;
  const emit = (shape: THREE.Shape, d = depth): void => {
    b.add(mat, new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(x0, 0, -d / 2 + shift), color, m, 0);
  };
  const half = w / 2;
  // The mullion, then the two lights' heads.
  emit(new THREE.Shape([V2(-bar / 2, sill), V2(bar / 2, sill), V2(bar / 2, spring + half * EQ * 0.96), V2(-bar / 2, spring + half * EQ * 0.96)]));
  for (const side of [-1, 1]) {
    const inner = archPoints(half - bar, spring, (half - bar) * EQ, 7), outer = archPoints(half - bar, spring, (half - bar) * EQ, 7, spring, bar);
    emit(new THREE.Shape([...outer, ...inner.reverse()].map((p) => V2(p.x + side * half / 2, p.y))));
  }
  // The oculus sits where the three curves leave room for it, with four foils inside.
  const r = w / 4 - bar * 0.35, cy = spring + 0.559 * w;
  emit(ringShape(0, cy, r, r - bar, 22));
  if (r > 0.6) for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + Math.PI / 4, lobe = (r - bar) * 0.52;
    emit(ringShape(Math.cos(a) * lobe * 0.9, cy + Math.sin(a) * lobe * 0.9, lobe, lobe - bar * 0.55, 14), depth * 0.7);
  }
  for (const side of [-1, 1]) tracery(b, mat, m, half - bar, sill, spring, levels - 1, color, bar * 0.72, depth * 0.8, x0 + side * half / 2, shift);
}

/** Radial tracery for a rose window of radius `r`: spokes, a ring of foiled circles and a hub. */
export function roseTracery(b: Builder, mat: Mat, m: THREE.Matrix4, r: number, cy: number, spokes: number, color: number, depth = 0.34, shift = 0): void {
  const emit = (shape: THREE.Shape, d = depth): void => {
    b.add(mat, new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2 + shift), color, m, 0);
  };
  const bar = Math.max(0.12, r * 0.04);
  emit(ringShape(0, cy, r + bar * 1.6, r, 40), depth * 1.5);
  emit(ringShape(0, cy, r * 0.24, r * 0.24 - bar, 20));
  emit(ringShape(0, cy, r * 0.62, r * 0.62 - bar * 0.8, 36));
  for (let k = 0; k < spokes; k++) {
    const a = k / spokes * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const px = -s * bar / 2, py = c * bar / 2;
    emit(new THREE.Shape([V2(c * r * 0.23 + px, cy + s * r * 0.23 + py), V2(c * r * 0.62 + px, cy + s * r * 0.62 + py),
      V2(c * r * 0.62 - px, cy + s * r * 0.62 - py), V2(c * r * 0.23 - px, cy + s * r * 0.23 - py)]));
    // A foiled circle in each outer petal.
    const am = a + Math.PI / spokes, pr = Math.min(r * 0.19, r * 0.8 * Math.sin(Math.PI / spokes) * 0.92);
    emit(ringShape(Math.cos(am) * r * 0.81, cy + Math.sin(am) * r * 0.81, pr, pr - bar * 0.7, 16), depth * 0.8);
  }
}

/** A solid of revolution from a profile of [radius, height] pairs. */
export function lathe(b: Builder, mat: Mat, x: number, y: number, z: number, profile: [number, number][], color: number, seg = 16, shade = 0.06): void {
  b.add(mat, new THREE.LatheGeometry(profile.map(([r, h]) => V2(Math.max(0.001, r), h)), seg), color, place(x, y, z), shade);
}

/**
 * A clustered pier: an octagonal plinth, a moulded base, a core with attached
 * shafts, and a bell capital under a gilded abacus.
 */
export function pier(b: Builder, x: number, y: number, z: number, r: number, h: number, color: number, gold: number, shafts = 8): void {
  const plinth = 0.55, base = 0.5, cap = 1.0;
  b.cyl('marble', x, y, z, r * 1.42, r * 1.5, plinth, color, 8, 0.2);
  lathe(b, 'marble', x, y + plinth, z, [[r * 1.36, 0], [r * 1.4, 0.07], [r * 1.3, 0.16], [r * 1.12, 0.22], [r * 1.22, 0.3], [r * 1.24, 0.38], [r * 1.02, 0.5]], color, 20);
  const shaft = h - plinth - base - cap;
  b.cyl('marble', x, y + plinth + base, z, r * 0.74, r * 0.78, shaft, color, 16, 0.05);
  for (let k = 0; k < shafts; k++) {
    const a = k / shafts * Math.PI * 2 + Math.PI / shafts * (shafts === 8 ? 1 : 0), major = k % 2 === 0;
    const sr = r * (major ? 0.25 : 0.16), d = r * (major ? 0.82 : 0.86);
    b.cyl('marble', x + Math.cos(a) * d, y + plinth + base * 0.6, z + Math.sin(a) * d, sr, sr, shaft + base * 0.4, color, 8, 0.03);
  }
  // Shaft ring half way up, as on the tall piers of the great churches.
  if (shaft > 6) lathe(b, 'marble', x, y + plinth + base + shaft * 0.5, z, [[r * 1.02, 0], [r * 1.12, 0.06], [r * 1.12, 0.16], [r * 1.02, 0.22]], color, 16, 0);
  const cy = y + h - cap;
  lathe(b, 'gilt', x, cy - 0.02, z, [[r * 1.02, 0], [r * 1.1, 0.05], [r * 1.02, 0.1]], gold, 16, 0);
  lathe(b, 'marble', x, cy + 0.08, z, [[r * 0.98, 0], [r * 1.0, 0.2], [r * 1.12, 0.48], [r * 1.36, 0.7], [r * 1.42, 0.74]], color, 16, 0);
  // Crockets: two rows of leaves curling out from the bell.
  for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) {
    const a = (k + row * 0.5) / 8 * Math.PI * 2, d = r * (1.02 + row * 0.2), leaf = r * 0.2;
    const g = new THREE.SphereGeometry(leaf, 6, 4).scale(1, 1.25, 0.6).rotateX(-0.5).rotateY(-a + Math.PI / 2);
    b.add('marble', g, color, place(x + Math.cos(a) * d, cy + 0.3 + row * 0.26, z + Math.sin(a) * d), 0);
  }
  b.cyl('marble', x, cy + 0.8, z, r * 1.5, r * 1.44, 0.2, color, 8, 0);
  lathe(b, 'gilt', x, cy + 0.74, z, [[r * 1.44, 0], [r * 1.5, 0.03], [r * 1.44, 0.06]], gold, 8, 0);
}

/**
 * A quadripartite rib vault over the rectangle (x0, z0)-(x1, z1). Both barrels
 * rise to the same crown, so the narrower span is the more sharply pointed.
 * @returns the crown height
 */
export function ribVault(b: Builder, x0: number, z0: number, x1: number, z1: number, spring: number, rise: number,
  web: number, rib: number, gold: number, thick = 0.2, boss = true): number {
  const w = x1 - x0, d = z1 - z0, n = 10;
  const height = (u: number, v: number): number => spring + Math.max(archHeight(w, rise, (u - 0.5) * w), archHeight(d, rise, (v - 0.5) * d));
  const pos: number[] = [];
  const at = (i: number, j: number): [number, number, number] => [x0 + w * i / n, height(i / n, j / n), z0 + d * j / n];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Split each quad along the diagonal that runs toward the nearer groin.
    const a = at(i, j), c = at(i + 1, j), e = at(i + 1, j + 1), f = at(i, j + 1);
    if ((i < n / 2) === (j < n / 2)) pos.push(...a, ...c, ...e, ...a, ...e, ...f); else pos.push(...a, ...c, ...f, ...c, ...e, ...f);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add('fresco', g, web, undefined, 0);
  const tube = (pts: THREE.Vector3[], radius: number, mat: Mat, color: number): void => {
    b.add(mat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, radius, 6, false), color, undefined, 0);
  };
  const line = (ua: number, va: number, ub: number, vb: number, drop: number): THREE.Vector3[] => Array.from({ length: 9 }, (_, k) => {
    const t = k / 8, u = ua + (ub - ua) * t, v = va + (vb - va) * t;
    return new THREE.Vector3(x0 + w * u, height(u, v) - drop, z0 + d * v);
  });
  // Diagonal ribs along the groins, ridge ribs along the crowns.
  for (const [ua, va, ub, vb] of [[0, 0, 0.5, 0.5], [1, 0, 0.5, 0.5], [0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5]]) {
    tube(line(ua, va, ub, vb, thick * 0.5), thick, 'marble', rib);
    tube(line(ua, va, ub, vb, thick * 1.32), thick * 0.24, 'gilt', gold);
  }
  tube(line(0, 0.5, 1, 0.5, thick * 0.3), thick * 0.55, 'marble', rib);
  tube(line(0.5, 0, 0.5, 1, thick * 0.3), thick * 0.55, 'marble', rib);
  const crown = spring + rise;
  if (boss) {
    lathe(b, 'gilt', x0 + w / 2, crown - thick * 3.2, z0 + d / 2, [[0.02, 0], [thick * 1.6, thick * 0.6], [thick * 2.6, thick * 1.5], [thick * 2.2, thick * 2.3], [thick * 0.9, thick * 2.9]], gold, 12, 0);
    b.add('gilt', new THREE.ExtrudeGeometry(starShape(8, thick * 4.2, thick * 1.9), { depth: 0.06, bevelEnabled: false }).rotateX(Math.PI / 2), gold, place(x0 + w / 2, crown - thick * 1.1, z0 + d / 2), 0);
  }
  return crown;
}

/** A moulded arch standing across a space: transverse arches, arcade arches, chancel arches. */
export function standingArch(b: Builder, mat: Mat, cx: number, cz: number, rot: number, w: number, spring: number, rise: number,
  t: number, depth: number, color: number, gold = 0): void {
  const m = place(cx, 0, cz, rot);
  b.shape(mat, archBand(w, spring, rise, t, 10), depth, m, color);
  // A roll moulding on each face and a gilded fillet on the soffit.
  for (const side of [-1, 1]) {
    const roll = new THREE.ExtrudeGeometry(new THREE.Shape([...archPoints(w, spring, rise, 10, spring, t + 0.1), ...archPoints(w, spring, rise, 10, spring, t - 0.08).reverse()]),
      { depth: 0.12, bevelEnabled: false }).translate(0, 0, side * (depth / 2 + 0.06) - 0.06);
    b.add(mat, roll, color, m, 0);
  }
  if (gold) for (const side of [-1, 1]) b.add('gilt', new THREE.ExtrudeGeometry(new THREE.Shape([...archPoints(w, spring, rise, 10, spring, 0.01), ...archPoints(w, spring, rise, 10, spring, -0.05).reverse()]),
    { depth: 0.07, bevelEnabled: false }).translate(0, 0, side * depth * 0.3 - 0.035), gold, m, 0);
}

/** A crocketed pinnacle on a square shaft. */
export function pinnacle(b: Builder, mat: Mat, x: number, y: number, z: number, w: number, h: number, color: number, gold = 0): void {
  b.box(mat, x, y, z, w, h * 0.42, w, 0, color, 0.05);
  b.box(mat, x, y + h * 0.42, z, w * 1.22, h * 0.035, w * 1.22, 0, color, 0);
  for (const turn of [0, Math.PI / 2]) b.prism(mat, x, y + h * 0.455, z, w * 1.1, w * 1.14, w * 0.7, turn, color);
  b.pyramid(mat, x, y + h * 0.455, z, w * 0.86, w * 0.86, h * 0.5, 0, color);
  // Crockets up the arrises: fine work, drawn only from near by.
  b.detail(() => {
    for (let k = 1; k < 5; k++) {
      const t = k / 5, half = w * 0.43 * (1 - t), cy = y + h * 0.455 + h * 0.5 * t;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(mat, x + sx * half, cy, z + sz * half, w * 0.13, w * 0.13, w * 0.13, Math.PI / 4, color, 0);
    }
  });
  const tip = y + h * 0.955;
  if (gold) { b.cyl('gilt', x, tip - 0.02, z, w * 0.05, w * 0.07, h * 0.05, gold, 6, 0); b.add('gilt', new THREE.OctahedronGeometry(w * 0.2), gold, place(x, tip + h * 0.05, z), 0); }
  else b.add(mat, new THREE.OctahedronGeometry(w * 0.2), color, place(x, tip + w * 0.1, z), 0);
}

/** A balustrade of pierced quatrefoil panels between posts, from a to c at height y. */
export function balustrade(b: Builder, mat: Mat, a: [number, number], c: [number, number], y: number, h: number, color: number, collide = true): void {
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz), rot = along(dx, dz);
  const n = Math.max(1, Math.round(len / 1.5)), bay = len / n, m = place((a[0] + c[0]) / 2, 0, (a[1] + c[1]) / 2, rot);
  const panel = new THREE.Shape([V2(-len / 2, y + 0.12), V2(len / 2, y + 0.12), V2(len / 2, y + h - 0.14), V2(-len / 2, y + h - 0.14)]);
  for (let k = 0; k < n; k++) {
    const u = -len / 2 + (k + 0.5) * bay, r = Math.min(bay * 0.2, (h - 0.5) * 0.24);
    for (const [ox, oy] of [[r * 0.8, 0], [-r * 0.8, 0], [0, r * 0.8], [0, -r * 0.8]]) {
      panel.holes.push(new THREE.Path(Array.from({ length: 10 }, (_, i) => V2(u + ox + Math.cos(-i / 10 * Math.PI * 2) * r, y + h / 2 + oy + Math.sin(-i / 10 * Math.PI * 2) * r))));
    }
  }
  b.shape(mat, panel, 0.12, m, color);
  b.shape(mat, new THREE.Shape([V2(-len / 2, y), V2(len / 2, y), V2(len / 2, y + 0.14), V2(-len / 2, y + 0.14)]), 0.3, m, color);
  b.shape(mat, new THREE.Shape([V2(-len / 2, y + h - 0.16), V2(len / 2, y + h - 0.16), V2(len / 2, y + h), V2(-len / 2, y + h)]), 0.34, m, color);
  for (let k = 0; k <= n; k++) {
    const t = k / n, px = a[0] + dx * t, pz = a[1] + dz * t;
    b.box(mat, px, y, pz, 0.26, h + 0.12, 0.26, rot, color, 0);
    b.pyramid(mat, px, y + h + 0.12, pz, 0.3, 0.3, 0.2, rot, color);
  }
  if (collide) addBox((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, len / 2, 0.17, rot, y + h);
}

/** A brass sanctuary lamp hanging on a chain from `top`: its glass glows. */
export function lantern(b: Builder, x: number, top: number, z: number, drop: number, size: number, bronze: number, gold: number, light: number): THREE.Vector3 {
  const y = top - drop, s = size;
  // Chain: alternate links turned a quarter.
  const chain = drop - s * 1.2, links = Math.max(3, Math.round(chain / 1.1));
  b.cyl('bronze', x, top - chain, z, 0.022, 0.022, chain, bronze, 5, 0);
  for (let k = 0; k < links; k++) b.add('bronze', new THREE.OctahedronGeometry(0.06), bronze, place(x, top - (k + 0.5) * chain / links, z), 0);
  lathe(b, 'gilt', x, y + s * 0.72, z, [[0.02, 0.48 * s], [0.1 * s, 0.4 * s], [0.16 * s, 0.22 * s], [0.46 * s, 0.1 * s], [0.52 * s, 0], [0.5 * s, -0.04 * s]], gold, 12, 0);
  lathe(b, 'glow', x, y, z, [[0.2 * s, 0], [0.4 * s, 0.14 * s], [0.47 * s, 0.4 * s], [0.44 * s, 0.7 * s]], light, 12, 0);
  // Ribs of the cage and the bowl beneath.
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    b.box('gilt', x + Math.cos(a) * 0.47 * s, y + 0.02 * s, z + Math.sin(a) * 0.47 * s, 0.035 * s, 0.72 * s, 0.035 * s, -a, gold, 0);
  }
  lathe(b, 'gilt', x, y - 0.3 * s, z, [[0.02, 0], [0.1 * s, 0.03 * s], [0.14 * s, 0.14 * s], [0.34 * s, 0.26 * s], [0.5 * s, 0.3 * s], [0.52 * s, 0.34 * s]], gold, 12, 0);
  b.add('gilt', new THREE.SphereGeometry(0.07 * s, 8, 6), gold, place(x, y - 0.36 * s, z), 0);
  for (const h of [0.0, 0.36, 0.7]) lathe(b, 'gilt', x, y + h * s, z, [[0.47 * s, 0], [0.5 * s, 0.02 * s], [0.47 * s, 0.04 * s]], gold, 12, 0);
  return new THREE.Vector3(x, y + 0.36 * s, z);
}

/** An oak pew: carved, shouldered ends pierced with a quatrefoil; a seat, a back and a book rest. */
export function pew(b: Builder, x: number, y: number, z: number, len: number, rot: number, color: number, dark: number): void {
  const m = place(x, y, z, rot);
  const end = new THREE.Shape([V2(-0.42, 0), V2(0.4, 0), V2(0.4, 0.72), V2(0.3, 0.78), V2(0.22, 0.98), V2(0.3, 1.1), V2(0.2, 1.26), V2(0.06, 1.34),
    V2(-0.1, 1.3), V2(-0.2, 1.14), V2(-0.14, 0.98), V2(-0.3, 0.9), V2(-0.42, 0.8)]);
  const hole = (cx: number, cy: number, r: number): void => {
    for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) end.holes.push(new THREE.Path(Array.from({ length: 8 }, (_, i) => V2(cx + ox * 0.8 + Math.cos(-i / 8 * Math.PI * 2) * r, cy + oy * 0.8 + Math.sin(-i / 8 * Math.PI * 2) * r))));
  };
  hole(0, 0.44, 0.1);
  for (const side of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(end, { depth: 0.09, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }).rotateY(Math.PI / 2).translate(side * (len / 2 - 0.05) - 0.045, 0, 0);
    b.add('oak', g, dark, m, 0.1);
  }
  const part = (w: number, h: number, d: number, lx: number, ly: number, lz: number, tilt = 0, c = color): void => {
    b.slab('oak', w, h, d, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationX(tilt).setPosition(lx, ly, lz)), c);
  };
  part(len - 0.16, 0.06, 0.5, 0, 0.47, 0.02);
  part(len - 0.16, 0.5, 0.05, 0, 0.82, -0.27, 0.12);
  part(len - 0.16, 0.08, 0.1, 0, 1.08, -0.31, 0, dark);
  part(len - 0.16, 0.42, 0.04, 0, 0.24, 0.26, 0, dark);
  part(len - 0.16, 0.04, 0.2, 0, 0.66, -0.4, -0.5);
  part(len - 0.16, 0.05, 0.12, 0, 0.1, -0.22, 0, dark);
}

/** A marble urn on a pedestal, overflowing with flowers and trailing leaves. */
export function flowerUrn(b: Builder, x: number, y: number, z: number, s: number, stone: number, rand: () => number, pedestal = 0): number {
  if (pedestal > 0) {
    b.box('marble', x, y, z, 0.9 * s, 0.14, 0.9 * s, 0, stone, 0);
    b.box('marble', x, y + 0.14, z, 0.7 * s, pedestal - 0.28, 0.7 * s, 0, stone, 0.05);
    b.box('marble', x, y + pedestal - 0.14, z, 0.92 * s, 0.14, 0.92 * s, 0, stone, 0);
  }
  const uy = y + pedestal;
  lathe(b, 'marble', x, uy, z, [[0.3 * s, 0], [0.32 * s, 0.06 * s], [0.14 * s, 0.14 * s], [0.12 * s, 0.24 * s], [0.4 * s, 0.42 * s], [0.52 * s, 0.7 * s], [0.5 * s, 0.86 * s], [0.6 * s, 0.94 * s], [0.56 * s, 0.98 * s]], stone, 14);
  const top = uy + 0.92 * s;
  // A soil top, a mound of white and lavender, and flowers spilling over the lip.
  b.cyl('plain', x, top - 0.06 * s, z, 0.55 * s, 0.55 * s, 0.04, 0x4a3a2a, 14, 0);
  plant('bed', x, top - 0.04 * s, z, 0.62 * s, undefined, [1, 1.7, 1]);
  plant('spill', x, top - 0.04 * s, z, 1.02 * s);
  // The draws the old posy made, so whatever is built after it stays where it was.
  for (let k = 0; k < 26 * 5 + 5 * 3 + 7 * 2; k++) rand();
  return top;
}

/** A tall candlestick with a lit candle. */
export function candlestick(b: Builder, x: number, y: number, z: number, h: number, gold: number, flame = 0xffd890): void {
  lathe(b, 'gilt', x, y, z, [[0.2, 0], [0.21, 0.04], [0.09, 0.1], [0.05, 0.2], [0.09, h * 0.3], [0.04, h * 0.36], [0.04, h * 0.62], [0.08, h * 0.66], [0.035, h * 0.72], [0.035, h * 0.9], [0.13, h * 0.95], [0.14, h]], gold, 10, 0);
  b.cyl('marble', x, y + h, z, 0.035, 0.04, h * 0.36, 0xfff8ea, 6, 0);
  b.add('glow', new THREE.SphereGeometry(0.045, 6, 6).scale(1, 2.3, 1), flame, place(x, y + h * 1.36 + 0.09, z), 0);
}

/** A hanging banner: a field with a gold border, a star and sprays, and a fringe; hung from a gilded rod. */
export function banner(b: Builder, x: number, y: number, z: number, rot: number, w: number, h: number, field: number, gold: number): void {
  const m = place(x, y, z, rot);
  const cloth = new THREE.Shape([V2(-w / 2, 0), V2(w / 2, 0), V2(w / 2, -h * 0.88), V2(0, -h), V2(-w / 2, -h * 0.88)]);
  b.add('velvet', new THREE.ShapeGeometry(cloth), field, m, 0.12);
  const lay = (shape: THREE.Shape, lift = 0.012): void => { b.add('gilt', new THREE.ShapeGeometry(shape).translate(0, 0, lift), gold, m, 0); };
  const strip = (pts: [number, number][], t: number): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [cx, cy] = pts[i + 1], len = Math.hypot(cx - ax, cy - ay), nx = -(cy - ay) / len * t / 2, ny = (cx - ax) / len * t / 2;
      lay(new THREE.Shape([V2(ax + nx, ay + ny), V2(cx + nx, cy + ny), V2(cx - nx, cy - ny), V2(ax - nx, ay - ny)]));
    }
  };
  const e = w * 0.07;
  strip([[-w / 2 + e, -e], [w / 2 - e, -e], [w / 2 - e, -h * 0.86], [0, -h + e * 1.4], [-w / 2 + e, -h * 0.86], [-w / 2 + e, -e]], w * 0.03);
  b.add('gilt', new THREE.ShapeGeometry(starShape(8, w * 0.24, w * 0.085)).translate(0, -h * 0.3, 0.014), gold, m, 0);
  b.add('gilt', new THREE.ShapeGeometry(starShape(4, w * 0.34, w * 0.05)).translate(0, -h * 0.3, 0.013), gold, m, 0);
  // Two sprays of leaves crossing beneath the star.
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
    const t = k / 5, lx = side * (0.05 + t * 0.26) * w, ly = -h * (0.56 + 0.1 * Math.sin(t * 2.4)) + t * h * 0.08;
    const leaf = new THREE.Shape([V2(0, 0), V2(w * 0.035, w * 0.05), V2(0, w * 0.13), V2(-w * 0.035, w * 0.05)]);
    b.add('gilt', new THREE.ShapeGeometry(leaf).rotateZ(-side * (0.5 + t * 0.9)).translate(lx, ly, 0.014), gold, m, 0);
  }
  // Fringe and the rod it hangs from.
  for (let k = 0; k < 9; k++) {
    const u = (k / 8 - 0.5) * w * 0.94, fy = -h * 0.88 - (1 - Math.abs(u) / (w / 2)) * h * 0.12;
    lay(new THREE.Shape([V2(u - w * 0.025, fy), V2(u + w * 0.025, fy), V2(u + w * 0.012, fy - h * 0.045), V2(u - w * 0.012, fy - h * 0.045)]), 0.004);
  }
  b.add('gilt', new THREE.CylinderGeometry(0.035, 0.035, w + 0.3, 8).rotateZ(Math.PI / 2), gold, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(0, 0.03, 0.02)), 0);
  for (const side of [-1, 1]) b.add('gilt', new THREE.SphereGeometry(0.07, 8, 6), gold, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(side * (w / 2 + 0.17), 0.03, 0.02)), 0);
}

/** A robed figure in marble: drapery by a lathe, shoulders, a bowed head and a halo. */
export function statue(b: Builder, x: number, y: number, z: number, h: number, rot: number, stone: number, gold = 0): void {
  const s = h / 2;
  b.add('marble', new THREE.LatheGeometry([[0.36, 0], [0.38, 0.06], [0.3, 0.2], [0.27, 0.7], [0.22, 1.1], [0.25, 1.36], [0.2, 1.52], [0.09, 1.6]].map(([r, v]) => V2(r * s, v * s)), 12).scale(1, 1, 0.74),
    stone, place(x, y, z, rot), 0.12);
  b.add('marble', new THREE.SphereGeometry(0.115 * s, 10, 8).scale(1, 1.14, 1), stone, place(x, y + 1.72 * s, z, rot), 0);
  // Veil and folded hands.
  b.add('marble', new THREE.SphereGeometry(0.15 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.2, 1.05), stone, place(x, y + 1.72 * s, z - 0.02 * s, rot), 0);
  const m = place(x, y, z, rot);
  for (const side of [-1, 1]) b.slab('marble', 0.09 * s, 0.34 * s, 0.1 * s, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationZ(side * 0.5).setPosition(side * 0.1 * s, 1.22 * s, 0.2 * s)), stone);
  if (gold) b.add('gilt', new THREE.TorusGeometry(0.19 * s, 0.014 * s, 5, 20), gold, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(0, 1.76 * s, -0.08 * s)), 0);
}

/** An octagonal stone spire with lucarnes and a gilded finial. Returns the height of its tip. */
export function spire(b: Builder, x: number, y: number, z: number, r: number, h: number, color: number, gold: number): number {
  const g = new THREE.ConeGeometry(r, h, 8, 1, true).rotateY(Math.PI / 8).translate(0, h / 2, 0).toNonIndexed();
  g.computeVertexNormals();
  b.add('slate', g, color, place(x, y, z), 0.1);
  // Ribs down the arrises, and small gabled lights on the cardinal faces.
  b.detail(() => { for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + Math.PI / 8;
    const from = new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r), to = new THREE.Vector3(x, y + h, z);
    const dir = to.clone().sub(from), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    b.add('ashlar', new THREE.CylinderGeometry(0.05, 0.16, len, 5), 0xe9e2d2, new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), 0);
  } });
  for (let tier = 0; tier < 2; tier++) for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + tier * Math.PI / 4, t = 0.14 + tier * 0.3, rr = r * (1 - t) * Math.cos(Math.PI / 8) + 0.1, s = r * (0.3 - tier * 0.1);
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, py = y + h * t - s * 0.6;
    b.box('ashlar', px, py, pz, s * 1.3, s * 1.5, s * 0.9, -a + Math.PI / 2, 0xe9e2d2, 0);
    b.prism('slate', px, py + s * 1.5, pz, s * 1.5, s * 1.1, s * 1.1, -a, color);
    b.box('plain', px + Math.cos(a) * s * 0.46, py + s * 0.3, pz + Math.sin(a) * s * 0.46, s * 0.6, s * 0.9, 0.04, -a + Math.PI / 2, 0x25303c, 0);
  }
  const tip = y + h;
  b.cyl('gilt', x, tip - 0.6, z, 0.07, 0.2, 2.6, gold, 6, 0);
  b.add('gilt', new THREE.SphereGeometry(0.42, 10, 8), gold, place(x, tip + 0.5, z), 0);
  b.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 1.25, 0.42), { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05), gold, place(x, tip + 2.6, z), 0);
  b.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 1.25, 0.42), { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05), gold, place(x, tip + 2.6, z, Math.PI / 2), 0);
  return tip + 3.9;
}
