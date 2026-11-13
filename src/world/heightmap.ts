import * as THREE from 'three';
import { fbm } from './noise';
import { CITY, HALF, HILLS, LAKE, LATE_HILLS, PLATEAU, RIVER, SIZE, distToPolyline } from './layout';

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
  const dl = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  h = lerp(3.0 + (h - 3.0) * 0.2, h, sstep(1.1, 1.9, dl));

  // The city sits on a smooth cone with a flat top for the castle.
  const dc = Math.hypot(x - CITY.x, z - CITY.z);
  h = lerp(h, 4.5, (1 - sstep(CITY.hill * 0.7, CITY.hill, dc)) * 0.85);
  h += CITY.top * Math.pow(1 - sstep(CITY.plateau, CITY.hill, dc), 1.15);

  for (const hill of HILLS) {
    const d2 = (x - hill.x) * (x - hill.x) + (z - hill.z) * (z - hill.z);
    h += hill.h * Math.exp(-d2 / (hill.r * hill.r));
  }

  const pd =
    Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz) +
    (fbm(x / 55 + 1, z / 55 + 8, 2) - 0.5) * 0.22;
  h += PLATEAU.h * (1 - sstep(0.7, 1.05, pd));

  if (dr < 22) h = lerp(-2.4, h, sstep(6, 20, dr));
  h = lerp(h, -7, sstep(1.0, 0.5, dl));

  const coast = 545 + (fbm(x / 190 + 2, 7.7, 3) - 0.5) * 150;
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
