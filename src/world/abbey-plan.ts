/**
 * The ground plan of Cloudfall Abbey, in its own frame: origin at the crossing
 * of the nave's axis and its mid-length, +X east, +Z south (toward the portal),
 * heights above the church floor. Masks, terrain, colliders and masonry all read
 * these numbers, so they cannot drift apart.
 */
export const PLAN = {
  /** Centre line of the arcade piers; the nave is the space between them. */
  nave: 9.5,
  /** Centre line of the aisle walls and their thickness. */
  wall: 18, wallThick: 1.4,
  /** Centre lines of the two end walls. */
  end: 37, endThick: 1.8,
  bay: 9,
  /** The transepts reach out to here, between z = transept[0] and transept[1]. */
  reach: 29, transept: [-18, 0] as [number, number],
  arcadeSpring: 9, arcadeRise: 6,
  triforium: 15.7, clerestory: 20.4,
  vaultSpring: 22.5, vaultRise: 8,
  wallTop: 32, roofRise: 11.5,
  aisleSpring: 8.6, aisleRise: 4.7, aisleTop: 15.6,
  /** The two towers of the south front: centres and half-width. */
  towers: [[-14, 33.5], [14, 33.5]] as [number, number][], towerHalf: 4.8, towerHeight: 52,
  /** The raised sanctuary: the first step and the platform's height. */
  daisZ: -22.6, dais: 0.66,
  /** Cloister: outer square and the width of its walks. */
  cloister: { x0: 18.7, x1: 55.3, z0: 0.65, z1: 37.25, walk: 5.2 },
  library: { x0: 31, x1: 55.3, z0: -14.5, z1: 0.65 },
  sacristy: { x0: -30.5, x1: -18.7, z0: -36.7, z1: -18.65 },
  chapter: { x: 67, z: 18.95, r: 9.2 },
  /** Paved forecourt south of the portal, where the viaduct lands. */
  forecourt: { x0: -22, x1: 30, z0: 38, z1: 76 },
} as const;

export interface Rect { x0: number; x1: number; z0: number; z1: number; roofed: boolean }
const C = PLAN.cloister, CH = PLAN.chapter;
/** Everything the abbey stands on. `roofed` rooms are lit as interiors. */
export const ABBEY_RECTS: Rect[] = [
  { x0: -PLAN.wall - 0.7, x1: PLAN.wall + 0.7, z0: -PLAN.end - 0.9, z1: PLAN.end + 0.9, roofed: true },
  { x0: -PLAN.reach - 0.75, x1: PLAN.reach + 0.75, z0: PLAN.transept[0] - 0.65, z1: PLAN.transept[1] + 0.65, roofed: true },
  { ...PLAN.sacristy, roofed: true },
  { ...PLAN.library, roofed: true },
  { x0: CH.x - CH.r, x1: CH.x + CH.r, z0: CH.z - CH.r, z1: CH.z + CH.r, roofed: true },
  { x0: C.x1, x1: CH.x - CH.r + 1, z0: CH.z - 2.2, z1: CH.z + 2.2, roofed: true },
  { x0: C.x0, x1: C.x1, z0: C.z0, z1: C.z1, roofed: false },
  { x0: -4.2, x1: 4.2, z0: PLAN.end, z1: PLAN.end + 4.6, roofed: false },
];
/** Rounded platforms cut level into the scarp top: [x, z, rx, rz] in the abbey's frame. */
export const ABBEY_SHELVES: [number, number, number, number][] = [
  [0, 0, 51, 64], [46, 13, 46, 44], [7, 58, 50, 35],
];

/** Signed distance to the nearest part of the buildings: negative inside. */
export function planDistance(lx: number, lz: number, roofedOnly = false): number {
  let best = Infinity;
  for (const r of ABBEY_RECTS) {
    if (roofedOnly && !r.roofed) continue;
    const dx = Math.max(r.x0 - lx, lx - r.x1), dz = Math.max(r.z0 - lz, lz - r.z1);
    best = Math.min(best, dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz));
  }
  return best;
}
/** Distance to anything built or paved, forecourt included. */
export function precinctDistance(lx: number, lz: number): number {
  const f = PLAN.forecourt, dx = Math.max(f.x0 - lx, lx - f.x1), dz = Math.max(f.z0 - lz, lz - f.z1);
  return Math.min(planDistance(lx, lz), dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz));
}
/** 1 on the levelled platforms, falling to 0 where the natural ground takes over. */
export function shelfWeight(lx: number, lz: number): number {
  let w = 0;
  for (const [x, z, rx, rz] of ABBEY_SHELVES) {
    const d = Math.hypot((lx - x) / rx, (lz - z) / rz);
    const t = Math.max(0, Math.min(1, (d - 0.82) / (1.45 - 0.82)));
    w = Math.max(w, 1 - t * t * (3 - 2 * t));
  }
  return w;
}
