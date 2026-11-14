import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { grid } from './heightmap';
import { MACRO_HALF } from './gen/macro';
import { HALF, SIZE } from './layout';
import { ABBEY_GROUND_MASK_GLSL } from './abbey-space';
import { buildHeightPyramid, type LandMaps } from './landmaps';

/**
 * Ground colour from position, slope and the painted maps. Shared with the
 * grass, which must agree with the turf it grows from.
 */
export const GROUND_GLSL = /* glsl */ `
  uniform sampler2D uSplat;
  uniform sampler2D uFields;
  uniform sampler2D uBiome;
  uniform sampler2D uCover;
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
  uniform float uSnowLine;
  ${NOISE_GLSL}
  ${CLOUD_GLSL}
  ${ABBEY_GROUND_MASK_GLSL}
  vec2 worldUv(vec2 xz) { return xz / ${SIZE.toFixed(1)} + 0.5; }
  float insideWorld(vec2 xz) { return step(max(abs(xz.x), abs(xz.y)), ${(HALF - 1).toFixed(1)}); }

  vec3 grassColor(vec2 xz, vec3 biome, float broad, float fine) {
    vec3 g = mix(uGrassDark, uGrassMid, smoothstep(0.3, 0.66, broad));
    g = mix(g, uGrassLight, smoothstep(0.46, 0.74, fine) * 0.6);
    g = mix(g, uGrassDry, biome.b * 0.8);
    g = mix(g, uForestFloor, biome.r * 0.55);
    return g;
  }

  // What covers the ground at a point, before fine detail. All weights 0..1.
  struct Ground {
    vec3 color; vec3 grass; float grassAmount;
    float rock; float snow; float road; float cobble; float field; float sand; float wet;
  };

  Ground groundCover(vec3 wp, float ny) {
    Ground g;
    float inside = insideWorld(wp.xz);
    vec2 uv = worldUv(wp.xz);
    vec4 splat = texture2D(uSplat, uv) * inside;
    vec4 fields = texture2D(uFields, uv) * inside;
    vec4 biome = mix(vec4(0.0, 0.0, 0.0, 1.0), texture2D(uBiome, uv), inside);
    vec4 cover = texture2D(uCover, uv) * inside;
    float broad = gFbm(wp.xz * 0.0052);
    float mid = gFbm(wp.xz * 0.023 + 7.3);
    float fine = gFbm(wp.xz * 0.15 + 31.7);

    g.grass = grassColor(wp.xz, biome.rgb, mix(broad, mid, 0.45), fine);
    // Valley floors are lusher; pasture higher up is paler and yellower.
    g.grass = mix(g.grass, g.grass * vec3(0.8, 0.98, 0.78), cover.g * 0.55);
    g.grass = mix(g.grass, uGrassDry * 0.92, smoothstep(170.0, 520.0, wp.y + (mid - 0.5) * 120.0) * 0.7);
    // Beyond the walkable land, forest is painted rather than planted.
    float woods = (1.0 - inside) * smoothstep(0.42, 0.6, gFbm(wp.xz * 0.0031 + 11.0) + (0.9 - ny) * 0.55) * (1.0 - smoothstep(700.0, 1050.0, wp.y));
    g.grass = mix(g.grass, uForestFloor * (0.62 + 0.3 * fine), woods * 0.85);
    vec3 col = g.grass;
    col = mix(col, col * vec3(1.08, 1.06, 0.86), biome.g * 0.35);

    // Altitude: turf thins to scree, then snow lies wherever it is not too steep.
    float alt = wp.y + (mid - 0.5) * 90.0 + (broad - 0.5) * 160.0;
    float alpine = smoothstep(560.0, 900.0, alt);
    g.rock = smoothstep(0.82, 0.64, ny + (fine - 0.5) * 0.12 + (mid - 0.5) * 0.1);
    g.rock = max(g.rock, alpine * smoothstep(0.98, 0.86, ny + (fine - 0.5) * 0.1));
    vec3 rockCol = mix(uRockDark, uRock, smoothstep(0.3, 0.7, gFbm3(wp.xz * 0.045 + wp.y * 0.08)));
    // Bedding: bands that follow height, bent a little by the lie of the land.
    float strata = gNoise(vec2(wp.y * 0.3 + mid * 4.0 + broad * 9.0, 3.7));
    rockCol *= 0.8 + 0.34 * strata;
    rockCol = mix(rockCol, rockCol * vec3(1.1, 0.98, 0.84), smoothstep(0.42, 0.7, gFbm3(wp.xz * 0.009 + 3.0)));
    rockCol = mix(rockCol, vec3(0.52, 0.58, 0.72) * (0.75 + 0.4 * strata), smoothstep(700.0, 1900.0, wp.y) * 0.5);
    float scree = smoothstep(0.9, 0.78, ny + (fine - 0.5) * 0.1) * (1.0 - g.rock);
    col = mix(col, mix(uDirtDark, uRock, 0.55) * (0.85 + 0.3 * fine), scree * (0.25 + 0.75 * alpine));
    col = mix(col, rockCol, g.rock);

    g.snow = smoothstep(uSnowLine - 130.0, uSnowLine + 170.0, alt) * smoothstep(0.34, 0.62, ny + (fine - 0.5) * 0.08);
    col = mix(col, uSnow * (0.93 + 0.07 * fine), g.snow);

    // Shores: shingle where water laps, sand on the coast.
    g.wet = cover.r;
    float beach = smoothstep(3.4, 0.9, wp.y + (fine - 0.5) * 1.6) * (1.0 - g.rock);
    g.sand = max(beach, smoothstep(0.25, 0.7, cover.r + (fine - 0.5) * 0.3));
    vec3 shingle = mix(uSand, uRock, 0.45 * smoothstep(0.3, 0.9, cover.r) * (1.0 - beach)) * (0.86 + 0.24 * mid);
    col = mix(col, shingle, g.sand);
    col = mix(col, shingle * vec3(0.46, 0.62, 0.66), smoothstep(0.86, 1.0, cover.r) * 0.85);

    g.field = smoothstep(0.35, 0.6, fields.a);
    float turn = splat.b * 3.14159265;
    float furrow = sin(dot(wp.xz, vec2(-sin(turn), cos(turn))) * 4.2);
    col = mix(col, fields.rgb * (0.88 + 0.16 * furrow) * (0.9 + 0.2 * fine), g.field);

    g.cobble = smoothstep(-0.28, 0.28, (splat.g - 0.5) * 2.0 + (fine - 0.5) * 0.2);
    col = mix(col, uCobble * (0.9 + 0.16 * mid), g.cobble);
    g.road = smoothstep(-0.32, 0.32, (splat.r - 0.5) * 2.0 + (fine - 0.55) * 0.26);
    col = mix(col, mix(uDirtDark, uDirtLight, smoothstep(0.3, 0.7, fine)) * (0.9 + 0.2 * mid), g.road);

    g.grassAmount = (1.0 - g.road) * (1.0 - g.cobble) * (1.0 - g.field) * (1.0 - g.sand) * (1.0 - g.rock) * (1.0 - g.snow)
      * (1.0 - alpine * 0.85) * inside * abbeyGroundMask(wp.xz);
    g.color = col;
    return g;
  }

  // Returns the colour and how much grass may grow here (0..1).
  vec3 groundColor(vec3 wp, float ny, float dist, out float grassAmount, out vec3 grass) {
    Ground g = groundCover(wp, ny);
    grassAmount = g.grassAmount;
    grass = g.grass;
    return g.color;
  }
`;

