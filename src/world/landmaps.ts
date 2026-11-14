import * as THREE from 'three';
import { grid, heightAt } from './heightmap';
import { MACRO_CELL, MACRO_HALF, MACRO_N, buildMacro, macroHeight } from './gen/macro';
import { LAKES, lakeShape, nearestRiver } from './gen/hydro';
import { HALF, SIZE } from './layout';

/**
 * Textures baked from the finished heightfield and read by the terrain shader:
 * surface normal, cavity shading and sun shadow for both the detailed land and
 * the far landscape, the far heights themselves, and how close water is.
 */
export interface LandMaps {
  /** Walkable land: RG normal xz, B cavity, A sunlight. */
  land: THREE.DataTexture;
  /** RG normal xz, B cavity, A sunlight, for all sixteen kilometres. */
  far: THREE.DataTexture;
  /** Far heights in metres. */
  farHeight: THREE.DataTexture;
  /** R water nearness, G moisture of hollows. */
  cover: THREE.DataTexture;
  farCell: number; farN: number;
}

export const FAR_CELL = 16;
export const FAR_N = (MACRO_N - 1) * MACRO_CELL / FAR_CELL;

/** Box blur, used to find hollows: ground lower than its surroundings. */
function blur(src: Float32Array, row: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, stride: number, other: number): void => {
    for (let a = 0; a < row; a++) {
      let sum = 0;
      const base = a * other;
      for (let k = -radius; k <= radius; k++) sum += from[base + Math.min(row - 1, Math.max(0, k)) * stride];
      for (let b = 0; b < row; b++) {
        to[base + b * stride] = sum / (radius * 2 + 1);
        sum += from[base + Math.min(row - 1, b + radius + 1) * stride] - from[base + Math.max(0, b - radius) * stride];
      }
    }
  };
  pass(src, tmp, 1, row);
  pass(tmp, out, row, 1);
  return out;
}

/** Marches from a point toward the sun; 0 in full shadow, 1 in the open. */
function sunlight(x: number, y: number, z: number, sun: THREE.Vector3, sample: (x: number, z: number) => number, first: number, reach: number): number {
  let lit = 1;
  for (let t = first, step = first; t < reach; t += step, step *= 1.12) {
    const clearance = y + sun.y * t - sample(x + sun.x * t, z + sun.z * t);
    // A soft edge: the closer the ray passes to the ground, the deeper the penumbra.
    lit = Math.min(lit, 0.5 + clearance / (t * 0.09 + 0.6));
    if (lit <= 0) return 0;
  }
  return lit;
}

function bake(n: number, cell: number, half: number, at: (i: number, j: number) => number, sun: THREE.Vector3,
  sample: (x: number, z: number) => number, cavityRadius: number, shadowEvery: number, shadowReach: number): Uint8Array {
  const row = n + 1, heights = new Float32Array(row * row);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) heights[j * row + i] = at(i, j);
  const soft = blur(heights, row, cavityRadius);
  const pixels = new Uint8Array(row * row * 4);
  // Shadows are marched on a coarser lattice and interpolated.
  const srow = Math.floor(n / shadowEvery) + 1, shade = new Float32Array(srow * srow);
  for (let j = 0; j < srow; j++) for (let i = 0; i < srow; i++) {
    const gi = Math.min(n, i * shadowEvery), gj = Math.min(n, j * shadowEvery);
    shade[j * srow + i] = sunlight(gi * cell - half, heights[gj * row + gi] + 0.4, gj * cell - half, sun, sample, cell * shadowEvery, shadowReach);
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const c = j * row + i;
    const l = heights[j * row + Math.max(0, i - 1)], r = heights[j * row + Math.min(n, i + 1)];
    const u = heights[Math.max(0, j - 1) * row + i], d = heights[Math.min(n, j + 1) * row + i];
    const nx = l - r, nz = u - d, len = Math.hypot(nx, 2 * cell, nz);
    const hollow = (soft[c] - heights[c]) / (cavityRadius * cell);
    const sx = Math.min(srow - 1.001, i / shadowEvery), sz = Math.min(srow - 1.001, j / shadowEvery);
    const si = Math.floor(sx), sj = Math.floor(sz), fx = sx - si, fz = sz - sj, o = sj * srow + si;
    const lit = (shade[o] * (1 - fx) + shade[o + 1] * fx) * (1 - fz) + (shade[o + srow] * (1 - fx) + shade[o + srow + 1] * fx) * fz;
    pixels[c * 4] = (nx / len * 0.5 + 0.5) * 255;
    pixels[c * 4 + 1] = (nz / len * 0.5 + 0.5) * 255;
    pixels[c * 4 + 2] = THREE.MathUtils.clamp(0.72 - hollow * 2.6, 0, 1) * 255;
    pixels[c * 4 + 3] = THREE.MathUtils.clamp(lit, 0, 1) * 255;
  }
  return pixels;
}

function texture(pixels: Uint8Array, row: number, mips = true): THREE.DataTexture {
  const tex = new THREE.DataTexture(pixels, row, row, THREE.RGBAFormat);
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.needsUpdate = true;
  return tex;
}

