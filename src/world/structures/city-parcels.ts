import { heightAt } from '../heightmap';
import { CITY, CITY_STREETS, cityTerraceMetric, insideCity, roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { ROOFS, SHUTTERS, SLATES, WALLS, type HouseSpec } from './house';

export const CITY_HOUSE_TARGET = 360;
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
/** Compact, deterministic plots; shared by construction and the numerical audit. */
export function planCityParcels(keepOut: { x: number; z: number; r: number }[], aqueductClear: (x: number, z: number) => number): HouseSpec[] {
  const rand = seededRandom(9127), plots: HouseSpec[] = [];
  const cells = new Map<string, { x: number; z: number; r: number; w: number; d: number; rot: number }[]>();
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const offer = (x: number, z: number, rot: number): void => {
    if (plots.length >= CITY_HOUSE_TARGET) return;
    const q = cityTerraceMetric(x, z);
    const w = 5.8 + rand() * 2.7, d = 5.7 + rand() * 2.4;
    const r = Math.hypot(w + 1, d + 1) / 2 + 0.15;
    if (!insideCity(x, z, r + 6) || Math.hypot(x - CITY.x, z - CITY.z) < 92 + r) return;
    if (roadClearance(x, z) < Math.min(w, d) / 2 + 0.7 || aqueductClear(x, z) < r + 3.8) return;
    if (keepOut.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r)) return;
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
      if (cells.get(`${ix},${iz}`)?.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r + 0.15 && cityPlotsOverlap({ x, z, w, d, rot }, p))) return;
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    if (corners.some(([u, v]) => roadClearance(x + u * c + v * s, z - u * s + v * c) < 0.65)) return;
    const heights = corners.map(([u, v]) => heightAt(x + u * c + v * s, z - u * s + v * c));
    if (Math.max(...heights) - Math.min(...heights) > 5.8) return;
    const key = `${gx},${gz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push({ x, z, r, w, d, rot });
    plots.push({
      x, z, w, d, rot, floors: q < 0.55 ? 3 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 4),
      roof: rand() < 0.24 ? pick(SLATES) : pick(ROOFS), wall: pick(WALLS),
      timber: rand() < 0.38, shutters: pick(SHUTTERS), chimney: rand() < 0.65,
      ridgeAlongFront: rand() < 0.58, simple: 2,
    });
  };
  // Street frontage first, followed by compact back lots; no concentric house rings.
  for (const street of CITY_STREETS) {
    let travel = 0, next = rand() * 5;
    for (let i = 0; i < street.pts.length - 1; i++) {
      const a = street.pts[i], b = street.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      while (next < travel + len) {
        const t = (next - travel) / len; next += 7.5 + rand() * 3;
        for (let row = 0; row < 3; row++) for (const side of [-1, 1]) {
          const off = street.widths[i] / 2 + 5.2 + row * (9.0 + rand() * 1.1);
          offer(a[0] + dx * t - dz / len * off * side, a[1] + dz * t + dx / len * off * side,
            Math.atan2(dz / len * side, -dx / len * side) + (rand() - 0.5) * 0.10);
        }
      }
      travel += len;
    }
  }
  // Fill vacant contour parcels by rejection sampling, rather than a house grid.
  for (let attempt = 0; plots.length < CITY_HOUSE_TARGET && attempt < 24000; attempt++) {
    const x = CITY.x + (rand() - 0.5) * 610, z = CITY.z + (rand() - 0.5) * 610;
    if (!insideCity(x, z, 12)) continue;
    let distance = Infinity, rot = 0;
    for (const street of CITY_STREETS) for (let i = 0; i < street.pts.length - 1; i++) {
      const a = street.pts[i], b = street.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const nx = a[0] + t * dx - x, nz = a[1] + t * dz - z, d = Math.hypot(nx, nz);
      if (d < distance) { distance = d; rot = Math.atan2(nx, nz); }
    }
    if (distance > 28) {
      rot = Math.atan2(heightAt(x - 3, z) - heightAt(x + 3, z), heightAt(x, z - 3) - heightAt(x, z + 3));
    }
    offer(x, z, rot);
  }
  return plots;
}
