import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { grid } from './heightmap';
import { HALF, SIZE } from './layout';

/** Ground colour from position, slope and the painted maps. Shared with the grass. */
export const GROUND_GLSL = /* glsl */ `
  uniform sampler2D uSplat;
  uniform sampler2D uBiome;
  uniform vec3 uGrassDark;
  uniform vec3 uGrassMid;
  uniform vec3 uGrassLight;
  uniform vec3 uGrassDry;
  uniform vec3 uForestFloor;
  uniform vec3 uDirtDark;
  uniform vec3 uDirtLight;
  uniform vec3 uSand;
  uniform vec3 uRock;
  uniform vec3 uRockDark;
  uniform vec3 uSnow;
  uniform vec3 uCobble;
  uniform vec3 uSoil;
  ${NOISE_GLSL}
  ${CLOUD_GLSL}
  vec2 worldUv(vec2 xz) { return xz / ${SIZE.toFixed(1)} + 0.5; }

  vec3 grassColor(vec2 xz, vec3 biome, float broad, float fine) {
    vec3 g = mix(uGrassDark, uGrassMid, smoothstep(0.36, 0.62, broad));
    g = mix(g, uGrassLight, smoothstep(0.5, 0.72, fine) * 0.55);
    g = mix(g, uGrassDry, biome.b * 0.8);
    g = mix(g, uForestFloor, biome.r * 0.55);
    return g;
  }

  // Returns the colour and how much grass may grow here (0..1).
  vec3 groundColor(vec3 wp, float ny, float dist, out float grassAmount, out vec3 grass) {
    vec4 splat = texture2D(uSplat, worldUv(wp.xz));
    vec4 biome = texture2D(uBiome, worldUv(wp.xz));
    float broad = gFbm(wp.xz * 0.018);
    float fine = gFbm(wp.xz * 0.15 + 31.7);
    grass = grassColor(wp.xz, biome.rgb, broad, fine);
    vec3 col = grass;

    float alpine = smoothstep(95.0, 150.0, wp.y + (fine - 0.5) * 30.0);
    col = mix(col, uRock, alpine * 0.7);

    float sand = 1.0 - smoothstep(0.9, 2.1, wp.y + (fine - 0.5) * 1.2);
    col = mix(col, uSand, sand);
    col = mix(col, uSand * vec3(0.5, 0.68, 0.72), smoothstep(-0.2, -3.5, wp.y) * 0.85);

    float rock = smoothstep(0.8, 0.62, ny + (fine - 0.5) * 0.14);
    vec3 rockCol = mix(uRockDark, uRock, smoothstep(0.3, 0.7, gFbm3(wp.xz * 0.07 + wp.y * 0.11)));
    rockCol *= 0.92 + 0.16 * step(0.5, fract(wp.y * 0.21 + fine * 1.5)) * (1.0 - smoothstep(80.0, 260.0, dist));
    col = mix(col, rockCol, rock);

    float snow = smoothstep(150.0, 190.0, wp.y + (broad - 0.5) * 60.0) * smoothstep(0.35, 0.62, ny);
    col = mix(col, uSnow, snow);

    float field = smoothstep(0.35, 0.6, splat.b);
    float furrow = step(0.5, fract((wp.x * 0.35 + wp.z * 0.94) * 0.55));
    col = mix(col, uSoil * (0.82 + 0.3 * furrow) * (0.9 + 0.2 * fine), field);

    float cobble = smoothstep(0.3, 0.55, splat.g + (fine - 0.5) * 0.35);
    vec2 q = wp.xz * 1.5;
    q.x += floor(q.y) * 0.5;
    vec2 f = fract(q) - 0.5;
    float detail = 1.0 - smoothstep(60.0, 140.0, dist);
    float joint = smoothstep(0.36, 0.47, max(abs(f.x), abs(f.y))) * detail;
    vec3 cobbleCol = uCobble * (0.86 + 0.28 * gHash(floor(q)) * detail) * (0.92 + 0.16 * broad);
    cobbleCol = mix(cobbleCol, uCobble * 0.55, joint);
    col = mix(col, cobbleCol, cobble);

    float road = smoothstep(0.3, 0.6, splat.r + (fine - 0.5) * 0.4);
    col = mix(col, mix(uDirtDark, uDirtLight, smoothstep(0.3, 0.7, fine)), road);

    grassAmount = (1.0 - road) * (1.0 - cobble) * (1.0 - field) * (1.0 - sand) *
      (1.0 - rock) * (1.0 - snow) * (1.0 - alpine * 0.85);
    return col;
  }
`;

export const groundUniforms = {
  uSplat: { value: null as THREE.Texture | null },
  uBiome: { value: null as THREE.Texture | null },
  uGrassDark: { value: new THREE.Color(0x3d8c37) },
  uGrassMid: { value: new THREE.Color(0x6ab846) },
  uGrassLight: { value: new THREE.Color(0xaed657) },
  uGrassDry: { value: new THREE.Color(0xc2c45c) },
  uForestFloor: { value: new THREE.Color(0x2f6e35) },
  uDirtDark: { value: new THREE.Color(0xbf9b6c) },
  uDirtLight: { value: new THREE.Color(0xe4cd9c) },
  uSand: { value: new THREE.Color(0xe9dcae) },
  uRock: { value: new THREE.Color(0xa7a59c) },
  uRockDark: { value: new THREE.Color(0x7d8088) },
  uSnow: { value: new THREE.Color(0xf6f9ff) },
  uCobble: { value: new THREE.Color(0xb9b3a4) },
  uSoil: { value: new THREE.Color(0x8a6a48) },
  uCloudDrift: shared.uCloudDrift,
};

const CHUNK = 128;

export function createTerrain(): THREE.Group {
  const { cell, n, data } = grid();
  const row = n + 1;
  const per = CHUNK / cell;
  const chunks = SIZE / CHUNK;

  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${GROUND_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `float grassAmount;
        vec3 grassTint;
        diffuseColor.rgb = groundColor(vWPos, normalize(vWNormal).y, length(cameraPosition - vWPos), grassAmount, grassTint)
          * cloudShadow(vWPos.xz);`,
      );
  };

  // Shared index buffer: every chunk has the same topology.
  const index: number[] = [];
  const side = per + 1;
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const indexAttr = new THREE.BufferAttribute(
    side * side > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    1,
  );

  const h = (i: number, j: number): number =>
    data[Math.min(n, Math.max(0, j)) * row + Math.min(n, Math.max(0, i))];

  const group = new THREE.Group();
  const normal = new THREE.Vector3();
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      const positions = new Float32Array(side * side * 3);
      const normals = new Float32Array(side * side * 3);
      let o = 0;
      for (let j = 0; j <= per; j++) {
        for (let i = 0; i <= per; i++) {
          const gi = ci * per + i;
          const gj = cj * per + j;
          positions[o] = gi * cell - HALF;
          positions[o + 1] = h(gi, gj);
          positions[o + 2] = gj * cell - HALF;
          normal.set(h(gi - 1, gj) - h(gi + 1, gj), 2 * cell, h(gi, gj - 1) - h(gi, gj + 1)).normalize();
          normals[o] = normal.x;
          normals[o + 1] = normal.y;
          normals[o + 2] = normal.z;
          o += 3;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setIndex(indexAttr);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}
