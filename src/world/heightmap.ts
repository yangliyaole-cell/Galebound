import * as THREE from 'three';
import { fbm } from './noise';
import { referenceLandform } from './scenes/landform';
import { hornMetric, rockRelief } from './scenes/geology';
import { ALPINE_LAKES, alpineLakeMetric, alpineChannel, showcaseChannel, waterLevelAt } from './mountain-layout';
import { PLUNGE_POOL, SHOWCASE_FALL } from './scenes/plan';
import { ABBEY, CITY, HALF, HILLS, LATE_HILLS, PLATEAU, RIVER, ROADS, SIZE, START, CITY_TERRACE_EDGES, cityTerraceMetric, cityRadiusAt, lakeMetric, riverWidthAt, distToPolyline } from './layout';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
/** Smoothstep that also accepts a > b, for falling edges. */
export function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const smax = (a: number, b: number, k: number): number => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k));

function riverDistance(x: number, z: number): number {
  if (x < -560 || x > 860 || z < -520) return 999;
  return distToPolyline(x, z, RIVER);
}

const band = (edge: number, width: number): number => 1 - sstep(20, width, edge);

/** The shape of the land, before it is sampled onto a grid. */
function analyticHeight(x: number, z: number): number {
  let h = 7 + (fbm(x / 260 + 3.1, z / 260 - 1.7, 4) - 0.5) * 36 + (fbm(x / 70 + 9, z / 70 - 4, 3) - 0.5) * 6;
  h = smax(h, 2.6, 8);

  // The river valley and lake shore are pressed nearly flat.
  const dr = riverDistance(x, z);
  h = lerp(3.0 + (h - 3.0) * 0.18, h, sstep(25, 170, dr));
  const dl = lakeMetric(x, z);
  h = lerp(3.0 + (h - 3.0) * 0.2, h, sstep(1.1, 1.9, dl));

  // A weathered ridge with a broad palace shelf, shoulders and uneven terraces.
  const r = Math.hypot(x - CITY.x, z - CITY.z);
  const a = Math.atan2(z - CITY.z, x - CITY.x);
  const dc = r / (0.65 + 0.35 * cityRadiusAt(a) / CITY.wall);
  const cityBlend = 1 - sstep(CITY.plateau, CITY.hill, dc);
  const shoulder = Math.sin(a * 3 + dc * 0.018) * 5 + Math.cos(a * 5 - 0.5) * 3;
  h = lerp(h, 5 + CITY.top * Math.pow(cityBlend, 0.82) + shoulder * sstep(85, 140, r),
    1 - sstep(CITY.hill * 0.88, CITY.hill * 1.15, dc));
  // Exactly level inside the palace; cliffs soften into the city's inhabited terraces.
  h = lerp(h, CITY.top + 5, 1 - sstep(84, 103, r));

  for (const hill of HILLS) {
    const d2 = (x - hill.x) * (x - hill.x) + (z - hill.z) * (z - hill.z);
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }

  const pd =
    Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz) +
    (fbm(x / 55 + 1, z / 55 + 8, 2) - 0.5) * 0.22;
  h += PLATEAU.h * (1 - sstep(0.7, 1.05, pd));

  const rw = riverWidthAt(x, z);
  if (dr < rw + 9) h = lerp(-2.8, h, sstep(rw * 0.57, rw + 8, dr));
  h = lerp(h, -7, sstep(1.0, 0.5, dl));

  const coast = 545 + (fbm(x / 190 + 2, 7.7, 3) - 0.5) * 190 + 24 * Math.sin(x / 47) + 12 * Math.sin(x / 23);
  h = lerp(h, -14, sstep(coast - 80, coast + 50, z));

  for (const hill of LATE_HILLS) {
    const d2 = (x - hill.x) * (x - hill.x) + (z - hill.z) * (z - hill.z);
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }

  // Mountains wall off the north, west and east; the south is open sea.
  const fadeSouth = 1 - sstep(360, 560, z);
  // The west range is the tall, snowy one; the north is kept low so the city
  // stands against the sky.
  const west = band(x + HALF, 330) * fadeSouth;
  const east = band(HALF - x, 300) * fadeSouth;
  const north = band(z + HALF, 250);
  const m = Math.max(west, east, north);
  if (m > 0) {
    const total = west + east + north;
    const peak = (west * 330 + east * 210 + north * 150) / total;
    const ridge = fbm(x / 150 + 5, z / 150 + 2, 4);
    const sharp = 1 - Math.abs(fbm(x / 60, z / 60, 3) * 2 - 1);
    h += Math.pow(m, 1.35) * peak * (0.55 + 0.75 * ridge + 0.18 * sharp * m);
  }
  // A few dominant glacial horns break the broad mountain rim into distinct peaks.
  for (const [px, pz, radius, rise] of [[-939, -775, 145, 210], [-900, -972, 122, 175], [-736, -988, 103, 145]]) {
    const d = hornMetric(x, z, px, pz, radius);
    if (d < 1) h += rise * Math.pow(1 - d, 0.94);
  }
  // Preserve the palace silhouette while breaking the outer town into inhabited
  // contour shelves. Override the mountain rim here so the palace remains highest.
  const edge = cityRadiusAt(a);
  if (r < edge + 65) {
    const q = cityTerraceMetric(x, z);
    const steps = CITY_TERRACE_EDGES.reduce((sum, t) => sum + sstep(t - 0.028, t + 0.028, q), 0);
    const ridge = (Math.sin(a * 2 + 0.5) * 2.2 + Math.cos(a * 5) * 1.1) * sstep(92, 140, r);
    const shelf = CITY.top + 5 - steps * 6 + ridge;
    h = lerp(h, shelf, 1 - sstep(edge - 1, edge + 65, r));
  }
  // Abbey cliff and its southern approach. The interior and threshold share one plane.
  const abbeyD = Math.hypot((x - ABBEY.x) / 51, (z - ABBEY.z) / 64);
  const approach = (1 - sstep(25, 62, Math.abs(x - ABBEY.x))) *
    (1 - sstep(-445, -285, z)) * sstep(-550, -475, z);
  if (approach > 0) h = Math.max(h, ABBEY.floor * approach);
  h = lerp(h, ABBEY.floor, 1 - sstep(0.82, 1.3, abbeyD));
  h = referenceLandform(x, z, h);
  // Nested glacial basins and their descending stream cut into the western foothills.
  if (x > -835 && x < -480 && z > -870 && z < -305) {
    for (const lake of ALPINE_LAKES) {
      const d = alpineLakeMetric(x, z, lake);
      if (d < 1.6) {
        const bed = lake.level - 6 + 9 * sstep(0.35, 1.3, d);
        h = lerp(h, bed, 1 - sstep(1.05, 1.6, d));
      }
    }
    const stream = alpineChannel(x, z);
    if (stream.distance < 17) h = lerp(stream.level - 2.2, h, sstep(3.5, 17, stream.distance));
  }
  // Fracture exposed canyon shoulders after basin/stream incision. Keep the
  // open water bed, abbey footprint and road grading as their own authorities.
  if (x > -855 && x < -635 && z > -820 && z < -452) {
    const stream = alpineChannel(x, z);
    const lakeRim = Math.min(...ALPINE_LAKES.map((lake) => alpineLakeMetric(x, z, lake)));
    if (stream.distance > 12 && lakeRim > 1.13 && h > 22) h += rockRelief(x, h, z) * 2.1;
  }
  if(x > -885 && x < -715 && z > -820 && z < -635){
    const f=SHOWCASE_FALL,dx=f.bx-f.x,dz=f.bz-f.z,len=Math.hypot(dx,dz);
    const t=((x-f.x)*dx+(z-f.z)*dz)/(len*len),d=Math.abs((x-f.x)*dz-(z-f.z)*dx)/len;
    // Cut a broad hanging face, then let the airborne water descend clear of it.
    if(t>=-.22&&t<=1.12&&d<f.width*.8){
      const face=f.y-2-(f.y-f.bottom+3)*sstep(.04,.55,Math.max(0,t));
      const weight=1-sstep(f.width*.48,f.width*.8,d);
      h=lerp(h,t<0?Math.max(h,f.y-2):Math.min(h,face),weight);
    }
    const pool=Math.hypot((x-PLUNGE_POOL.x)/PLUNGE_POOL.rx,(z-PLUNGE_POOL.z)/PLUNGE_POOL.rz);
    if(pool<1.4)h=lerp(h,PLUNGE_POOL.level-5+5*sstep(.35,1.2,pool),1-sstep(.95,1.4,pool));
    const flow=showcaseChannel(x,z);
    if(flow.distance<12)h=lerp(flow.level-2.7,h,sstep(3.8,12,flow.distance));
  }
  return h;
}

