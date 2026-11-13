/** Deterministic world-space cloth. No Three, DOM, renderer or random source. */
export type CapeTier = 'low' | 'medium' | 'high';
export const CAPE_DETAIL = {
  low: { columns: 13, rows: 9, iterations: 3, substeps: 1 },
  medium: { columns: 25, rows: 15, iterations: 6, substeps: 2 },
  high: { columns: 45, rows: 25, iterations: 12, substeps: 4 },
} as const;
export interface CapeCapsule { a: readonly number[]; b: readonly number[]; radius: number }
export interface CapePattern { columns: number; rows: number; rest: Float64Array; glide: Float64Array }
export interface CapeFrame {
  targets: ArrayLike<number>;
  colliders: readonly CapeCapsule[];
  wind: readonly number[];
  velocity: readonly number[];
  glide: number;
  groundAt?: (x: number, z: number) => number;
}
export interface CapeStats {
  tier: CapeTier; points: number; constraints: number; iterations: number; substeps: number;
  maxPenetration: number; maxSpeed: number; simulationMs: number; glideBlend: number;
}

/** Bilinear sampling of the exported garment chart; shared by binding and checks. */
export function sampleCape(field: ArrayLike<number>, columns: number, rows: number, u: number, v: number,
  out: { [n: number]: number }, offset = 0): void {
  const x = Math.max(0, Math.min(1, u)) * (columns - 1), y = Math.max(0, Math.min(1, v)) * (rows - 1);
  const i = Math.min(columns - 2, Math.floor(x)), j = Math.min(rows - 2, Math.floor(y));
  const fx = x - i, fy = y - j, a = (j * columns + i) * 3, b = a + columns * 3;
  for (let k = 0; k < 3; k++) out[offset + k] =
    (field[a + k] * (1 - fx) + field[a + 3 + k] * fx) * (1 - fy) +
    (field[b + k] * (1 - fx) + field[b + 3 + k] * fx) * fy;
}

/** Average front/back wall onto a single continuous UV chart, without assuming vertex order. */
export function capePatternFromMesh(position: ArrayLike<number>, uv: ArrayLike<number>,
  glideDelta: ArrayLike<number>, tier: CapeTier): CapePattern {
  const us = [...new Set(Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2]))].sort((a, b) => a - b);
  const vs = [...new Set(Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2 + 1]))].sort((a, b) => a - b);
  if (us.length < 2 || vs.length < 2 || us.length * vs.length > position.length) throw new Error('Cape requires a rectangular garment UV chart');
  const columns = us.length, rows = vs.length, counts = new Uint16Array(columns * rows);
  const rest = new Float64Array(columns * rows * 3), glide = new Float64Array(rest.length);
  const ui = new Map(us.map((u, i) => [u, i])), vi = new Map(vs.map((v, i) => [v, i]));
  for (let n = 0; n < position.length / 3; n++) {
    const index = vi.get(uv[n * 2 + 1])! * columns + ui.get(uv[n * 2])!;
    counts[index]++;
    for (let k = 0; k < 3; k++) {
      rest[index * 3 + k] += position[n * 3 + k];
      glide[index * 3 + k] += position[n * 3 + k] + glideDelta[n * 3 + k];
    }
  }
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) throw new Error('Hole in cape UV chart');
    for (let k = 0; k < 3; k++) { rest[i * 3 + k] /= counts[i]; glide[i * 3 + k] /= counts[i]; }
  }
  const detail = CAPE_DETAIL[tier], result = {
    columns: detail.columns, rows: detail.rows,
    rest: new Float64Array(detail.columns * detail.rows * 3), glide: new Float64Array(detail.columns * detail.rows * 3),
  };
  for (let r = 0; r < result.rows; r++) for (let c = 0; c < result.columns; c++) {
    const offset = (r * result.columns + c) * 3;
    sampleCape(rest, columns, rows, c / (result.columns - 1), r / (result.rows - 1), result.rest, offset);
    sampleCape(glide, columns, rows, c / (result.columns - 1), r / (result.rows - 1), result.glide, offset);
  }
  return result;
}

export function capePenetration(points: ArrayLike<number>, colliders: readonly CapeCapsule[], padding = 0): number {
  let deepest = 0;
  for (let i = 0; i < points.length; i += 3) for (const { a, b, radius } of colliders) {
    const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((points[i] - a[0]) * x + (points[i + 1] - a[1]) * y + (points[i + 2] - a[2]) * z) / (x * x + y * y + z * z || 1)));
    deepest = Math.max(deepest, radius + padding - Math.hypot(points[i] - a[0] - t * x, points[i + 1] - a[1] - t * y, points[i + 2] - a[2] - t * z));
  }
  return deepest;
}

