import { Builder, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';
import { CITY_TERRACE_EDGES, cityShelfPoint, roadClearance } from '../layout';
import type { HouseSpec } from './house';
import * as THREE from 'three';

/** Short retaining walls follow irregular shelves, with gaps for every street and plot. */
export function buildTerraceWalls(b: Builder, plots: HouseSpec[]): void {
  for (const q of CITY_TERRACE_EDGES) for (let i = 0; i < 200; i++) {
    const a = cityShelfPoint(i / 200 * Math.PI * 2, q), c = cityShelfPoint((i + 1) / 200 * Math.PI * 2, q);
    const x = (a[0] + c[0]) / 2, z = (a[1] + c[1]) / 2;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if ([a, c, [x, z]].some(([px, pz]) => roadClearance(px, pz) < 3.5)) continue;
    if (plots.some((h) => Math.hypot(h.x - x, h.z - z) < Math.hypot(h.w, h.d) / 2 + len / 2 + 1.2)) continue;
    const base = Math.min(heightAt(...a), heightAt(...c)) - 0.7;
    const top = Math.max(heightAt(...a), heightAt(...c)) + 1.6;
    const theta = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
    const profile = new THREE.Shape(); profile.moveTo(-len / 2, base); profile.lineTo(len / 2, base);
    profile.lineTo(len / 2, top); profile.lineTo(-len / 2, top); profile.closePath();
    b.shape('stone', profile, 0.75, place(x, 0, z, theta), i % 4 ? 0xb0ab94 : 0xa2ab87);
    b.box('stone', x, top, z, len + 0.1, 0.15, 0.9, theta, 0xc2baa3, 0);
    addBox(x, z, len / 2, 0.42, theta, top + 0.15);
  }
}
