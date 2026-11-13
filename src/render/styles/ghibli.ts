import type { StylePreset } from './types';

export const ghibli: StylePreset = {
  id: 1,
  sun: [0xffedbd, 3.35],
  hemisphere: [0x9fb9f5, 0x4e9278, 1.35],
  direction: [0.42, 0.72, 0.55],
  fog: [0xb3dcef, 180, 1700],
  sky: [0x105fc9, 0x329ee9, 0xc8e9f7, 0xa9c9ef],
  water: [0x54dfcb, 0x287bad],
  grass: [0x4f9a3a, 0x7fc241, 0xb5dd5a, 0xc6c66b, 0x477d48],
  grade: [1.18, 1.03, 0.94, 0.0],
  ramp: [85, 172, 255],
  surface: {
    bands: 3, bandFloor: 0.26, bandMix: 0.8,
    bandLevels: [0.78, 1.0, 1.13], bandThresholds: [0.65, 1.1], saturation: 0.9,
    shadow: 0x718acb, highlight: 0xffedb2, tint: 0.16,
    rim: 0.045, detail: 0.3,
    foliageDark: [0.48, 0.61, 0.8], foliageLight: [1.18, 1.14, 0.96],
  },
  post: { contrast: 1.12, ink: 0x1d3b3a, width: 1.75, colorEdge: 0.9, luminanceEdge: [0.32, 0.55] },
};
