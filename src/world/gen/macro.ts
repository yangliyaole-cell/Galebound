import { clamp, lerp, ridged, sfbm, smax, smin, sstep } from './noise';
import { erode } from './erosion';
import { LAKES, RIVERS, coastZ, lakeShape } from './hydro';
import { CITY, LIGHTHOUSE, PLATEAU, SCARP, START, WATCHTOWER, WINDMILL } from '../layout';

/**
 * The whole landscape at coarse resolution: sixteen kilometres square, of
 * which the middle four are walkable. Built in the order real land is: broad
 * uplift, then the surveyed rivers as base level, then erosion.
 */
export const MACRO_CELL = 32;
export const MACRO_N = 513;
export const MACRO_HALF = (MACRO_N - 1) * MACRO_CELL / 2;

export interface Macro {
  height: Float32Array;
  /** Upstream drainage area in square metres. */
  area: Float32Array;
  /** Steepness (rise / run) of the eroded surface. */
  slope: Float32Array;
}

const PEAKS: [number, number, number, number][] = [
  [-3050, -4750, 2500, 1650],
  [-4900, -2700, 1900, 950],
  [-1150, -5700, 1800, 900],
  [1600, -5300, 2000, 760],
  [-5700, -500, 1800, 760],
  [-4300, -6300, 2200, 900],
  [4700, -3000, 2000, 430],
  [-6400, 2300, 1900, 520],
];

/** A hill that is longer one way than the other, so nothing sits on a round mound. */
function rise(x: number, z: number, cx: number, cz: number, long: number, short: number, turn: number): number {
  const c = Math.cos(turn), s = Math.sin(turn);
  const u = ((x - cx) * c + (z - cz) * s) / long, v = (-(x - cx) * s + (z - cz) * c) / short;
  return Math.exp(-(u * u + v * v));
}

/** How mountainous a place is, 0 in the vale to 1 deep in the ranges. */
export function rangeMask(x: number, z: number): number {
  const wx = x + 420 * sfbm(x / 2600 + 1.3, z / 2600 - 4.1, 3);
  const wz = z + 420 * sfbm(x / 2600 - 7.7, z / 2600 + 2.9, 3);
  const sd = (x - SCARP.x) * SCARP.ux + (z - SCARP.z) * SCARP.uz + 150 * sfbm(x / 700 + 3, z / 700 - 2, 3);
  const nw = sstep(120, -3000, sd);
  const north = sstep(-1700, -4700, wz);
  const west = sstep(-2050, -4900, wx);
  const east = 0.55 * sstep(2250, 5600, wx);
  return 1 - (1 - nw) * (1 - north) * (1 - west) * (1 - east);
}

/** Uneroded land: the broad shapes only. */
function landform(x: number, z: number): number {
  const wx = x + 420 * sfbm(x / 2600 + 1.3, z / 2600 - 4.1, 3);
  const wz = z + 420 * sfbm(x / 2600 - 7.7, z / 2600 + 2.9, 3);
  let h = 68 + 30 * sfbm(wx / 950 + 5.2, wz / 950 + 0.4, 4) + 17 * sfbm(wx / 430 + 8.6, wz / 430 - 6.2, 3) + 9 * sfbm(wx / 210 + 1.1, wz / 210 + 3.3, 3);
  h += 38 * sstep(-300, -2000, wz) + 26 * sstep(-700, -2100, wx) + 22 * sstep(1500, 2300, wx);

  // The coastal downs: a broken line of chalk hills between the vale and the sea.
  const downs = Math.exp(-(((wz - 1300) / 340) ** 2));
  h += downs * (46 + 30 * sfbm(wx / 520 + 2.2, wz / 520 + 7.1, 3));
  h += 34 * rise(x, z, START.x + 30, START.z + 30, 330, 190, 0.22);
  h += 30 * rise(x, z, WINDMILL.x, WINDMILL.z, 260, 170, -0.5);
  h += 22 * rise(x, z, WATCHTOWER.x, WATCHTOWER.z, 210, 150, 0.4);

  // The crag the city stands on, and the eastern tableland.
  const dc = Math.hypot(x - CITY.x, z - CITY.z) + 46 * sfbm(x / 170 + 9, z / 170 + 2, 2);
  h += 62 * (1 - sstep(120, 320, dc));
  const pd = Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz) + 0.2 * sfbm(x / 190, z / 190, 2);
  h += PLATEAU.h * (1 - sstep(0.75, 1.15, pd));

  const m = rangeMask(x, z);
  const range = ridged(wx / 3400 + 0.7, wz / 3400 + 1.9, 5);
  const crest = ridged(wx / 1100 + 4.4, wz / 1100 - 2.2, 4);
  h += Math.pow(m, 1.5) * (520 + 1500 * range) + Math.pow(m, 0.75) * (90 + 240 * crest);

  // The scarp: the hanging valley ends in a wall facing the vale.
  const sd = (x - SCARP.x) * SCARP.ux + (z - SCARP.z) * SCARP.uz + 150 * sfbm(x / 700 + 3, z / 700 - 2, 3);
  const along = (x - SCARP.x) * SCARP.uz - (z - SCARP.z) * SCARP.ux;
  h += SCARP.rise * sstep(45, -45, sd) * sstep(-1700, -800, along) * sstep(1500, 600, along);

  for (const [px, pz, radius, height] of PEAKS) {
    const d = Math.hypot(x - px, z - pz) / radius;
    if (d < 1) h += height * Math.pow(1 - d, 1.3) * (0.7 + 0.3 * crest);
  }

  // The sea takes the south. Land may not stand higher than a shore profile.
  const sea = z - coastZ(x);
  const inland = Math.max(0, -sea);
  const shore = sea > 0 ? 4 - sea * 0.24
    : 4 + inland * (0.2 + 0.1 * sfbm(x / 300 + 1.4, 3.3, 2)) + inland * inland / 900;
  h = smin(h, shore, 22);
  h += 20 * rise(x, z, LIGHTHOUSE.x, LIGHTHOUSE.z + 10, 120, 90, 0) * sstep(120, 0, sea);
  return Math.max(h, -70);
}

