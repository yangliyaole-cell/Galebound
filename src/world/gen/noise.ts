/**
 * Gradient noise for terrain generation. Pure arithmetic (no trigonometry at
 * sample time), so results are identical on every engine.
 */
const PERM = new Uint8Array(512);
{
  let a = 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
// Sixteen evenly spread unit gradients.
const GX = new Float64Array(16), GY = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  const a = (i + 0.5) / 16 * Math.PI * 2;
  GX[i] = Math.cos(a); GY[i] = Math.sin(a);
}
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

/** 2D simplex noise in about [-1, 1]. */
export function snoise(x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let a = 0.5 - x0 * x0 - y0 * y0;
  if (a > 0) { const g = PERM[ii + PERM[jj]] & 15; a *= a; n += a * a * (GX[g] * x0 + GY[g] * y0); }
  a = 0.5 - x1 * x1 - y1 * y1;
  if (a > 0) { const g = PERM[ii + i1 + PERM[jj + j1]] & 15; a *= a; n += a * a * (GX[g] * x1 + GY[g] * y1); }
  a = 0.5 - x2 * x2 - y2 * y2;
  if (a > 0) { const g = PERM[ii + 1 + PERM[jj + 1]] & 15; a *= a; n += a * a * (GX[g] * x2 + GY[g] * y2); }
  return 70 * n;
}

/** Fractal sum in about [-1, 1]. */
export function sfbm(x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2.03): number {
  let amp = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * snoise(x, y);
    norm += amp;
    amp *= gain;
    x = x * lacunarity + 31.7; y = y * lacunarity - 17.3;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests, broad valleys. */
export function ridged(x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2.07): number {
  let amp = 1, sum = 0, norm = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(snoise(x, y));
    n *= n;
    sum += amp * n * weight;
    norm += amp;
    weight = Math.min(1, Math.max(0.15, n * 1.6));
    amp *= gain;
    x = x * lacunarity + 11.3; y = y * lacunarity + 47.9;
  }
  return sum / norm;
}

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smoothstep that also accepts a > b, for falling edges. */
export function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Smooth minimum with blend radius k. */
export function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);
