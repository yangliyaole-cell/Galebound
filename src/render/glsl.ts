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

/** Soft moving cloud shadows, shared by terrain, grass, water and props. */
export const CLOUD_GLSL = /* glsl */ `
  uniform vec2 uCloudDrift;
  float cloudShadow(vec2 xz) {
    float c = gFbm3(xz * 0.0032 + uCloudDrift);
    return 1.0 - 0.24 * smoothstep(0.5, 0.68, c);
  }
`;