let macro: Macro | null = null;

export function buildMacro(onProgress?: (fraction: number) => void): Macro {
  if (macro) return macro;
  const n = MACRO_N, count = n * n;
  const height = new Float32Array(count);
  const fixed = new Uint8Array(count);
  const strength = new Float32Array(count);
  const talus = new Float32Array(count);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * MACRO_CELL - MACRO_HALF, z = j * MACRO_CELL - MACRO_HALF, c = j * n + i;
    const m = rangeMask(x, z);
    // Small irregularities make water gather into branching streams instead of parallel rills.
    const grain = sfbm(x / 210 + 40.5, z / 210 - 12.2, 3) + 0.6 * sfbm(x / 75 - 3.1, z / 75 + 22.4, 2);
    height[c] = landform(x, z) + grain * lerp(2.2, 34, sstep(0.05, 0.6, m));
    // Hard, fractured rock in the ranges holds cliffs; the vale is soft and rounded.
    const hard = sstep(-0.1, 0.5, sfbm(x / 620 + 14, z / 620 - 9, 3));
    strength[c] = lerp(0.0075, 0.011, sstep(0, 0.5, m)) * (1.3 - 0.6 * hard);
    talus[c] = lerp(0.5, 0.85 + 1.5 * hard, sstep(0.05, 0.5, m));
  }

  // The land is fitted to the surveyed rivers. Near a river the ground may not
  // stand below the water (a gentle rise away from the bank) nor above a valley
  // profile (a flat floor, then walls). The Gale goes first; each tributary then
  // takes its fall from the land it crosses, rising upstream from its confluence.
  const ceiling = new Float32Array(count).fill(Infinity);
  const nearest = new Float32Array(count).fill(Infinity);
  const lower = new Float32Array(count).fill(-Infinity);
  const landAt = (x: number, z: number): number => {
    const c = Math.round((z + MACRO_HALF) / MACRO_CELL) * n + Math.round((x + MACRO_HALF) / MACRO_CELL);
    return Math.min(height[c], ceiling[c]);
  };
  for (const river of RIVERS) {
    const pts = river.pts;
    let from = pts.length - 2;
    // The Gale is surveyed by hand from its upper tarn down; above that it follows the land too.
    if (river === RIVERS[0]) { from = 0; while (pts[from].level > 300.5) from++; from--; }
    for (let i = from; i >= 0; i--) {
      const run = pts[i + 1].s - pts[i].s;
      const steepest = lerp(0.03, 0.45, sstep(0.08, 0.55, rangeMask(pts[i].x, pts[i].z)));
      pts[i].level = clamp(landAt(pts[i].x, pts[i].z) - 4, pts[i + 1].level + 0.004 * run, pts[i + 1].level + steepest * run);
    }
    for (let k = 0; k < pts.length; k += 2) {
      const p = pts[k];
      const reach = Math.min(1100, p.floor + 900);
      const i0 = Math.max(0, Math.floor((p.x - reach + MACRO_HALF) / MACRO_CELL)), i1 = Math.min(n - 1, Math.ceil((p.x + reach + MACRO_HALF) / MACRO_CELL));
      const j0 = Math.max(0, Math.floor((p.z - reach + MACRO_HALF) / MACRO_CELL)), j1 = Math.min(n - 1, Math.ceil((p.z + reach + MACRO_HALF) / MACRO_CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * MACRO_CELL - MACRO_HALF - p.x, j * MACRO_CELL - MACRO_HALF - p.z);
        if (d > reach) continue;
        const c = j * n + i, out = d - p.floor;
        const t = p.level + (out <= 0 ? 1.2 + 2.3 * (d / p.floor) ** 2 : 3.5 + p.wall * out * (1 + out / 600));
        if (t < ceiling[c]) ceiling[c] = t;
        if (d < nearest[c]) {
          nearest[c] = d;
          // Fades out with distance so far hills are left to the landform.
          lower[c] = lerp(-70, p.level + 0.9 + 0.018 * d, sstep(820, 380, d));
        }
      }
    }
  }
  for (let c = 0; c < count; c++) {
    if (ceiling[c] < Infinity) height[c] = smin(height[c], ceiling[c], 16);
    if (lower[c] > -Infinity) height[c] = smax(height[c], Math.min(lower[c], ceiling[c]), 6);
  }
  // River and lake cells are the base level that everything drains to.
  for (const river of RIVERS) for (const p of river.pts) {
    const c = Math.round((p.z + MACRO_HALF) / MACRO_CELL) * n + Math.round((p.x + MACRO_HALF) / MACRO_CELL);
    fixed[c] = 1; height[c] = Math.min(height[c], p.level - 0.8);
  }
  for (const l of LAKES) {
    const reach = Math.max(l.rx, l.rz) * 2.6;
    for (let z = l.z - reach; z <= l.z + reach; z += MACRO_CELL) for (let x = l.x - reach; x <= l.x + reach; x += MACRO_CELL) {
      const i = Math.round((x + MACRO_HALF) / MACRO_CELL), j = Math.round((z + MACRO_HALF) / MACRO_CELL), c = j * n + i;
      const s = lakeShape(l, i * MACRO_CELL - MACRO_HALF, j * MACRO_CELL - MACRO_HALF);
      if (s < 1) { fixed[c] = 1; height[c] = l.level - l.depth * (1 - s * s) - 0.3; }
      else if (s < 2.5) height[c] = Math.max(l.level + 0.8, smin(height[c], l.level + 1 + (s - 1) * Math.min(l.rx, l.rz) * 0.16, 8));
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = j * n + i;
    if (height[c] < -0.5 && j * MACRO_CELL - MACRO_HALF > coastZ(i * MACRO_CELL - MACRO_HALF) - 40) fixed[c] = 1;
  }

  const iterations = 64;
  const { area } = erode(height, {
    n, cell: MACRO_CELL, iterations, strength, m: 0.46, fixed, talus, creep: 0.035,
    onStep: (it) => onProgress?.((it + 1) / iterations),
  });

  const slope = new Float32Array(count);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const c = j * n + i;
    slope[c] = Math.hypot(height[c + 1] - height[c - 1], height[c + n] - height[c - n]) / (2 * MACRO_CELL);
  }
  macro = { height, area, slope };
  return macro;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/** Smooth (Catmull-Rom) height of the coarse landscape anywhere in its sixteen kilometres. */
