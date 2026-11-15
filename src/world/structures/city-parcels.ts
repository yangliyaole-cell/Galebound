import { heightAt } from '../heightmap';
import { CITY, CITY_SQUARES, CITY_STREETS, cityTerraceMetric, citySquareAt, insideCity, roadClearance, squareDistance } from '../layout';
import { sfbm } from '../gen/noise';
import { nearestStreet } from '../city-plan';
import { seededRandom } from '../noise';
import { ASHLARS, BRICKS, SHUTTERS, SLATES, TOWN_ROOFS, TOWN_WALLS, type HouseSpec } from './house';

export const CITY_HOUSE_TARGET = 2600;
/** Why plots were refused, for tuning. */
export const parcelRejects: Record<string, number> = {};
const reject = (why: string): false => { parcelRejects[why] = (parcelRejects[why] ?? 0) + 1; return false; };
/** Separating-axis test for roof overhangs and narrow gaps between adjoining plots. */
export function cityPlotsOverlap(a: Pick<HouseSpec, 'x' | 'z' | 'w' | 'd' | 'rot'>, b: Pick<HouseSpec, 'x' | 'z' | 'w' | 'd' | 'rot'>, padding = 0.6): boolean {
  const ac = Math.cos(a.rot), as = Math.sin(a.rot), bc = Math.cos(b.rot), bs = Math.sin(b.rot);
  const axes = [[ac, -as], [as, ac], [bc, -bs], [bs, bc]];
  for (const [x, z] of axes) {
    const ra = Math.abs(x * ac - z * as) * (a.w / 2 + padding) + Math.abs(x * as + z * ac) * (a.d / 2 + padding);
    const rb = Math.abs(x * bc - z * bs) * (b.w / 2 + padding) + Math.abs(x * bs + z * bc) * (b.d / 2 + padding);
    if (Math.abs((b.x - a.x) * x + (b.z - a.z) * z) >= ra + rb + 0.1) return false;
  }
  return true;
}
/**
 * How continuously each street is built up, per side (-1: left, 1: right, looking
 * along the street). The busy streets are solid rows; the lane under the wall is
 * mostly gardens, and the castle ring has the crag on its inner side.
 */
const FRONTAGE: Record<string, [number, number]> = {
  avenue: [1, 1], 'high-street': [1, 1], 'middle-ring': [0.95, 0.95], 'east-street': [1, 1],
  'castle-ring': [0.9, 0.9], 'lower-ring': [0.8, 0.8], 'wall-lane': [0.45, 0], 'wall-lane-west': [0.45, 0],
};
/** What a house fronts onto decides how likely it is to keep a shop or an arcade. */
type Frontage = 'market' | 'square' | 'main' | 'street' | 'lane' | 'grand' | 'yard';
const SHOP_CHANCE: Record<Frontage, number> = { market: 0.75, square: 0.4, main: 0.45, street: 0.12, lane: 0.04, grand: 0.35, yard: 0 };
const AWNINGS = [0xc9482f, 0x3f6f9a, 0x4f8a5a, 0xe0b040, 0xa8456a, 0xd9773a];
const GOODS = [
  [0xc8402f, 0xe08a2e, 0x6aa043, 0xd9b44a], [0xd9a35a, 0xc4883e, 0xe8c27a], [0x5a6fb0, 0xb04a5a, 0xe0c060, 0x4f8a6a],
  [0xb5653d, 0x8a5a3a, 0xd8c8a8], [0xf0d070, 0xe8b850, 0xf6e6b0], [0x8a4aa0, 0x6aa043, 0xe35b6a],
];
const VINE_FLOWERS = [0xa58ad6, 0xe57a9a, 0xf4efe8, 0xb48ad8];

