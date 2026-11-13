import type { StylePreset } from './types';

export const watercolor: StylePreset = {
  id: 3,
  sun: [0xffe6bd, 2.8],
  hemisphere: [0xc0cfe8, 0x79876c, 1.15],
  direction: [0.42, 0.72, 0.55],
  fog: [0xdde4df, 230, 1600],
  sky: [0x9ebfd0, 0xd5e5e4, 0xfff4df, 0xb6c4d2],
  water: [0x86b4a7, 0x607e9d],
  grass: [0x426e60, 0x82a878, 0xb8cc86, 0xc2b17e, 0x405f62],
  grade: [0.88, 0.96, 0.76, 0.0],
  ramp: [95, 160, 215, 255],
  surface: {
    bands: 7, bandFloor: 0.12, bandMix: 0.3,
    shadow: 0x4e596e, highlight: 0xffe4b0, tint: 0.15,
    rim: 0, detail: 0.55,
    foliageDark: [0.43, 0.56, 0.72], foliageLight: [1.25, 1.25, 0.98],
  },
  post: {
    contrast: 1.16, ink: 0x514438, width: 1.65, colorEdge: 0.85,
    paper: 0.95, paperQuiet: [0.65, 0.04, 0.14], warp: 2.8, bleed: 0.7, wash: 0.18,
  },
};