export function macroHeight(x: number, z: number): number {
  const data = macro!.height, n = MACRO_N;
  const gx = clamp((x + MACRO_HALF) / MACRO_CELL, 1, n - 2.001), gz = clamp((z + MACRO_HALF) / MACRO_CELL, 1, n - 2.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  let o = (j - 1) * n + i - 1;
  const r0 = cubic(data[o], data[o + 1], data[o + 2], data[o + 3], fx); o += n;
  const r1 = cubic(data[o], data[o + 1], data[o + 2], data[o + 3], fx); o += n;
  const r2 = cubic(data[o], data[o + 1], data[o + 2], data[o + 3], fx); o += n;
  const r3 = cubic(data[o], data[o + 1], data[o + 2], data[o + 3], fx);
  // Cubic overshoot would dig pits beside cliffs; keep within the surrounding cell.
  const v = cubic(r0, r1, r2, r3, fz);
  const q = j * n + i;
  const lo = Math.min(data[q], data[q + 1], data[q + n], data[q + n + 1]);
  const hi = Math.max(data[q], data[q + 1], data[q + n], data[q + n + 1]);
  return clamp(v, lo - 2, hi + 2);
}

function bilinear(data: Float32Array, x: number, z: number): number {
  const n = MACRO_N;
  const gx = clamp((x + MACRO_HALF) / MACRO_CELL, 0, n - 1.001), gz = clamp((z + MACRO_HALF) / MACRO_CELL, 0, n - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, o = j * n + i;
  return lerp(lerp(data[o], data[o + 1], fx), lerp(data[o + n], data[o + n + 1], fx), fz);
}
export const macroSlope = (x: number, z: number): number => bilinear(macro!.slope, x, z);
export const macroArea = (x: number, z: number): number => bilinear(macro!.area, x, z);
