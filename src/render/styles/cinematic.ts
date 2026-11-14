import type { StylePreset } from './types';

export const cinematic: StylePreset = {
  id: 2,
  sun: [0xffdfad, 4.9],
  hemisphere: [0x9ec4ee, 0x7f9f6c, 1.5],
  // Afternoon light from the west, a little behind the first view north.
  direction: [-0.74, 0.62, 0.12],
  fog: [0xa9c4dc, 600, 22000],
  sky: [0x183e63, 0x487f9f, 0xb4c7d2, 0x8fa5bf],
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
    bloom: [0.58, 0.34, 32], atmosphere: [0.0011, 0.015, 0.36],
    split: [0x54b7d4, 0xffce91, 0.4],
  },
};
