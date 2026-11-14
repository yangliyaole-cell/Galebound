import { heightAt } from '../heightmap';
import { CITY, CITY_STREETS, cityTerraceMetric, insideCity, roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { ROOFS, SHUTTERS, SLATES, WALLS, type HouseSpec } from './house';

export const CITY_HOUSE_TARGET = 1100;
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
/** Compact, deterministic plots; shared by construction and the numerical audit.
 * Houses stand in terraced rows: shoulder to shoulder along every street, with
 * further rows built back to back behind them, as in an old hill town. */
export function planCityParcels(keepOut: { x: number; z: number; r: number }[], aqueductClear: (x: number, z: number) => number): HouseSpec[] {
  const rand = seededRandom(9127), plots: HouseSpec[] = [];
  const cells = new Map<string, { x: number; z: number; r: number; w: number; d: number; rot: number }[]>();
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  /** Tries one plot; returns whether it was built. `gap` is the clearance kept to every neighbour. */
  const offer = (x: number, z: number, rot: number, w: number, d: number, gap: number, frontage: boolean): boolean => {
    if (plots.length >= CITY_HOUSE_TARGET) return false;
    const q = cityTerraceMetric(x, z);
    const r = Math.hypot(w, d) / 2 + gap;
    if (!insideCity(x, z, r + 4) || Math.hypot(x - CITY.x, z - CITY.z) < 92 + r) return false;
    if (aqueductClear(x, z) < r + 3.8) return false;
    if (keepOut.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r)) return false;
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
      if (cells.get(`${ix},${iz}`)?.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r && cityPlotsOverlap({ x, z, w, d, rot }, p, gap / 2))) return false;
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, d / 2], [0, -d / 2]];
    // The whole outline, not just its corners, must keep clear of every street (curved lanes bulge between corners).
    const outline: number[][] = [];
    for (let i = 0; i <= 4; i++) for (const k of [-1, 1]) outline.push([(-0.5 + i / 4) * w, k * d / 2], [k * w / 2, (-0.5 + i / 4) * d]);
    if (outline.some(([u, v]) => roadClearance(x + u * c + v * s, z - u * s + v * c) < 0.35)) return false;
    const heights = corners.map(([u, v]) => heightAt(x + u * c + v * s, z - u * s + v * c));
    if (Math.max(...heights) - Math.min(...heights) > 7.5) return false;
    const key = `${gx},${gz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push({ x, z, r: Math.hypot(w, d) / 2, w, d, rot });
    plots.push({
      x, z, w, d, rot,
      floors: q < 0.55 ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2 + rand()),
      roof: rand() < 0.12 ? pick(SLATES) : pick(ROOFS), wall: pick(WALLS),
      timber: rand() < 0.34, shutters: pick(SHUTTERS), chimney: rand() < 0.7,
      // Street rows mostly turn their eaves to the street; a few gables break the line.
      ridgeAlongFront: frontage ? rand() < 0.78 : rand() < 0.55, simple: 2,
    });
    return true;
  };
  // Rows along both sides of every street.
  for (const street of CITY_STREETS) {
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      let setback = 0;
      let travel = 0, next = rand() * 3;
      const depth = 6.8 + rand() * 2.6;
      for (let i = 0; i < street.pts.length - 1; i++) {
        const a = street.pts[i], b = street.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const half = street.widths[i] / 2 + 0.35;
        // Row 0 fronts the street; rows 1 and 2 stand back to back behind it, across a narrow yard.
        setback = half + (row === 0 ? depth / 2 : row === 1 ? depth + 1.6 + (depth * 0.9) / 2 : depth * 1.9 + 4.2 + depth / 2);
        while (next < travel + len) {
          const t = (next - travel) / len;
          const w = 4.4 + rand() * 3.4;
          const x = a[0] + dx * t - dz / len * setback * side, z = a[1] + dz * t + dx / len * setback * side;
          // The front faces the street for row 0; back rows face away from it, onto their own lane.
          const facing = Math.atan2(dz / len * side, -dx / len * side) + (row === 1 ? Math.PI : 0) + (rand() - 0.5) * 0.04;
          const d = row === 1 ? depth * 0.9 : depth;
          next += offer(x, z, facing, w, d, 0.04, row === 0) ? w + 0.02 + (rand() < 0.08 ? 2.5 + rand() * 2 : 0) : 1.6;
        }
        travel += len;
      }
    }
  }
  // Fill what remains: small rows of two to four houses on the contours, then single houses.
  for (let attempt = 0; plots.length < CITY_HOUSE_TARGET && attempt < 40000; attempt++) {
    const x = CITY.x + (rand() - 0.5) * 610, z = CITY.z + (rand() - 0.5) * 610;
    if (!insideCity(x, z, 8)) continue;
    // Rows follow the hillside: their length runs along the contour.
    const rot = Math.atan2(heightAt(x - 3, z) - heightAt(x + 3, z), heightAt(x, z - 3) - heightAt(x, z + 3));
    const w = 4.6 + rand() * 3.2, d = 6.4 + rand() * 2.8;
    if (!offer(x, z, rot, w, d, attempt < 30000 ? 0.05 : 0.6, false)) continue;
    const c = Math.cos(rot), s = Math.sin(rot);
    let u = w / 2;
    for (let k = 0, n = Math.floor(rand() * 4); k < n; k++) {
      const w2 = 4.4 + rand() * 3.2;
      u += w2 / 2 + 0.02;
      if (!offer(x + u * c, z - u * s, rot, w2, d, 0.04, false)) break;
      u += w2 / 2;
    }
  }
  return plots;
}
