import * as THREE from 'three';

/** The same test for core, leaves and both sides of a transition (opaque depth). */
export const LOD_VERTEX = 'attribute vec2 aLodBand; varying vec2 vLodBand;';
export const LOD_FRAGMENT = 'varying vec2 vLodBand;';
export const LOD_DISCARD = `
  float lodPixel = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (lodPixel < vLodBand.x || lodPixel >= vLodBand.y) discard;
`;

let depth: THREE.MeshDepthMaterial | undefined;
/** Apply the same opaque screen-door coverage in the directional shadow map. */
export function lodDepthMaterial(): THREE.MeshDepthMaterial {
  if (depth) return depth;
  depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.customProgramCacheKey = () => 'tree-lod-shadow';
  depth.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LOD_VERTEX}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodBand = aLodBand;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LOD_FRAGMENT}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${LOD_DISCARD}`);
  };
  return depth;
}