export const groundUniforms = {
  uSplat: { value: null as THREE.Texture | null },
  uFields: { value: null as THREE.Texture | null },
  uBiome: { value: null as THREE.Texture | null },
  uCover: { value: null as THREE.Texture | null },
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
  uSnowLine: { value: 1250 },
  uCloudDrift: shared.uCloudDrift,
};

/** Quads along one side of a terrain patch. */
const GRID = 32;
/** Side of the finest patch in metres; every level above doubles it. */
const LEAF = 64;
const LEVELS = Math.round(Math.log2(MACRO_HALF * 2 / LEAF)) + 1;
const MAX_NODES = 3072;

/** Vertex code shared by the lit material and the shadow depth material. */
function landVertexGLSL(cell: number, n: number, farCell: number, farN: number): string {
  return /* glsl */ `
    attribute vec4 aNode;
    uniform sampler2D uHeight;
    uniform sampler2D uFarHeight;
    uniform float uSplit;
    varying vec3 vLand;
    float bilinear(sampler2D tex, vec2 g, int last) {
      ivec2 i = clamp(ivec2(floor(g)), ivec2(0), ivec2(last - 1));
      vec2 f = clamp(g - vec2(i), 0.0, 1.0);
      float a = texelFetch(tex, i, 0).r, b = texelFetch(tex, i + ivec2(1, 0), 0).r;
      float c = texelFetch(tex, i + ivec2(0, 1), 0).r, d = texelFetch(tex, i + ivec2(1, 1), 0).r;
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float landHeight(vec2 xz) {
      if (max(abs(xz.x), abs(xz.y)) <= ${HALF.toFixed(1)}) return bilinear(uHeight, (xz + ${HALF.toFixed(1)}) / ${cell.toFixed(1)}, ${n});
      return bilinear(uFarHeight, (xz + ${MACRO_HALF.toFixed(1)}) / ${farCell.toFixed(1)}, ${farN});
    }
    vec3 landVertex(vec3 p) {
      float size = aNode.z, quad = size / ${GRID.toFixed(1)};
      vec2 cellPos = p.xz * ${GRID.toFixed(1)};
      vec2 xz = aNode.xy + cellPos * quad;
      // Odd vertices slide onto the coarser lattice as the patch nears the distance
      // at which its parent takes over, so levels of detail meet without popping.
      float d = distance(cameraPosition, vec3(xz.x, landHeight(xz), xz.y));
      float end = uSplit * size * 2.0;
      float morph = aNode.w > ${(LEVELS - 1.5).toFixed(1)} ? 0.0 : smoothstep(end * 0.7, end * 0.95, d);
      xz -= fract(cellPos * 0.5) * 2.0 * quad * morph;
      // A skirt hangs from every edge and hides any hairline gap between patches.
      return vec3(xz.x, landHeight(xz) - (p.y < 0.0 ? quad * 1.5 + 1.0 : 0.0), xz.y);
    }
  `;
}

