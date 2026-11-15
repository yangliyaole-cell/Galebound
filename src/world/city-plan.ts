import { clamp, lerp, sfbm, sstep } from './gen/noise';
import { CITY, CITY_SQUARES, CITY_STREETS, SOUTH_GATE, cityRadiusAt, squareDistance, type CitySquare, type Pt, type Road } from './layout';

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
// Where another street meets or crosses the avenue it does so on a level landing: a street is cut
// level across, so it cannot cross a flight of steps. Intervals are metres along the avenue.
const AVENUE = CITY_STREETS.find((r) => r.id === 'avenue');
const avenueS: number[] = [0];
if (AVENUE) for (let i = 1; i < AVENUE.pts.length; i++) avenueS.push(avenueS[i - 1] + Math.hypot(AVENUE.pts[i][0] - AVENUE.pts[i - 1][0], AVENUE.pts[i][1] - AVENUE.pts[i - 1][1]));
const avenueLandings: [number, number][] = [];
if (AVENUE) {
  const along = (x: number, z: number): { s: number; d: number } => {
    let best = { s: 0, d: Infinity };
    for (let i = 0; i < AVENUE.pts.length - 1; i++) {
      const a = AVENUE.pts[i], b = AVENUE.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
      if (d < best.d) best = { s: avenueS[i] + (avenueS[i + 1] - avenueS[i]) * t, d };
    }
    return best;
  };
  for (const other of CITY_STREETS) {
    if (other === AVENUE) continue;
    other.pts.forEach(([x, z], i) => {
      const hit = along(x, z), reach = other.widths[i] / 2 + 2.5;
      if (hit.d < AVENUE.widths[0] / 2 + 1.5 && !CITY_SQUARES.some((q) => squareDistance(q, x, z) < 2)) avenueLandings.push([hit.s - reach, hit.s + reach]);
    });
  }
  avenueLandings.sort((a, b) => a[0] - b[0]);
  for (let k = avenueLandings.length - 1; k > 0; k--) {
    if (avenueLandings[k][0] <= avenueLandings[k - 1][1]) {
      avenueLandings[k - 1][1] = Math.max(avenueLandings[k - 1][1], avenueLandings[k][1]);
      avenueLandings.splice(k, 1);
    }
  }
}
/** Metres of avenue between s0 and s1 not taken by landings: the run the steps can use. */
function avenueRun(s0: number, s1: number): number {
  let run = s1 - s0;
  for (const [a, b] of avenueLandings) run -= Math.max(0, Math.min(b, s1) - Math.max(a, s0));
  return Math.max(run, 1e-3);
}

// The squares on the processional axis share its climb out evenly: the gate square sits just above
// the gate, the forecourt keeps its height, and the market stands where an even grade puts it.
{
  const at = (id: string): CitySquare | undefined => CITY_SQUARES.find((q) => q.id === id);
  const gate = at('gate'), market = at('market'), fore = at('forecourt');
  if (gate && market && fore && AVENUE) {
    // Arc length along the avenue of each square's near and far rims.
    const rims = (q: CitySquare): [number, number] => {
      const inside = AVENUE.pts.map((p, i) => (squareDistance(q, p[0], p[1]) < 1.2 ? avenueS[i] : NaN)).filter((v) => !Number.isNaN(v));
      return [Math.min(...inside), Math.max(...inside)];
    };
    const g = Math.round((cityBase(SOUTH_GATE.x, SOUTH_GATE.z) + 2) * 4) / 4, f = squareLevel.get(fore)!;
    const lower = avenueRun(rims(gate)[1], rims(market)[0]), upper = avenueRun(rims(market)[1], rims(fore)[0]);
    squareLevel.set(gate, g);
    squareLevel.set(market, Math.round((g + (f - g) * lower / (lower + upper)) * 4) / 4);
  }
}

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
  if (street.id === 'avenue') h = terraceAvenue(street, h, pins);
  streetProfiles.set(street, h);
}

/**
 * The avenue climbs as a processional way: broad flights of steps at an even pitch,
 * each ending on a short landing. Squares stay pinned at their own levels.
 */
function terraceAvenue(_road: Road, h: number[], pins: (number | undefined)[]): number[] {
  const s = avenueS;
  const anchors = h.map((_v, i) => (i === 0 || i === h.length - 1 || pins[i] !== undefined ? i : -1)).filter((i) => i >= 0);
  const out = [...h];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k], b = anchors[k + 1], rise = h[b] - h[a];
    const run = avenueRun(s[a], s[b]);
    if (s[b] - s[a] < 12 || Math.abs(rise) < 1) continue;
    // Flights about every 18 m of free run; each ends on a short landing while the pitch allows.
    const flights = Math.max(1, Math.round(run / 18)), stair = clamp(Math.abs(rise) / run / 0.62, 0.82, 1);
    for (let i = a + 1; i < b; i++) {
      const u = avenueRun(s[a], s[i]) / run * flights, n = Math.min(flights - 1, Math.floor(u)), f = u - n;
      out[i] = h[a] + rise * (n + Math.min(1, f / stair)) / flights;
    }
  }
  return out;
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
