export const NOISE_GLSL = /* glsl */ `
  float gHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float gNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
      mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }
  float gFbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * gNoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s / 0.9375;
  }
  float gFbm3(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += a * gNoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s / 0.875;
  }
`;

/** The picture's sun: afternoon light from the west, a little behind the first view north. */
export const SUN_DIRECTION: [number, number, number] = [-0.74, 0.62, 0.12];
/** Clouds live in a slab of air between these heights (metres). */
export const CLOUD_BASE = 1500;
export const CLOUD_TOP = 4300;
const shadowShift = [SUN_DIRECTION[0] / SUN_DIRECTION[1] * 2100, SUN_DIRECTION[2] / SUN_DIRECTION[1] * 2100];

/**
 * Where clouds stand, as a function of ground position. The sky marches
 * through it and everything on the ground samples it for cloud shadow, so
 * the shadows on the land belong to the clouds overhead.
 */
export const CLOUD_GLSL = /* glsl */ `
  uniform vec2 uCloudDrift;
  float cloudCover(vec2 xz) {
    vec2 q = xz * 0.00013 + uCloudDrift * 0.35;
    float broad = gFbm3(q);
    float lumps = gFbm3(q * 3.3 + 7.7);
    return smoothstep(0.45, 0.66, broad * 0.56 + lumps * 0.48);
  }
  float cloudShadow(vec2 xz) {
    float c = cloudCover(xz + vec2(${shadowShift[0].toFixed(1)}, ${shadowShift[1].toFixed(1)}));
    return 1.0 - 0.46 * smoothstep(0.08, 0.7, c);
  }
`;
