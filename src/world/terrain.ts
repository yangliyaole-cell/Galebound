import * as THREE from 'three';
import { fbm } from './noise';

export function heightAt(x: number, z: number): number {
  const rolling = (fbm(x / 190, z / 190, 3) - 0.5) * 38;
  const detail = (fbm(x / 60 + 7.3, z / 60 - 2.1, 2) - 0.5) * 4;
  const startHill = 7 * Math.exp(-(x * x + z * z) / (70 * 70));
  return rolling + detail + startHill;
}

/** Centre line of the dirt path, as x for a given z. Mirrored in GROUND_GLSL. */
export function pathX(z: number): number {
  return Math.sin(z * 0.021) * 16 + Math.sin(z * 0.0063 + 1.0) * 34 - 22;
}

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
`;

/** Ground colour as a function of world position, shared by terrain and grass. */
export const GROUND_GLSL = /* glsl */ `
  uniform vec3 uGrassDark;
  uniform vec3 uGrassMid;
  uniform vec3 uGrassLight;
  uniform vec3 uDirtDark;
  uniform vec3 uDirtLight;
  ${NOISE_GLSL}
  float gPathX(float z) {
    return sin(z * 0.021) * 16.0 + sin(z * 0.0063 + 1.0) * 34.0 - 22.0;
  }
  vec3 groundColor(vec2 xz, out float pathMask) {
    float broad = gFbm(xz * 0.02);
    float fine = gFbm(xz * 0.16 + 31.7);
    vec3 grass = mix(uGrassDark, uGrassMid, smoothstep(0.36, 0.62, broad));
    grass = mix(grass, uGrassLight, smoothstep(0.5, 0.72, fine) * 0.55);
    float d = abs(xz.x - gPathX(xz.y));
    float w = 1.3 + (fine - 0.5) * 1.4;
    pathMask = 1.0 - smoothstep(w - 0.35, w + 0.35, d);
    vec3 dirt = mix(uDirtDark, uDirtLight, smoothstep(0.3, 0.7, fine));
    return mix(grass, dirt, pathMask);
  }
`;

export const groundUniforms = {
  uGrassDark: { value: new THREE.Color(0x3f8f38) },
  uGrassMid: { value: new THREE.Color(0x6dba48) },
  uGrassLight: { value: new THREE.Color(0xb2d858) },
  uDirtDark: { value: new THREE.Color(0xc4a070) },
  uDirtLight: { value: new THREE.Color(0xe6cf9e) },
};

export function createTerrain(): THREE.Mesh {
  const size = 1400;
  const segments = 280;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${GROUND_GLSL}`)
      .replace(
        '#include <color_fragment>',
        'float pathMask;\ndiffuseColor.rgb = groundColor(vWPos.xz, pathMask);',
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
