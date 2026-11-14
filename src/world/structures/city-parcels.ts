import { heightAt } from '../heightmap';
import { CITY, CITY_SQUARES, CITY_STREETS, cityTerraceMetric, citySquareAt, insideCity, roadClearance, squareDistance } from '../layout';
import { sfbm } from '../gen/noise';
import { seededRandom } from '../noise';
import { SHUTTERS, SLATES, TOWN_ROOFS, TOWN_WALLS, type HouseSpec } from './house';

export const CITY_HOUSE_TARGET = 1600;
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
type Frontage = 'market' | 'square' | 'main' | 'street' | 'lane';
const SHOP_CHANCE: Record<Frontage, number> = { market: 0.75, square: 0.4, main: 0.45, street: 0.12, lane: 0.04 };
const AWNINGS = [0xc9482f, 0x3f6f9a, 0x4f8a5a, 0xe0b040, 0xa8456a, 0xd9773a];
const GOODS = [
  [0xc8402f, 0xe08a2e, 0x6aa043, 0xd9b44a], [0xd9a35a, 0xc4883e, 0xe8c27a], [0x5a6fb0, 0xb04a5a, 0xe0c060, 0x4f8a6a],
  [0xb5653d, 0x8a5a3a, 0xd8c8a8], [0xf0d070, 0xe8b850, 0xf6e6b0], [0x8a4aa0, 0x6aa043, 0xe35b6a],
];
const VINE_FLOWERS = [0xa58ad6, 0xe57a9a, 0xf4efe8, 0xb48ad8];

/** Everything about a town house beyond its footprint, drawn from one seeded stream. */
function dress(p: { x: number; z: number; w: number; d: number; rot: number; q: number; frontage: boolean; kind: Frontage }, rand = dressRand): HouseSpec {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const tower = p.kind !== 'lane' && p.w < 6.6 && rand() < 0.05;
  const masonry = rand() < 0.45;
  const timber = !masonry && rand() < 0.38;
  const floors = tower ? 5 + Math.floor(rand() * 2) : p.q < 0.5 ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2 + rand());
  const ridgeAlongFront = p.frontage ? rand() < 0.75 : rand() < 0.55;
  const shop = !tower && rand() < SHOP_CHANCE[p.kind] && p.w > 5.2;
  const arcade = !shop && (p.kind === 'market' || p.kind === 'square') && p.w >= 6 && rand() < 0.55;
  const vine = rand() < 0.32;
  return {
    x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot, floors,
    roof: rand() < 0.08 ? pick(SLATES) : pick(TOWN_ROOFS), wall: pick(TOWN_WALLS),
    timber, shutters: pick(SHUTTERS), chimney: rand() < 0.75, ridgeAlongFront, simple: 2,
    masonry, tower, jetty: timber && floors >= 3 && rand() < 0.6, hip: !tower && rand() < 0.22,
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
  const offer = (x: number, z: number, rot: number, w: number, d: number, gap: number, frontage: boolean, kind: Frontage = 'street'): boolean => {
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
    if (outline.some(([u, v]) => citySquareAt(x + u * c + v * s, z - u * s + v * c, 0.4))) return reject('square');
    const heights = corners.map(([u, v]) => heightAt(x + u * c + v * s, z - u * s + v * c));
    if (Math.max(...heights) - Math.min(...heights) > 7.5) return reject('slope');
    const key = `${gx},${gz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push({ x, z, r: Math.hypot(w, d) / 2, w, d, rot });
    plots.push(dress({ x, z, w, d, rot, q, frontage, kind }));
    return true;
  };
  const house = (w: number): number => w;
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
  return plots;
}