export function buildLandMaps(sunDir: THREE.Vector3): LandMaps {
  const { cell, n, data } = grid();
  const row = n + 1;
  buildMacro();
  const sun = sunDir.clone().normalize();
  const inside = (x: number, z: number): boolean => Math.abs(x) < HALF && Math.abs(z) < HALF;
  const ground = (x: number, z: number): number => inside(x, z) ? heightAt(x, z) : macroHeight(x, z);

  const landPixels = bake(n, cell, HALF, (i, j) => data[j * row + i], sun, ground, Math.max(2, Math.round(10 / cell)), Math.max(1, Math.round(4 / cell)), 2600);
  const farHeights = new Float32Array((FAR_N + 1) * (FAR_N + 1));
  for (let j = 0; j <= FAR_N; j++) for (let i = 0; i <= FAR_N; i++) farHeights[j * (FAR_N + 1) + i] = macroHeight(i * FAR_CELL - MACRO_HALF, j * FAR_CELL - MACRO_HALF);
  const farPixels = bake(FAR_N, FAR_CELL, MACRO_HALF, (i, j) => farHeights[j * (FAR_N + 1) + i], sun, macroHeight, 5, 2, 9000);

  const farHeight = new THREE.DataTexture(farHeights, FAR_N + 1, FAR_N + 1, THREE.RedFormat, THREE.FloatType);
  farHeight.minFilter = farHeight.magFilter = THREE.NearestFilter;
  farHeight.generateMipmaps = false;
  farHeight.needsUpdate = true;

  // Water nearness and damp hollows at half the grid resolution.
  const step = Math.max(1, Math.round(4 / cell)), crow = Math.floor(n / step) + 1;
  const cover = new Uint8Array(crow * crow * 4);
  for (let j = 0; j < crow; j++) for (let i = 0; i < crow; i++) {
    const x = i * step * cell - HALF, z = j * step * cell - HALF, h = data[Math.min(n, j * step) * row + Math.min(n, i * step)];
    let wet = THREE.MathUtils.smoothstep(2.2 - h, 0, 2.6);
    const river = nearestRiver(x, z, 60);
    if (river.found) wet = Math.max(wet, 1 - THREE.MathUtils.smoothstep(river.distance - river.width * 0.5, -1, 9) , 0);
    for (const l of LAKES) {
      if (Math.abs(x - l.x) > l.rx * 1.6 || Math.abs(z - l.z) > l.rz * 1.6) continue;
      wet = Math.max(wet, 1 - THREE.MathUtils.smoothstep(lakeShape(l, x, z), 0.98, 1.12));
    }
    const damp = river.found ? 1 - THREE.MathUtils.smoothstep(river.distance, river.width, river.floor * 0.9 + 20) : 0;
    const c = (j * crow + i) * 4;
    cover[c] = wet * 255; cover[c + 1] = damp * 255; cover[c + 3] = 255;
  }
  return {
    land: texture(landPixels, row), far: texture(farPixels, FAR_N + 1), farHeight, cover: texture(cover, crow, false),
    farCell: FAR_CELL, farN: FAR_N,
  };
}

/** Lowest and highest ground in each 64 m tile of the far landscape, and every coarser level above it. */
export function buildHeightPyramid(): { levels: { min: Float32Array; max: Float32Array; side: number }[]; tile: number } {
  const tile = 64, side = (MACRO_HALF * 2) / tile;
  const min = new Float32Array(side * side).fill(Infinity), max = new Float32Array(side * side).fill(-Infinity);
  const { height } = buildMacro();
  for (let j = 0; j < MACRO_N; j++) for (let i = 0; i < MACRO_N; i++) {
    const h = height[j * MACRO_N + i];
    // A macro point touches up to four tiles.
    for (const tj of [Math.floor((j * MACRO_CELL - 1) / tile), Math.floor(j * MACRO_CELL / tile)]) {
      for (const ti of [Math.floor((i * MACRO_CELL - 1) / tile), Math.floor(i * MACRO_CELL / tile)]) {
        if (ti < 0 || tj < 0 || ti >= side || tj >= side) continue;
        const c = tj * side + ti;
        if (h - 8 < min[c]) min[c] = h - 8;
        if (h + 8 > max[c]) max[c] = h + 8;
      }
    }
  }
  const { cell, n, data } = grid(), row = n + 1;
  const offset = (MACRO_HALF - HALF) / tile, inner = SIZE / tile, per = tile / cell;
  for (let tj = 0; tj < inner; tj++) for (let ti = 0; ti < inner; ti++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = tj * per; j <= (tj + 1) * per; j++) for (let i = ti * per; i <= (ti + 1) * per; i++) {
      const h = data[j * row + i];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    const c = (tj + offset) * side + ti + offset;
    min[c] = lo - 1; max[c] = hi + 1;
  }
  const levels = [{ min, max, side }];
  for (let s = side / 2; s >= 1; s /= 2) {
    const prev = levels[levels.length - 1], lo = new Float32Array(s * s), hi = new Float32Array(s * s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const a = (j * 2) * prev.side + i * 2;
      lo[j * s + i] = Math.min(prev.min[a], prev.min[a + 1], prev.min[a + prev.side], prev.min[a + prev.side + 1]);
      hi[j * s + i] = Math.max(prev.max[a], prev.max[a + 1], prev.max[a + prev.side], prev.max[a + prev.side + 1]);
    }
    levels.push({ min: lo, max: hi, side: s });
  }
  return { levels, tile };
}
