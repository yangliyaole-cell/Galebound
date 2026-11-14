import type { StylePreset } from './types';
import { SUN_DIRECTION } from '../glsl';

export const cinematic: StylePreset = {
  id: 2,
  sun: [0xffdfad, 4.9],
  // Sky fill above, sunlit earth below: bounce light is warm, not grass-green.
  hemisphere: [0xb2cbe8, 0xa08c68, 1.3],
  direction: SUN_DIRECTION,
  fog: [0xa3c6ea, 600, 22000],
  sky: [0x1859c2, 0x4a97e6, 0xbcd6ec, 0x8fa9cf],
  water: [0x479c99, 0x244f68],
  grass: [0x337343, 0x7db64b, 0xbbd46c, 0xc3ba6e, 0x2f6151],
  grade: [1.02, 1.07, 0.0, 0.3],
  // Continuous irradiance keeps geometry smooth under a low, directional sun.
  ramp: Array.from({ length: 64 }, (_, i) => Math.round(22 + 233 * i / 63)),
  surface: {
    bands: 64, bandFloor: 0.08, bandMix: 0,
    shadow: 0x294d65, highlight: 0xffdbab, tint: 0,
    rim: 0, detail: 1,
    foliageDark: [0.45, 0.62, 0.78], foliageLight: [1.45, 1.35, 0.92],
  },
  post: {
    contrast: 1.3, toe: 1, ink: 0x234356, width: 0, colorEdge: 0,
    bloom: [0.58, 0.34, 32], atmosphere: [0.0002, 0.0052, 0.000042],
    split: [0x54b7d4, 0xffce91, 0.4],
  },
};
