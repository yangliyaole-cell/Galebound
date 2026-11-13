import * as THREE from 'three';
import { fbm } from './noise';
import { ALPINE_LAKES, alpineLakeMetric, alpineChannel, waterLevelAt } from './mountain-layout';
import { ABBEY, CITY, HALF, HILLS, LATE_HILLS, PLATEAU, RIVER, ROADS, SIZE, cityRadiusAt, lakeMetric, riverWidthAt, distToPolyline } from './layout';

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
    const d = Math.hypot(x - px, z - pz) / radius;
    if (d < 1) h += rise * Math.pow(1 - d, 1.45) * (0.9 + 0.1 * Math.sin(Math.atan2(z - pz, x - px) * 5));
  }
  // Abbey cliff and its southern approach. The interior and threshold share one plane.
  const abbeyD = Math.hypot((x - ABBEY.x) / 51, (z - ABBEY.z) / 64);
  const approach = (1 - sstep(25, 62, Math.abs(x - ABBEY.x))) *
    (1 - sstep(-445, -285, z)) * sstep(-550, -475, z);
  h = Math.max(h, ABBEY.floor * approach);
  h = lerp(h, ABBEY.floor, 1 - sstep(0.82, 1.3, abbeyD));
  // Nested glacial basins and their descending stream cut into the western foothills.
  if (x > -810 && x < -480 && z > -825 && z < -305) {
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
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const reach = Math.max(road.widths[i], road.widths[i + 1]) / 2 + 5;
      const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach + HALF) / cell));
      const x1 = Math.min(n, Math.ceil((Math.max(a[0], b[0]) + reach + HALF) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach + HALF) / cell));
      const z1 = Math.min(n, Math.ceil((Math.max(a[1], b[1]) + reach + HALF) / cell));
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) {
        const x = k * cell - HALF, z = j * cell - HALF;
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        const o = j * row + k;
        if (d >= reach || data[o] < waterLevelAt(x, z) + 0.3) continue;
        const target = heights[i] + (heights[i + 1] - heights[i]) * t;
        data[o] = Math.max(data[o], lerp(data[o], target, 1 - sstep(reach - 4, reach, d)));
      }
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