/** Everything about a town house beyond its footprint, drawn from one seeded stream. */
function dress(p: { x: number; z: number; w: number; d: number; rot: number; q: number; frontage: boolean; kind: Frontage }, rand = dressRand): HouseSpec {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const grand = p.kind === 'grand';
  // Back-lot buildings: workshops, warehouses, guild and courtyard halls, broad and low.
  const yard = p.kind === 'yard';
  const tower = !grand && !yard && p.kind !== 'lane' && p.w < 6.6 && rand() < 0.05;
  // Avenue palazzi are dressed stone below and stand four or five storeys.
  // Fronts: limewashed plaster (often timbered), rubble masonry, brick or dressed ashlar.
  const front = rand();
  let facade: HouseSpec['facade'] = grand ? (front < 0.45 ? 'ashlar' : front < 0.6 ? 'brick' : undefined)
    : yard ? (front < 0.3 ? 'brick' : front < 0.42 ? 'ashlar' : undefined)
    : front < 0.15 ? 'brick' : front < 0.27 ? 'ashlar' : undefined;
  // Dressed stone comes in two kinds, smooth limestone and rusticated sandstone, chosen by place
  // (not by the seeded stream, so every plot keeps its other choices).
  if (facade === 'ashlar' && Math.floor(p.x * 0.37 + p.z * 0.23) % 2 === 0) facade = 'townAshlar';
  const masonry = !facade && (grand ? rand() < 0.5 : rand() < 0.36);
  const timber = !masonry && !facade && rand() < 0.4;
  const floors = yard ? (p.w > 11 ? 2 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 1.6)) : grand ? 4 + Math.floor(rand() * 2) : tower ? 5 + Math.floor(rand() * 2) : p.q < 0.5 ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2 + rand());
  const ridgeAlongFront = yard ? p.w >= p.d : grand ? rand() < 0.9 : p.frontage ? rand() < 0.75 : rand() < 0.55;
  const shop = !tower && rand() < SHOP_CHANCE[p.kind] && p.w > 5.2;
  const arcade = !shop && (grand || p.kind === 'market' || p.kind === 'square') && p.w >= 6 && rand() < (grand ? 0.8 : 0.55);
  const vine = rand() < 0.32;
  return {
    x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot, floors,
    roof: rand() < (facade === 'ashlar' || facade === 'townAshlar' ? 0.3 : 0.08) ? pick(SLATES) : pick(TOWN_ROOFS),
    wall: facade === 'brick' ? pick(BRICKS) : facade === 'ashlar' || facade === 'townAshlar' ? pick(ASHLARS) : pick(TOWN_WALLS), facade,
    timber, shutters: pick(SHUTTERS), chimney: rand() < 0.75, ridgeAlongFront, simple: 2,
    masonry, tower, jetty: timber && floors >= 3 && rand() < 0.6, hip: !tower && rand() < (yard && p.w > 11 ? 0.55 : 0.22),
    dormers: ridgeAlongFront && !tower && floors >= 2 && rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0,
    balcony: !tower && floors >= 2 && rand() < 0.2,
    shop: shop ? { awning: pick(AWNINGS), stripe: 0xf2ead8, sign: pick([0x6d4c33, 0x3f5f8a, 0x8a3a2a, 0x4a6a3a]), goods: pick(GOODS) } : undefined,
    arcade, vines: vine ? (rand() < 0.5 ? pick(VINE_FLOWERS) : null) : undefined, flowers: rand() < 0.55,
  };
}
let dressRand = seededRandom(5521);

/** Compact, deterministic plots; shared by construction and the numerical audit.
 * Houses stand shoulder to shoulder along the streets and round the squares, as in
 * an old hill town; behind the street fronts lie yards, gardens and orchards. */
