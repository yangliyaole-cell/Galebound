import { heightAt } from './heightmap';

/**
 * 2.5D collision: every solid is a footprint (box or circle) with a top
 * surface and, optionally, an underside you can pass beneath. It is enough for
 * walls, roofs, ramps, bridges and towers, and it is cheap.
 */
export interface Collider {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  round: boolean;
  /** World height of the underside; -Infinity when it reaches the ground. */
  bottom: number;
  /** World height of the top at a point in the collider's own frame. */
  top: (lx: number, lz: number) => number;
}

const CELL = 16;
const cells = new Map<number, Collider[]>();
const key = (ix: number, iz: number): number => (ix + 2048) * 4096 + (iz + 2048);

export function addCollider(c: Collider): void {
  const r = (c.round ? c.hx : Math.hypot(c.hx, c.hz)) + 1.5;
  const x0 = Math.floor((c.x - r) / CELL);
  const x1 = Math.floor((c.x + r) / CELL);
  const z0 = Math.floor((c.z - r) / CELL);
  const z1 = Math.floor((c.z + r) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = key(ix, iz);
      const list = cells.get(k);
      if (list) list.push(c);
      else cells.set(k, [c]);
    }
  }
}

export function addBox(
  x: number,
  z: number,
  hx: number,
  hz: number,
  rot: number,
  top: number | ((lx: number, lz: number) => number),
  bottom = -Infinity,
): void {
  addCollider({
    x, z, hx, hz, round: false, bottom,
    cos: Math.cos(rot), sin: Math.sin(rot),
    top: typeof top === 'number' ? () => top : top,
  });
}

export function addRound(
  x: number,
  z: number,
  r: number,
  top: number | ((lx: number, lz: number) => number),
  bottom = -Infinity,
): void {
  addCollider({
    x, z, hx: r, hz: r, round: true, bottom, cos: 1, sin: 0,
    top: typeof top === 'number' ? () => top : top,
  });
}

const EMPTY: Collider[] = [];
function near(x: number, z: number): Collider[] {
  return cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY;
}

const clampTo = (v: number, h: number): number => Math.max(-h, Math.min(h, v));

/** Highest surface the feet can rest on, given how high they can step up. */
export function supportHeight(x: number, z: number, feet: number, step: number): number {
  let best = heightAt(x, z);
  for (const c of near(x, z)) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (c.round ? lx * lx + lz * lz > c.hx * c.hx : Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
    const t = c.top(lx, lz);
    if (t > best && t <= feet + step) best = t;
  }
  return best;
}

/** Highest surface at a point, whatever it is. Used to place things on top. */
export function surfaceTop(x: number, z: number): number {
  return supportHeight(x, z, Infinity, 0);
}

/**
 * Pushes a vertical capsule out of anything it overlaps.
 * @returns true if the position was changed
 */
export function resolveWalls(
  pos: { x: number; z: number },
  radius: number,
  feet: number,
  head: number,
  step: number,
): boolean {
  let hit = false;
  for (const c of near(pos.x, pos.z)) {
    if (head <= c.bottom) continue;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (c.round) {
      const d = Math.hypot(lx, lz);
      const reach = c.hx + radius;
      if (d >= reach) continue;
      const k = d > 1e-5 ? Math.min(1, c.hx / d) : 0;
      if (c.top(lx * k, lz * k) <= feet + step) continue;
      const s = d > 1e-5 ? reach / d : 1;
      const nx = d > 1e-5 ? lx * s : reach;
      const nz = lz * s;
      pos.x = c.x + nx * c.cos + nz * c.sin;
      pos.z = c.z - nx * c.sin + nz * c.cos;
      hit = true;
    } else {
      const px = c.hx + radius - Math.abs(lx);
      const pz = c.hz + radius - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (c.top(clampTo(lx, c.hx), clampTo(lz, c.hz)) <= feet + step) continue;
      let nx = lx;
      let nz = lz;
      if (px < pz) nx = lx + Math.sign(lx || 1) * px;
      else nz = lz + Math.sign(lz || 1) * pz;
      pos.x = c.x + nx * c.cos + nz * c.sin;
      pos.z = c.z - nx * c.sin + nz * c.cos;
      hit = true;
    }
  }
  return hit;
}

/** True if the point is inside the ground or a solid. Used by the camera. */
export function solidAt(x: number, y: number, z: number): boolean {
  if (y < heightAt(x, z) + 0.25) return true;
  for (const c of near(x, z)) {
    if (y <= c.bottom) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (c.round ? lx * lx + lz * lz > c.hx * c.hx : Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
    if (y < c.top(lx, lz)) return true;
  }
  return false;
}

/** Read-only unique solids for the headless world audit and layout tools. */
export function inspectColliders(): readonly Collider[] {
  return [...new Set([...cells.values()].flat())];
}