export interface Terrain {
  object: THREE.Mesh;
  /** Chooses the patches to draw for this camera. Call once per frame. */
  update: (camera: THREE.PerspectiveCamera) => void;
  material: THREE.MeshStandardMaterial;
}

export function createTerrain(heightTex: THREE.Texture, maps: LandMaps, split: number): Terrain {
  const { cell, n } = grid();
  groundUniforms.uCover.value = maps.cover;

  // One patch: a grid with a skirt, instanced for every visible quadtree node.
  const positions: number[] = [], index: number[] = [];
  const side = GRID + 1;
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) positions.push(i / GRID, 0, j / GRID);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const rim: number[] = [];
  for (let i = 0; i < GRID; i++) rim.push(i);
  for (let j = 0; j < GRID; j++) rim.push(j * side + GRID);
  for (let i = GRID; i > 0; i--) rim.push(GRID * side + i);
  for (let j = GRID; j > 0; j--) rim.push(j * side);
  const first = positions.length / 3;
  for (const v of rim) positions.push(positions[v * 3], -1, positions[v * 3 + 2]);
  for (let k = 0; k < rim.length; k++) {
    const a = rim[k], b = rim[(k + 1) % rim.length], c = first + k, d = first + (k + 1) % rim.length;
    index.push(a, b, c, b, d, c);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  geo.setIndex(index);
  const nodes = new Float32Array(MAX_NODES * 4);
  const nodeAttr = new THREE.InstancedBufferAttribute(nodes, 4);
  nodeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aNode', nodeAttr);
  geo.instanceCount = 0;

  const uniforms = {
    ...groundUniforms,
    uHeight: { value: heightTex }, uFarHeight: { value: maps.farHeight }, uSplit: { value: split },
    uLand: { value: maps.land }, uFarLand: { value: maps.far },
  };
  const vertex = landVertexGLSL(cell, n, maps.farCell, maps.farN);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
  mat.name = 'land';
  mat.customProgramCacheKey = () => `land-v1-${cell}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertex}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', 'vec3 transformed = landVertex(position);\nvLand = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLand;
        uniform sampler2D uLand;
        uniform sampler2D uFarLand;
        ${GROUND_GLSL}
        // Relief from a height value, without tangents: perturb along screen derivatives.
        vec3 bumped(vec3 n, vec3 viewPos, float h) {
          vec3 dx = dFdx(viewPos), dy = dFdy(viewPos);
          vec3 r1 = cross(dy, n), r2 = cross(n, dx);
          float det = dot(dx, r1);
          return normalize(abs(det) * n - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
        }`)
      .replace('#include <color_fragment>', `
        float landInside = insideWorld(vLand.xz);
        vec4 landMap = mix(texture2D(uFarLand, vLand.xz / ${(MACRO_HALF * 2).toFixed(1)} + 0.5), texture2D(uLand, worldUv(vLand.xz)), landInside);
        vec2 landXZ = landMap.rg * 2.0 - 1.0;
        vec3 landN = vec3(landXZ.x, sqrt(max(1e-4, 1.0 - dot(landXZ, landXZ))), landXZ.y);
        float landDist = length(cameraPosition - vLand);
        Ground ground = groundCover(vLand, landN.y);
        vec3 landCol = ground.color;
        float landRough = 0.95;
        float landRelief = 0.0;
        // Brushwork near the eye: dabs on turf, pebbles on tracks and shores, cracks on rock.
        float nearK = 1.0 - smoothstep(140.0, 520.0, landDist);
        float midK = 1.0 - smoothstep(700.0, 2600.0, landDist);
        if (midK > 0.0) {
          vec3 d1 = texture2D(uDetail, vLand.xz * 0.15).rgb;
          vec3 d2 = texture2D(uDetail, vLand.xz * 0.031 + 0.37).rgb;
          vec3 d3 = texture2D(uDetail, vLand.xz * 0.0071 + 0.61).rgb;
          vec3 face = abs(landN);
          vec2 cliffUv = face.x > face.z ? vLand.zy : vLand.xy;
          vec3 c1 = texture2D(uDetail, cliffUv * vec2(0.07, 0.11)).rgb;
          vec3 c2 = texture2D(uDetail, cliffUv * vec2(0.017, 0.029) + 0.21).rgb;
          float turf = (d1.r - 0.5) * 0.7 * nearK + (d2.r - 0.5) * 0.8 * mix(0.5, 1.0, nearK) + (d3.r - 0.5) * 0.7;
          float soft = 1.0 - max(max(ground.rock, ground.snow), max(ground.road, max(ground.cobble, ground.sand)));
          landCol *= 1.0 + turf * 0.4 * soft * midK;
          landCol += vec3(0.05, 0.045, -0.02) * max(turf, 0.0) * soft * midK;
          float stones = (d1.g - 0.5) * nearK + (d2.g - 0.5) * 0.6;
          float hard = max(ground.road, max(ground.sand, ground.cobble));
          landCol *= 1.0 + stones * 0.55 * hard * midK;
          float crack = mix(d2.b, c1.b, smoothstep(0.75, 0.5, landN.y)) * 0.6 + c2.b * 0.6 - 0.6;
          landCol *= 1.0 + crack * 0.75 * ground.rock * midK;
          // Paving: staggered setts with dark joints, only where it can be resolved.
          vec2 q = vLand.xz * 1.5; q.x += floor(q.y) * 0.5;
          vec2 f = fract(q) - 0.5;
          float joint = smoothstep(0.36, 0.47, max(abs(f.x), abs(f.y))) * nearK * ground.cobble;
          landCol = mix(landCol * (1.0 + (gHash(floor(q)) - 0.5) * 0.26 * nearK * ground.cobble), landCol * 0.55, joint);
          landRelief = (turf * 0.05 * soft + stones * 0.06 * hard + crack * 0.5 * ground.rock - joint * 0.05) * nearK
            + crack * 1.6 * ground.rock * midK * (1.0 - nearK);
          landRough = mix(landRough, 0.82, ground.rock * 0.5 + ground.cobble * 0.4);
        }
        landRough = mix(landRough, 0.55, ground.snow);
        landRough = mix(landRough, 0.35, smoothstep(0.8, 1.0, ground.wet));
        diffuseColor.rgb = landCol * cloudShadow(vLand.xz);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = landRough;')
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = 1.0;
        vec3 normal = normalize(mat3(viewMatrix) * landN);
        normal = bumped(normal, -vViewPosition, landRelief);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <aomap_fragment>', `
        // Baked: hollows receive less sky, and far ridges shadow the valleys behind them.
        float landSun = mix(1.0, landMap.a, 0.92);
        reflectedLight.directDiffuse *= landSun;
        reflectedLight.directSpecular *= landSun;
        float landAo = mix(0.45, 1.0, smoothstep(0.0, 0.72, landMap.b));
        reflectedLight.indirectDiffuse *= landAo;
        reflectedLight.indirectSpecular *= landAo;`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Land';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;

  const pyramid = buildHeightPyramid();
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), box = new THREE.Box3(), eye = new THREE.Vector3();
  let count = 0;
  const visit = (level: number, i: number, j: number): void => {
    const size = LEAF * 2 ** level, x = i * size - MACRO_HALF, z = j * size - MACRO_HALF;
    const range = pyramid.levels[level], c = j * range.side + i;
    box.min.set(x, range.min[c], z);
    box.max.set(x + size, range.max[c], z + size);
    if (!frustum.intersectsBox(box)) return;
    if (level > 0 && box.distanceToPoint(eye) < split * size) {
      for (let q = 0; q < 4; q++) visit(level - 1, i * 2 + (q & 1), j * 2 + (q >> 1));
      return;
    }
    if (count >= MAX_NODES) return;
    nodes.set([x, z, size, level], count * 4);
    count++;
  };
  return {
    object: mesh, material: mat,
    update(camera) {
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      eye.copy(camera.position);
      count = 0;
      visit(LEVELS - 1, 0, 0);
      geo.instanceCount = count;
      nodeAttr.addUpdateRange(0, count * 4);
      nodeAttr.needsUpdate = true;
    },
  };
}