/** Also used after interpolating the render wall: no unchecked vertices between solver nodes. */
export function resolveCapeCollisions(points: { length: number; [n: number]: number }, colliders: readonly CapeCapsule[], padding = 0.009): void {
  const capsules = colliders.map(({ a, b, radius }) => {
    const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2], r = radius + padding;
    return { a, x, y, z, r, r2: r * r, inverse: 1 / (x * x + y * y + z * z || 1),
      minX: Math.min(a[0], b[0]) - r, maxX: Math.max(a[0], b[0]) + r,
      minY: Math.min(a[1], b[1]) - r, maxY: Math.max(a[1], b[1]) + r,
      minZ: Math.min(a[2], b[2]) - r, maxZ: Math.max(a[2], b[2]) + r };
  });
  for (let i = 0; i < points.length; i += 3) {
    for (let pass = 0; pass < 48; pass++) {
      let corrected = false;
      for (const c of capsules) {
        if (points[i] < c.minX || points[i] > c.maxX || points[i + 1] < c.minY || points[i + 1] > c.maxY || points[i + 2] < c.minZ || points[i + 2] > c.maxZ) continue;
        const t = Math.max(0, Math.min(1, ((points[i] - c.a[0]) * c.x + (points[i + 1] - c.a[1]) * c.y + (points[i + 2] - c.a[2]) * c.z) * c.inverse));
        let dx = points[i] - c.a[0] - t * c.x, dy = points[i + 1] - c.a[1] - t * c.y, dz = points[i + 2] - c.a[2] - t * c.z;
        let distance2 = dx * dx + dy * dy + dz * dz;
        if (distance2 >= c.r2 - 1e-12) continue;
        if (distance2 < 1e-18) {
          // Choose a perpendicular, including when the torso lies horizontally in flight.
          dx = -c.z; dy = 0; dz = c.x; distance2 = dx * dx + dz * dz;
          if (distance2 < 1e-18) { dz = -1; distance2 = 1; }
        }
        const scale = c.r / Math.sqrt(distance2);
        points[i] = c.a[0] + t * c.x + dx * scale;
        points[i + 1] = c.a[1] + t * c.y + dy * scale;
        points[i + 2] = c.a[2] + t * c.z + dz * scale;
        corrected = true;
      }
      if (!corrected) break;
    }
  }
}

export class CapeSimulation {
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly stats: CapeStats;
  private readonly oldTargets: Float64Array;
  private readonly targets: Float64Array;
  private readonly acceleration: Float64Array;
  private readonly areas: Float64Array;
  private readonly pinned: Uint8Array;
  private readonly edges: { a: number; b: number; stiffness: number; length: number }[] = [];
  private readonly triangles: number[] = [];
  private oldColliders: CapeCapsule[] = [];
  private initialized = false;
  private oldStep = 1 / 60;