export function planCityParcels(keepOut: { x: number; z: number; r: number }[], aqueductClear: (x: number, z: number) => number): HouseSpec[] {
  const rand = seededRandom(9127), plots: HouseSpec[] = [];
  dressRand = seededRandom(5521);
  const cells = new Map<string, { x: number; z: number; r: number; w: number; d: number; rot: number }[]>();
  /** Tries one plot; returns whether it was built. `gap` is the clearance kept to every neighbour. */
  const offer = (x: number, z: number, rot: number, w: number, d: number, gap: number, frontage: boolean, kind: Frontage = 'street', squarePad = 0.4): boolean => {
    if (plots.length >= CITY_HOUSE_TARGET) return reject('cap');
    const q = cityTerraceMetric(x, z);
    const r = Math.hypot(w, d) / 2 + gap;
    if (!insideCity(x, z, r + 5) || Math.hypot(x - CITY.x, z - CITY.z) < CITY.foot + 4 + r) return reject('bounds');
    if (aqueductClear(x, z) < r + 3.8) return reject('aqueduct');
    if (keepOut.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r)) return reject('keepout');
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
      if (cells.get(`${ix},${iz}`)?.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r && cityPlotsOverlap({ x, z, w, d, rot }, p, gap / 2))) return reject('overlap');
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, d / 2], [0, -d / 2]];
    // The whole outline, not just its corners, must keep clear of every street (curved lanes bulge between corners).
    const outline: number[][] = [];
    for (let i = 0; i <= 4; i++) for (const k of [-1, 1]) outline.push([(-0.5 + i / 4) * w, k * d / 2], [k * w / 2, (-0.5 + i / 4) * d]);
    if (outline.some(([u, v]) => roadClearance(x + u * c + v * s, z - u * s + v * c) < 0.3)) return reject('street');
    if (outline.some(([u, v]) => citySquareAt(x + u * c + v * s, z - u * s + v * c, squarePad))) return reject('square');
    const heights = corners.map(([u, v]) => heightAt(x + u * c + v * s, z - u * s + v * c));
    if (Math.max(...heights) - Math.min(...heights) > 7.5) return reject('slope');
    const key = `${gx},${gz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push({ x, z, r: Math.hypot(w, d) / 2, w, d, rot });
    plots.push(dress({ x, z, w, d, rot, q, frontage, kind }));
    return true;
  };
  const house = (w: number): number => w;
  // The grand avenue first: an unbroken wall of tall houses down both sides, from square to square.
  const avenue = CITY_STREETS.find((r) => r.id === 'avenue');
  if (avenue) for (const side of [-1, 1]) {
    let travel = 0, next = 0.5;
    for (let i = 0; i < avenue.pts.length - 1; i++) {
      const a = avenue.pts[i], b = avenue.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      while (next < travel + len) {
        const t = (next - travel) / len;
        const w = 6.8 + rand() * 2.4, depth = 11 + rand() * 2;
        const setback = avenue.widths[i] / 2 + 0.55 + depth / 2;
        const x = a[0] + dx * t - dz / len * setback * side, z = a[1] + dz * t + dx / len * setback * side;
        const facing = Math.atan2(dz / len * side, -dx / len * side);
        // Fronts may stand right on a square's edge; they only keep out of the square itself.
        next += offer(x, z, facing, w, depth, 0.03, true, 'grand', -0.6) ? w + 0.03 : 1.2;
      }
      travel += len;
    }
  }
  // Round every square first, fronts turned in to it.
  for (const q of CITY_SQUARES) {
    const depth = 8 + rand() * 2.5;
    const c = Math.cos(q.rot), s0 = Math.sin(q.rot);
    let a = rand();
    while (a < Math.PI * 2 + rand()) {
      // Walk the rim in angle; place where the rim plus half a depth lands.
      const dirX = Math.cos(a), dirZ = Math.sin(a);
      let lo = 0, hi = Math.hypot(q.rx, q.rz) + 20;
      for (let k = 0; k < 20; k++) {
        const m = (lo + hi) / 2;
        const x = q.x + (dirX * c + dirZ * s0) * m, z = q.z + (-dirX * s0 + dirZ * c) * m;
        if (squareDistance(q, x, z) < 1.4 + depth / 2) lo = m; else hi = m;
      }
      const x = q.x + (dirX * c + dirZ * s0) * lo, z = q.z + (-dirX * s0 + dirZ * c) * lo;
      const w = 6 + rand() * 4.5;
      const facing = Math.atan2(q.x - x, q.z - z);
      const built = offer(x, z, facing, house(w), depth, 0.04, true, q.kind === 'market' || q.kind === 'forecourt' ? 'market' : 'square');
      a += (built ? w + 0.05 : 2) / Math.max(4, lo);
    }
  }
  // Then shoulder to shoulder along the streets, and in a second pass a back row
  // across a narrow yard wherever the block is deep enough and not given to gardens.
  for (const pass of [0, 1]) for (const street of CITY_STREETS) {
    if (pass && (street.stairs || street.id.startsWith('wall-lane'))) continue;
    const density = FRONTAGE[street.id] ?? (street.stairs ? [0.85, 0.85] : [0.9, 0.9]);
    for (const side of [-1, 1]) {
      const fill = density[side < 0 ? 0 : 1];
      if (!fill) continue;
      let travel = 0, next = rand() * 3;
      for (let i = 0; i < street.pts.length - 1; i++) {
        const a = street.pts[i], b = street.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const half = street.widths[i] / 2 + 0.35;
        while (next < travel + len) {
          const t = (next - travel) / len;
          // Wider merchant houses on the main streets, narrow ones up the steps.
          const w = street.stairs ? 4.6 + rand() * 2.6 : 5.6 + rand() * 4.2 + (rand() < 0.12 ? 3 : 0);
          const depth = pass ? 7 + rand() * 2 : 7.5 + rand() * 3;
          // The back row stands behind the front one (about 10 m deep) across a 2-4 m yard.
          const setback = half + 0.2 + depth / 2 + (pass ? 12 + rand() * 2.5 : 0);
          const x = a[0] + dx * t - dz / len * setback * side, z = a[1] + dz * t + dx / len * setback * side;
          const facing = Math.atan2(dz / len * side, -dx / len * side) + (pass ? Math.PI : 0) + (rand() - 0.5) * 0.04;
          // Gaps in the row become yards and gardens, more of them where the street is quieter.
          const gap = pass ? sfbm(x / 70 + 4, z / 70 + 9, 2) < 0.05 : sfbm(x / 45 + 11, z / 45 - 3, 2) > fill * 1.2 - 0.6 || rand() > fill + 0.08;
          const kind: Frontage = street.stairs ? 'lane' : ['avenue', 'east-street', 'high-street'].includes(street.id) ? 'main' : 'street';
          next += !gap && offer(x, z, facing, house(w), depth, pass ? 0.3 : 0.04, !pass, pass ? 'lane' : kind) ? w + 0.02 : 1.4;
        }
        travel += len;
      }
    }
  }
  // Last, the open ground behind the rows: workshops, warehouses, guild halls and courtyard houses,
  // each turned to its nearest street across a narrow alley. A few gardens remain.
  const SIZES = [[15, 11], [12.5, 9.5], [10, 8.5], [8, 7], [6.5, 6]] as const;
  const span = CITY.wall + 10;
  for (let gz = CITY.z - span; gz <= CITY.z + span; gz += 6.5) for (let gx = CITY.x - span; gx <= CITY.x + span; gx += 6.5) {
    const x = gx + (rand() - 0.5) * 3, z = gz + (rand() - 0.5) * 3;
    if (!insideCity(x, z, 9) || Math.hypot(x - CITY.x, z - CITY.z) < CITY.foot + 8) continue;
    if (sfbm(x / 55 - 7, z / 55 + 2, 2) > 0.5) continue;
    const near = cells.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
    if (near?.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2.5)) continue;
    const hit = nearestStreet(x, z);
    // Away from any street, rows follow the hill's contours: fronts face up towards the castle.
    let facing = Math.atan2(CITY.x - x, CITY.z - z) + (rand() - 0.5) * 0.08;
    if (hit) {
      const a = hit.road.pts[hit.i], b = hit.road.pts[Math.min(hit.i + 1, hit.road.pts.length - 1)];
      facing = Math.atan2(a[0] + (b[0] - a[0]) * hit.t - x, a[1] + (b[1] - a[1]) * hit.t - z);
    }
    for (const [w, d] of SIZES) if (offer(x, z, facing, w, d, 1.1, false, 'yard')) break;
  }
  return plots;
}