let cell = 4;
let n = SIZE / cell;
let data = new Float32Array(0);

export function buildHeightmap(cellSize: number): void {
  cell = cellSize;
  n = SIZE / cell;
  const row = n + 1;
  data = new Float32Array(row * row);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      data[j * row + i] = analyticHeight(i * cell - HALF, j * cell - HALF);
    }
  }
  gradeRoadbeds();
}

/** Linear-time local earthwork: preserve each crest and ease approaches below a
 * 0.72 grade. Work only in narrow road corridors, never across an open water bed. */
function gradeRoadbeds(): void {
  const row = n + 1;
  const core = new Set<number>();
  for (const road of ROADS) {
    if (road.bridge) continue;
    const heights = road.pts.map(([x, z]) => heightAt(x, z));
    for (let i = 1; i < heights.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      heights[i] = Math.max(heights[i], heights[i - 1] - 0.72 * Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    for (let i = heights.length - 2; i >= 0; i--) {
      const a = road.pts[i], b = road.pts[i + 1];
      heights[i] = Math.max(heights[i], heights[i + 1] - 0.72 * Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const grades = new Map<number, { d: number; target: number; reach: number }>();
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const reach = Math.max(road.widths[i], road.widths[i + 1]) / 2 + cell * 2 + 4;
      const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach + HALF) / cell));
      const x1 = Math.min(n, Math.ceil((Math.max(a[0], b[0]) + reach + HALF) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach + HALF) / cell));
      const z1 = Math.min(n, Math.ceil((Math.max(a[1], b[1]) + reach + HALF) / cell));
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) {
        const x = k * cell - HALF, z = j * cell - HALF;
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        const o = j * row + k;
        if (d >= reach || data[o] < waterLevelAt(x, z) + 0.3 || Math.hypot(x - START.x, z - START.z) < 80) continue;
        if (d < Math.max(road.widths[i], road.widths[i + 1]) / 2 + cell * 1.5) core.add(o);
        const target = heights[i] + (heights[i + 1] - heights[i]) * t;
        if (d < (grades.get(o)?.d ?? Infinity)) grades.set(o, { d, target, reach });
      }
    }
    for (const [o, g] of grades) data[o] = lerp(data[o], g.target, 1 - sstep(g.reach - cell, g.reach, g.d));
  }
  // At junctions two independently graded lanes must agree. A max-heap propagates
  // the minimum necessary embankment through the road-core grid (O(N log N)).
  const heap: [number, number][] = [];
  const push = (o: number, h: number): void => {
    let i = heap.length; heap.push([o, h]);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][1] >= h) break; heap[i] = heap[p]; i = p; }
    heap[i] = [o, h];
  };
  for (const o of core) push(o, data[o]);
  while (heap.length) {
    const [o, h] = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][1] > heap[c][1]) c++;
        if (heap[c][1] <= last[1]) break; heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    if (h < data[o] - 0.0001) continue;
    for (const q of [o - 1, o + 1, o - row, o + row]) {
      const target = h - cell * 0.52;
      if (core.has(q) && data[q] < target - 0.0001) { data[q] = target; push(q, data[q]); }
    }
  }

}

export function grid(): { cell: number; n: number; data: Float32Array } {
  return { cell, n, data };
}

/** Exact height of the terrain mesh, including its triangle split. */
export function heightAt(x: number, z: number): number {
  const gx = clamp((x + HALF) / cell, 0, n - 1e-4);
  const gz = clamp((z + HALF) / cell, 0, n - 1e-4);
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const row = n + 1;
  const o = j * row + i;
  const a = data[o];
  const b = data[o + 1];
  const c = data[o + row];
  const d = data[o + row + 1];
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

export function normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = cell * 0.6;
  return out
    .set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e))
    .normalize();
}

/** Height as a texture, so shaders can place grass and shade water depth. */
export function createHeightTexture(): THREE.DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, n + 1, n + 1, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