  constructor(readonly pattern: CapePattern, readonly tier: CapeTier) {
    const { columns: cols, rows, rest } = pattern;
    this.positions = new Float64Array(rest); this.previous = new Float64Array(rest);
    this.oldTargets = new Float64Array(rest); this.targets = new Float64Array(rest);
    this.acceleration = new Float64Array(rest.length); this.areas = new Float64Array(rest.length / 3);
    this.pinned = new Uint8Array(rest.length / 3);
    const edge = (a: number, b: number, stiffness: number): void => { this.edges.push({ a: a * 3, b: b * 3, stiffness, length: 0 }); };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const n = r * cols + c;
      // Only the collar/shoulder saddle is fixed. The long front edges are FREE when hanging.
      this.pinned[n] = r === 0 && Math.abs(c / (cols - 1) * 2 - 1) < 0.29 ? 1 : 0;
      if (c + 1 < cols) edge(n, n + 1, 0.95);
      if (r + 1 < rows) edge(n, n + cols, 0.95);
      if (c + 1 < cols && r + 1 < rows) {
        edge(n, n + cols + 1, 0.55); edge(n + 1, n + cols, 0.55);
        this.triangles.push(n, n + cols, n + 1, n + 1, n + cols, n + cols + 1);
      }
      if (c + 2 < cols) edge(n, n + 2, 0.055);
      if (r + 2 < rows) edge(n, n + cols * 2, 0.055);
    }
    this.stats = { tier, points: rest.length / 3, constraints: this.edges.length, ...CAPE_DETAIL[tier], maxPenetration: 0, maxSpeed: 0, simulationMs: 0, glideBlend: 0 };
  }

  update(dt: number, time: number, frame: CapeFrame): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const begin = performance.now(), p = this.positions, q = this.previous;
    this.stats.glideBlend = frame.glide;
    const { substeps, iterations } = CAPE_DETAIL[this.tier];
    const h = Math.min(dt, 1 / 30) / substeps;
    // A teleport resets only the cloth, never during a pose or glide transition.
    const reset = !this.initialized || Math.hypot(frame.targets[0] - this.oldTargets[0], frame.targets[1] - this.oldTargets[1], frame.targets[2] - this.oldTargets[2]) > 4;
    if (reset) {
      p.set(frame.targets); resolveCapeCollisions(p, frame.colliders); q.set(p);
      this.oldTargets.set(frame.targets); this.oldColliders = frame.colliders.map(c => ({ a: [...c.a], b: [...c.b], radius: c.radius }));
      this.initialized = true; this.oldStep = h;
    }
    const moving = frame.colliders.map(c => ({ a: [...c.a], b: [...c.b], radius: c.radius }));
    for (let step = 0; step < substeps; step++) {
      const alpha = (step + 1) / substeps;
      for (let i = 0; i < p.length; i++) this.targets[i] = this.oldTargets[i] + (frame.targets[i] - this.oldTargets[i]) * alpha;
      moving.forEach((c, n) => {
        const old = this.oldColliders[n] ?? frame.colliders[n], next = frame.colliders[n];
        for (let k = 0; k < 3; k++) { c.a[k] = old.a[k] + (next.a[k] - old.a[k]) * alpha; c.b[k] = old.b[k] + (next.b[k] - old.b[k]) * alpha; }
      });
      resolveCapeCollisions(this.targets, moving);
      this.aerodynamics(time - dt + (step + 1) * h, frame);
      for (let n = 0; n < this.pinned.length; n++) {
        const i = n * 3, row = Math.floor(n / this.pattern.columns);
        const spring = 4 + frame.glide * (row === 0 ? 220 : 75);
        for (let k = 0; k < 3; k++) {
          if (this.pinned[n]) { p[i + k] = this.targets[i + k]; q[i + k] = p[i + k]; continue; }
          const speed = Math.max(-32, Math.min(32, (p[i + k] - q[i + k]) / this.oldStep));
          const force = Math.max(-220, Math.min(220, this.acceleration[i + k] + spring * (this.targets[i + k] - p[i + k]) + (k === 1 ? -9.8 : 0)));
          q[i + k] = p[i + k];
          p[i + k] += speed * Math.exp(-1.6 * h) * h + force * h * h;
        }
      }
      for (const e of this.edges) e.length = Math.hypot(this.targets[e.a] - this.targets[e.b], this.targets[e.a + 1] - this.targets[e.b + 1], this.targets[e.a + 2] - this.targets[e.b + 2]);
      for (let it = 0; it < iterations; it++) {
        for (const { a, b, stiffness, length } of this.edges) {
          const wa = 1 - this.pinned[a / 3], wb = 1 - this.pinned[b / 3];
          if (!(wa + wb)) continue;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const correction = (distance - length) / distance * stiffness / (wa + wb);
          p[a] += dx * correction * wa; p[a + 1] += dy * correction * wa; p[a + 2] += dz * correction * wa;
          p[b] -= dx * correction * wb; p[b + 1] -= dy * correction * wb; p[b + 2] -= dz * correction * wb;
        }
        // Interleave contact and distance solves, so the body cannot pull the cloth through itself.
        resolveCapeCollisions(p, moving);
      }
      if (frame.groundAt) for (let i = 0; i < p.length; i += 3) p[i + 1] = Math.max(p[i + 1], frame.groundAt(p[i], p[i + 2]) + 0.015);
      resolveCapeCollisions(p, moving);
      this.stats.maxSpeed = 0;
      for (let i = 0; i < p.length; i += 3) {
        const vx = (p[i] - q[i]) / h, vy = (p[i + 1] - q[i + 1]) / h, vz = (p[i + 2] - q[i + 2]) / h;
        const speed = Math.hypot(vx - frame.velocity[0], vy - frame.velocity[1], vz - frame.velocity[2]);
        const limit = Math.min(1, 28 / (speed || 1));
        for (let k = 0; k < 3; k++) q[i + k] = p[i + k] - (frame.velocity[k] + ((p[i + k] - q[i + k]) / h - frame.velocity[k]) * limit) * h;
        this.stats.maxSpeed = Math.max(this.stats.maxSpeed, Math.min(speed, 28));
      }
      this.oldStep = h;
    }
    this.oldTargets.set(frame.targets);
    this.oldColliders = frame.colliders.map(c => ({ a: [...c.a], b: [...c.b], radius: c.radius }));
    this.stats.maxPenetration = capePenetration(p, frame.colliders);
    this.stats.simulationMs = performance.now() - begin;
  }

  private aerodynamics(time: number, frame: CapeFrame): void {
    const p = this.positions, q = this.previous, f = this.acceleration, areas = this.areas;
    f.fill(0); areas.fill(0);
    const turbulenceScale = 0.35 + Math.hypot(...frame.wind) * 0.055;
    for (let t = 0; t < this.triangles.length; t += 3) {
      const a = this.triangles[t] * 3, b = this.triangles[t + 1] * 3, c = this.triangles[t + 2] * 3;
      const ax = p[b] - p[a], ay = p[b + 1] - p[a + 1], az = p[b + 2] - p[a + 2];
      const bx = p[c] - p[a], by = p[c + 1] - p[a + 1], bz = p[c + 2] - p[a + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const area = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area < 1e-12) continue;
      const normal = [nx / area, ny / area, nz / area];
      let pressure = 0;
      for (let k = 0; k < 3; k++) {
        const clothRelative = ((p[a + k] - q[a + k]) + (p[b + k] - q[b + k]) + (p[c + k] - q[c + k])) / (3 * this.oldStep) - frame.velocity[k];
        const turbulence = Math.sin(time * 4.1 + a * 0.037 + k * 1.9) * Math.sin(time * 2.7 - c * 0.019) * turbulenceScale;
        pressure += (frame.wind[k] - frame.velocity[k] - clothRelative + turbulence) * normal[k];
      }
      // Signed quadratic pressure gives the SAME force after flipping the triangle normal.
      const drag = Math.max(-160, Math.min(160, pressure * Math.abs(pressure) * 0.13));
      for (const i of [a, b, c]) {
        areas[i / 3] += area;
        for (let k = 0; k < 3; k++) f[i + k] += normal[k] * drag * area;
      }
    }
    for (let i = 0; i < f.length; i++) f[i] /= areas[Math.floor(i / 3)] || 1;
  }
}

