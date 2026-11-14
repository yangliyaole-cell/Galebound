import { clamp, lerp, sfbm, sstep } from './gen/noise';
import { CITY, CITY_SQUARES, CITY_STREETS, cityRadiusAt, squareDistance, type CitySquare, type Pt, type Road } from './layout';

/**
 * The shape of Hightown's hill, independent of the eroded landscape around it.
 *
 * The castle crown is flat; a short rock face drops from it to the foot, and the
 * town then falls steadily to the curtain wall, a little steeper near the bottom
 * as old hills are. Streets and squares are cut level into that slope (see
 * `cityGround`), so there are no stepped shelves: the steps are in the masonry.
 */
export function cityBase(x: number, z: number): number {
  const dx = x - CITY.x, dz = z - CITY.z, r = Math.hypot(dx, dz);
  if (r <= CITY.plateau) return CITY.top;
  // A rock face of ~14 m from the crown down to its foot: steep enough to read as cliff.
  const upper = CITY.top - 14;
  if (r < CITY.foot) {
    const t = (r - CITY.plateau) / (CITY.foot - CITY.plateau);
    return lerp(CITY.top, upper, t * t * (3 - 2 * t)) + 0.8 * sfbm(x / 9, z / 9, 2) * t * (1 - t);
  }
  const R = cityRadiusAt(Math.atan2(dz, dx));
  const q = Math.min((r - CITY.foot) / (R - CITY.foot), 1.05);
  const wander = (2.4 * sfbm(x / 95 + 3.1, z / 95 - 1.7, 3) + 0.7 * sfbm(x / 33 + 9, z / 33, 2)) * sstep(0, 0.18, q);
  return upper - CITY.fall * Math.pow(Math.max(0, q), 1.12) + wander;
}

/** Each square is paved dead level at the height of the hill under its centre. */
export const squareLevel = new Map<CitySquare, number>();
for (const q of CITY_SQUARES) squareLevel.set(q, Math.round(cityBase(q.x, q.z) * 4) / 4);

/** The hill with every square cut into it, blending over a few metres round each rim. */
function withSquares(x: number, z: number, h: number): number {
  for (const q of CITY_SQUARES) {
    const d = squareDistance(q, x, z);
    if (d < 4) h = lerp(h, squareLevel.get(q)!, 1 - sstep(1.2, 4, d));
  }
  return h;
}

/**
 * Longitudinal profile of every street: the hill under it, smoothed so that it
 * runs as an even ramp. Squares pin it to their level, and where it meets or
 * crosses a street listed before it, it is pinned to that street's surface, so
 * every junction is flush.
 */
export const streetProfiles = new Map<Road, number[]>();
for (const street of CITY_STREETS) {
  const done = [...streetProfiles.keys()];
  const pins: (number | undefined)[] = street.pts.map(([x, z]) => {
    const q = CITY_SQUARES.find((s) => squareDistance(s, x, z) < 1.2);
    if (q) return squareLevel.get(q)!;
    for (const other of done) {
      const p = streetProfiles.get(other)!;
      for (let i = 0; i < other.pts.length - 1; i++) {
        const a = other.pts[i], b = other.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < other.widths[i] / 2 + 0.5) return p[i] + (p[i + 1] - p[i]) * t;
      }
    }
    return undefined;
  });
  let h = street.pts.map(([x, z], i) => pins[i] ?? withSquares(x, z, cityBase(x, z)));
  for (let pass = 0; pass < 6; pass++) {
    h = h.map((v, i) => {
      if (pins[i] !== undefined || i === 0 || i === h.length - 1) return v;
      let sum = 0, weight = 0;
      for (let k = -3; k <= 3; k++) {
        const j = clamp(i + k, 0, h.length - 1), w = 4 - Math.abs(k);
        sum += h[j] * w; weight += w;
      }
      return sum / weight;
    });
  }
  streetProfiles.set(street, h);
}

// Short street segments indexed on a 24 m grid.
const CELL = 24;
const cells = new Map<string, { road: Road; i: number }[]>();
for (const road of CITY_STREETS) for (let i = 0; i < road.pts.length - 1; i++) {
  const a = road.pts[i], b = road.pts[i + 1];
  for (let gx = Math.floor((Math.min(a[0], b[0]) - 12) / CELL); gx <= Math.floor((Math.max(a[0], b[0]) + 12) / CELL); gx++) {
    for (let gz = Math.floor((Math.min(a[1], b[1]) - 12) / CELL); gz <= Math.floor((Math.max(a[1], b[1]) + 12) / CELL); gz++) {
      const key = `${gx},${gz}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push({ road, i });
    }
  }
}

export interface StreetHit {
  road: Road;
  /** Segment index and fraction along it. */
  i: number;
  t: number;
  /** Distance from the centre line, and the half width there. */
  d: number;
  half: number;
  /** Paved surface height at the nearest centre-line point. */
  level: number;
}

/** The town street whose edge is nearest (within ~12 m), measured from its paved edge. */
export function nearestStreet(x: number, z: number, filter?: (road: Road) => boolean): StreetHit | undefined {
  let best: StreetHit | undefined, bestEdge = Infinity;
  for (const { road, i } of cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
    if (filter && !filter(road)) continue;
    const a = road.pts[i], b = road.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    const half = (road.widths[i] + (road.widths[i + 1] - road.widths[i]) * t) / 2;
    if (d - half < bestEdge) {
      const p = streetProfiles.get(road)!;
      bestEdge = d - half;
      best = { road, i, t, d, half, level: p[i] + (p[i + 1] - p[i]) * t };
    }
  }
  return best;
}

/** Height of a street's paved surface at distance `s` metres along it. */
export function streetLevelAt(road: Road, i: number, t: number): number {
  const p = streetProfiles.get(road)!;
  return p[i] + (p[i + 1] - p[i]) * t;
}

/** Grade (rise over run) of a street at segment i. */
export function streetGrade(road: Road, i: number): number {
  const p = streetProfiles.get(road)!, a = road.pts[i], b = road.pts[Math.min(i + 1, road.pts.length - 1)];
  const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return run > 1e-3 ? (p[Math.min(i + 1, p.length - 1)] - p[i]) / run : 0;
}

/** Where the paving stands below the hill, or above it, the ground is cut or filled to meet it. */
const SINK = 0.06;
export function cityGround(x: number, z: number): number {
  // Squares first; a street running out of a square then carries its own ramp right up to the paving.
  let h = withSquares(x, z, cityBase(x, z) + SINK) - SINK;
  const hit = nearestStreet(x, z);
  if (hit) h = lerp(h, hit.level - SINK, 1 - sstep(hit.half + 1.2, hit.half + 3.4, hit.d));
  return h;
}

/** Points sampled along a polyline every `step` metres, with the direction there. */
export function alongPolyline(pts: Pt[], step: number): { x: number; z: number; dx: number; dz: number; i: number; t: number }[] {
  const out: { x: number; z: number; dx: number; dz: number; i: number; t: number }[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    for (let s = carry; s <= len; s += step) out.push({ x: a[0] + dx * s, z: a[1] + dz * s, dx, dz, i, t: s / len });
    carry += (Math.floor((len - carry) / step) + 1) * step - len;
  }
  return out;
}
