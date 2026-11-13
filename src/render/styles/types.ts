export interface SurfaceStyle {
  /** Quantize sqrt(linear luminance), then scale all RGB channels together. */
  bands: number;
  bandFloor: number;
  bandMix: number;
  /** Optional three illumination levels relative to albedo, rather than absolute brightness. */
  bandLevels?: [number, number, number];
  bandThresholds?: [number, number];
  saturation?: number;
  character?: { fill: number; strength: number; detail: number; rim: number };
  shadow: number;
  highlight: number;
  tint: number;
  rim: number;
  detail: number;
  foliageDark: [number, number, number];
  foliageLight: [number, number, number];
}

export interface PostStyle {
  contrast: number;
  /** 0..1: relax the contrast curve below mid-grey so shadows keep detail. */
  toe?: number;
  ink: number;
  /** CSS pixels, independent of dynamic resolution and device pixel ratio. */
  width: number;
  colorEdge: number;
  luminanceEdge?: [number, number];
  paper?: number;
  /** Paper contrast multiplier and flat-region gradient thresholds. */
  paperQuiet?: [number, number, number];
  warp?: number;
  bleed?: number;
  wash?: number;
  /** Linear threshold, strength, radius in CSS pixels. */
  bloom?: [number, number, number];
  /** Density, height falloff, maximum opacity. */
  atmosphere?: [number, number, number];
  /** Shadow colour, highlight colour, strength. */
  split?: [number, number, number];
}

export interface StylePreset {
  id: 1 | 2 | 3 | 4;
  sun: [number, number];
  hemisphere: [number, number, number];
  direction: [number, number, number];
  fog: [number, number, number];
  sky: [number, number, number, number];
  water: [number, number];
  grass: [number, number, number, number, number];
  /** Saturation, exposure, outline opacity, vignette. */
  grade: [number, number, number, number];
  ramp: number[];
  surface: SurfaceStyle;
  post: PostStyle;
  flat?: boolean;
}
