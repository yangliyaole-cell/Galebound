import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { registerGroundPbr } from '../render/pbr/ground';
import { pbrUniforms } from '../render/pbr/material';
import { grid } from './heightmap';
import { HALF, SIZE, FIELDS } from './layout';
import { ALPINE_LAKES } from './mountain-layout';
import { ABBEY_GROUND_MASK_GLSL } from './abbey-space';

const parcelTintGLSL = FIELDS.map((f) => {
  const tint = new THREE.Color({ wheat: 0xc9b66f, tilled: 0xa67a60, cabbage: 0x78a861, lavender: 0x9d8bb7 }[f.crop]);
  return `if (distance(p, vec2(${f.x.toFixed(1)}, ${f.z.toFixed(1)})) < ${(Math.max(f.w, f.d) * 0.76).toFixed(1)}) c = vec3(${tint.r.toFixed(4)},${tint.g.toFixed(4)},${tint.b.toFixed(4)});`;
}).join('\n');

const lakeLevelGLSL = ALPINE_LAKES.map((l) =>
  `{ vec2 q=(p-vec2(${l.x.toFixed(1)},${l.z.toFixed(1)}))/vec2(${l.rx.toFixed(1)},${l.rz.toFixed(1)});
    float a=atan(q.y,q.x); float r=1.+.09*sin(3.*a+${l.x.toFixed(1)})+.05*cos(5.*a);
    if(length(q)<r*1.12) level=${l.level.toFixed(1)}; }`).join('\n');

/** Ground colour from position, slope and the painted maps. Shared with the grass. */
export const GROUND_GLSL = /* glsl */ `
  uniform float uPbrActive;
  uniform sampler2D uPbrContact;
  uniform sampler2D uSplat;
  uniform sampler2D uBiome;
  uniform sampler2D uDetail;
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
  ${ABBEY_GROUND_MASK_GLSL}
  float lakeLevel(vec2 p) { float level=0.; ${lakeLevelGLSL} return level; }
  vec3 parcelColor(vec2 p) { vec3 c = uSoil; ${parcelTintGLSL} return c; }
  vec2 worldUv(vec2 xz) { return xz / ${SIZE.toFixed(1)} + 0.5; }

  // Shared fragment/grass-vertex shoulder coverage. Road centres remain unchanged.
  float groundRoadShoulder(vec2 xz, float coverage) {
    float edge=smoothstep(.04,.23,coverage)*(1.0-smoothstep(.36,.62,coverage));
    float traffic=smoothstep(.32,.68,gNoise(xz*vec2(.9,2.7)+17.0));
    return edge*traffic;
  }

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

    // Brushwork: dabs on turf, pebbles on paths, cracks on rock. Skipped where
    // the caller only wants the flat colour (grass blades pass a huge distance).
    vec3 near = vec3(0.5);
    vec3 wide = vec3(0.5);
    float cliff = 0.5;
    if (dist < 900.0) {
      near = texture2D(uDetail, wp.xz * 0.15).rgb;
      wide = texture2D(uDetail, wp.xz * 0.034 + 0.37).rgb;
      cliff = texture2D(uDetail, vec2(wp.x + wp.z, wp.y * 1.6) * 0.09).b;
    }
    float dab = (near.r - 0.5) * 0.8 + (wide.r - 0.5) * 0.9;
    col *= 1.0 + dab * 0.42;
    col += vec3(0.05, 0.045, -0.02) * max(dab, 0.0);
    // Clover and flower meadows are a touch lighter and yellower.
    col = mix(col, col * vec3(1.08, 1.06, 0.86), biome.g * 0.35);

    float alpine = smoothstep(95.0, 150.0, wp.y + (fine - 0.5) * 30.0);
    col = mix(col, uRock, alpine * 0.7);

    float sand = 1.0 - smoothstep(0.9, 2.1, wp.y - lakeLevel(wp.xz) + (fine - 0.5) * 1.2);
    col = mix(col, uSand * (0.9 + 0.2 * wide.r), sand);
    col = mix(col, uSand * vec3(0.5, 0.68, 0.72), smoothstep(-0.2, -3.5, wp.y) * 0.85);

    float rock = smoothstep(0.8, 0.62, ny + (fine - 0.5) * 0.14);
    vec3 rockCol = mix(uRockDark, uRock, smoothstep(0.3, 0.7, gFbm3(wp.xz * 0.07 + wp.y * 0.11)));
    rockCol *= 0.92 + 0.16 * step(0.5, fract(wp.y * 0.21 + fine * 1.5)) * (1.0 - smoothstep(80.0, 260.0, dist));
    rockCol *= 0.72 + 0.56 * mix(cliff, wide.b, smoothstep(0.55, 0.85, ny));
    // High peaks cool toward blue, as they do in the distance.
    rockCol = mix(rockCol, vec3(0.5, 0.58, 0.75), smoothstep(50.0, 230.0, wp.y) * 0.55);
    col = mix(col, rockCol, rock);

    float snow = smoothstep(150.0, 185.0, wp.y + (broad - 0.5) * 26.0) * smoothstep(0.3, 0.58, ny);
    col = mix(col, uSnow, snow);

    float field = smoothstep(0.35, 0.6, splat.b);
    float furrow = step(0.5, fract((wp.x * 0.35 + wp.z * 0.94) * 0.55));
    col = mix(col, parcelColor(wp.xz) * (0.82 + 0.3 * furrow) * (0.9 + 0.2 * fine), field);

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
    if (uPbrActive > 0.5) {
      // Match the PBR height blend with low-frequency heights for blade placement.
      road = smoothstep(-.32,.32,(splat.r-.5)*2.0+(fine-.55)*.26);
      cobble = smoothstep(-.28,.28,(splat.g-.5)*2.0+(fine-.5)*.2);
    }
    col = mix(col, mix(uDirtDark, uDirtLight, smoothstep(0.3, 0.7, fine)) * (0.8 + 0.42 * near.g) * (0.92 + 0.16 * wide.r), road);

    grassAmount = (1.0 - road) * (1.0 - cobble) * (1.0 - field) * (1.0 - sand) *
      (1.0 - rock) * (1.0 - snow) * (1.0 - alpine * 0.85) * step(lakeLevel(wp.xz) + 0.25, wp.y) * abbeyGroundMask(wp.xz);
    if(uPbrActive>.5) {
      grassAmount*=1.0-groundRoadShoulder(wp.xz,splat.r)*.65;
      // Grass must not grow through collider-backed boulders or foundations.
      grassAmount*=1.0-smoothstep(.78,.96,texture2D(uPbrContact,worldUv(wp.xz)).r);
    }
    return col;
  }
`;

export const groundUniforms = {
  uPbrActive: pbrUniforms.uPbrActive,
  uPbrContact: pbrUniforms.uPbrContact,
  uSplat: { value: null as THREE.Texture | null },
  uBiome: { value: null as THREE.Texture | null },
  uDetail: { value: null as THREE.Texture | null },
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

  registerGroundPbr(mat, GROUND_GLSL, groundUniforms);

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