export type CapePreviewMotion = 'idle' | 'run' | 'jump' | 'glide' | 'turn';
const smooth = (x: number): number => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const rampIntegral = (t: number, start: number, duration: number): number => {
  const u = Math.max(0, Math.min(1, (t - start) / duration));
  return duration * (u ** 3 - 0.5 * u ** 4) + Math.max(0, t - start - duration);
};
/** Shared deterministic preview inputs: idle, acceleration/braking, launch, flight, bank and landing. */
export function capePreviewAt(sequence: CapePreviewMotion, time: number): {
  motion: 'idle' | 'run' | 'jump' | 'fall' | 'glide' | 'land'; speed: number; turn: number;
  yaw: number; height: number; distance: number; wind: number[];
} {
  const t = Math.max(0, time);
  let motion: 'idle' | 'run' | 'jump' | 'fall' | 'glide' | 'land' = 'idle', height = 0;
  const stop = sequence === 'jump' ? 3.1 : sequence === 'glide' ? 6 : 4.5;
  const duration = sequence === 'run' || sequence === 'turn' ? 0.16 : 0.35;
  const speed = sequence === 'idle' ? 0 : 7 * (smooth((t - 1) / 0.6) - smooth((t - stop) / duration));
  const distance = sequence === 'idle' ? 0 : 7 * (rampIntegral(t, 1, 0.6) - rampIntegral(t, stop, duration));
  if (speed > 0.2) motion = 'run';
  if (sequence === 'jump') {
    if (t >= 1.7 && t < 3.1) {
      const u = (t - 1.7) / 1.4;
      height = Math.sin(Math.PI * u) * 1.8;
      motion = u < 0.5 ? 'jump' : 'fall';
    } else if (t >= 3.1 && t < 3.45) motion = 'land';
  }
  if (sequence === 'glide') {
    if (t >= 2 && t < 2.6) { motion = 'jump'; height = 2.4 * Math.sin((t - 2) / 0.6 * Math.PI / 2); }
    else if (t >= 2.6 && t < 5.4) { motion = 'glide'; height = 2.4 - (t - 2.6) * 0.35; }
    else if (t >= 5.4 && t < 6) { motion = 'fall'; height = 1.42 * (1 - smooth((t - 5.4) / 0.6)); }
    else if (t >= 6 && t < 6.35) motion = 'land';
  }
  const yaw = sequence === 'turn' ? Math.PI * 0.85 * smooth((t - 2.4) / 0.38) : 0;
  const turn = sequence === 'turn' && t >= 2.4 && t < 2.9 ? 1 : 0;
  return { motion, speed, turn, yaw, height, distance,
    wind: [1.3 + Math.sin(t * 0.63) * 0.65, 0.2, -2.8 + Math.sin(t * 0.41) * 0.7] };
}
