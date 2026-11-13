import type { StylePreset } from './types';

export const lowpolyDusk: StylePreset = {
  id: 4,
  sun: [0xffcf8c, 3.6],
  hemisphere: [0xb6b5ed, 0x8586b4, 1.95],
  direction: [-0.75, 0.24, -0.36],
  fog: [0xd596ad, 90, 1500],
  sky: [0x534b87, 0xbe7baf, 0xf3bb96, 0x916d9f],
  water: [0xca989d, 0x635585],
  grass: [0x748657, 0xafc363, 0xe1d786, 0xd4bb6e, 0x6b7380],
  grade: [1.0, 1.0, 0.0, 0.08],
  ramp: [100, 145, 185, 220, 255],
  surface: {
    bands: 5, bandFloor: 0.24, bandMix: 0.85,
    // This is an sRGB colour, converted to linear once; never rounded per channel.
    shadow: 0x4a3a72, highlight: 0xffd48c, tint: 0.38,
    rim: 0.12, detail: 0.28,
    character: { fill: 0x806a98, strength: 0.85, detail: 0.9, rim: 0.18 },
    foliageDark: [0.58, 0.62, 1.05], foliageLight: [1.65, 1.4, 0.85],
  },
  post: { contrast: 1.08, ink: 0x4a3a72, width: 0, colorEdge: 0 },
  flat: true,
};
