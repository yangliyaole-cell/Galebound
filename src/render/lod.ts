/** The same test for core, leaves and both sides of a transition (opaque depth). */
export const LOD_VERTEX = 'attribute vec2 aLodBand; varying vec2 vLodBand;';
export const LOD_FRAGMENT = 'varying vec2 vLodBand;';
export const LOD_DISCARD = `
  float lodPixel = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (lodPixel < vLodBand.x || lodPixel >= vLodBand.y) discard;
`;
