import * as THREE from 'three';
import { grassTexture } from '../render/textures';
import { shared } from '../render/uniforms';
import { seededRandom } from './noise';
import { GROUND_GLSL, groundUniforms } from './terrain';
import { SIZE } from './layout';

/** An upright card three rows tall, so it can bend. The tuft is painted on it. */
function bladeGeometry(width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const y of [0, 0.5, 1]) positions.push(-0.5 * width, y, 0, 0.5 * width, y, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Placeholder: the shader takes the real normal from the terrain. Without
  // this attribute three.js falls back to flat shading.
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  return geo;
}

/**
 * Grass that is always around the player: blades sit on a repeating tile of
 * side `tile` that wraps as the player moves, and read their height and colour
 * from the terrain maps in the vertex shader. Nothing is rebuilt on the CPU.
 */
function createLayer(
  count: number,
  tile: number,
  width: number,
  minH: number,
  maxH: number,
  heightTex: THREE.Texture,
  tuft: THREE.Texture,
  seed: number,
): THREE.Mesh {
  const geo = new THREE.InstancedBufferGeometry();
  const blade = bladeGeometry(width);
  geo.setAttribute('position', blade.attributes.position);
  geo.setAttribute('normal', blade.attributes.normal);
  geo.setIndex(blade.index);
  const cells = new Float32Array(count * 4);
  const rand = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    cells.set([rand() * tile, rand() * tile, rand() * Math.PI, minH + rand() * rand() * (maxH - minH) * 1.6], i * 4);
  }
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));
  geo.instanceCount = count;

  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  // Programs are cached by shader text; the tile size is baked in, so key on it.
  mat.customProgramCacheKey = () => `grass-${tile}-${width}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms, {
      uHeight: { value: heightTex },
      uTuft: { value: tuft },
      uTime: shared.uTime,
      uWindDir: shared.uWindDir,
      uWindStrength: shared.uWindStrength,
      uGust: shared.uGust,
      uWindTravel: shared.uWindTravel,
      uPlayer: shared.uPlayer,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aCell;
        uniform sampler2D uHeight;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform float uGust;
        uniform vec2 uWindTravel;
        uniform vec3 uPlayer;
        varying vec3 vBlade;
        varying vec2 vTuftUv;
        ${GROUND_GLSL}
        float terrainHeight(vec2 xz) { return texture2D(uHeight, worldUv(xz)).r; }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `const float TILE = ${tile.toFixed(1)};
        vec2 rel = mod(aCell.xy - uPlayer.xz + TILE * 0.5, TILE) - TILE * 0.5;
        vec2 root = uPlayer.xz + rel;
        float ground = terrainHeight(root);
        vec3 objectNormal = normalize(vec3(
          terrainHeight(root - vec2(3.0, 0.0)) - terrainHeight(root + vec2(3.0, 0.0)),
          6.0,
          terrainHeight(root - vec2(0.0, 3.0)) - terrainHeight(root + vec2(0.0, 3.0))));
        float flatness = texture2D(uBiome, worldUv(root)).a;
        float grassAmount;
        vec3 grassTint;
        groundColor(vec3(root.x, ground, root.y), flatness, 1000.0, grassAmount, grassTint);
        float edge = 1.0 - smoothstep(TILE * 0.36, TILE * 0.49, length(rel));
        float bladeHeight = aCell.w * smoothstep(0.35, 0.8, grassAmount) * edge * step(0.25, ground);`,
      )
      .replace(
        '#include <begin_vertex>',
        `float tip = position.y;
        float cs = cos(aCell.z);
        float sn = sin(aCell.z);
        vec3 transformed = vec3(root.x + position.x * cs, ground - 0.05 + tip * bladeHeight, root.y + position.x * sn);
        // Wind: slow rolling gusts plus a quick shiver, both travelling downwind.
        float roll = gNoise((root - uWindTravel) * 0.045);
        float shiver = sin(dot(root, uWindDir) * 1.1 - uTime * 3.0 + gHash(aCell.xy) * 6.28) * 0.5 + 0.5;
        float bend = (0.05 + uWindStrength * (0.75 * roll + 0.22 * shiver)) * tip * tip * bladeHeight;
        // The player pushes blades aside.
        vec2 away = root - uPlayer.xz;
        float push = (1.0 - smoothstep(0.2, 1.1, length(away))) * step(abs(uPlayer.y - ground), 1.2);
        transformed.xz += uWindDir * bend + normalize(away + 0.001) * push * 0.45 * tip;
        transformed.y -= (bend * bend * 0.6 + push * 0.3 * tip) * step(0.01, bladeHeight);
        // Mirror half the tufts so they do not all look alike.
        vTuftUv = vec2(aCell.z > 1.57 ? 0.5 - position.x / ${width.toFixed(3)} : 0.5 + position.x / ${width.toFixed(3)}, tip);
        vBlade = grassTint + vec3(0.1, 0.11, 0.04) * roll * uGust * tip;
        vBlade *= cloudShadow(root);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBlade;\nvarying vec2 vTuftUv;\nuniform sampler2D uTuft;')
      .replace(
        '#include <color_fragment>',
        `vec4 tuft = texture2D(uTuft, vTuftUv);
        if (tuft.a < 0.38) discard;
        // The painting carries the shading: dark roots, sunlit tips.
        diffuseColor.rgb = vBlade * (0.42 + 1.0 * tuft.r) + vec3(0.03, 0.05, 0.0) * tuft.r * tuft.r;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`,
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Wild flowers, scattered the same way but only where the biome map allows. */
function createFlowers(count: number, tile: number, heightTex: THREE.Texture): THREE.Mesh {
  const geo = new THREE.InstancedBufferGeometry();
  // A six-petalled disc tilted toward the viewer, with a centre dot.
  const positions: number[] = [];
  const kinds: number[] = [];
  const petal = 0.062;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    positions.push(0, 0, 0, Math.cos(a0) * petal * 0.8, 0, Math.sin(a0) * petal * 0.8, Math.cos(am) * petal, 0.01, Math.sin(am) * petal);
    positions.push(0, 0, 0, Math.cos(am) * petal, 0.01, Math.sin(am) * petal, Math.cos(a1) * petal * 0.8, 0, Math.sin(a1) * petal * 0.8);
    kinds.push(0, 0, 0, 0, 0, 0);
  }
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    positions.push(0, 0.02, 0, Math.cos(a0) * 0.022, 0.02, Math.sin(a0) * 0.022, Math.cos(a1) * 0.022, 0.02, Math.sin(a1) * 0.022);
    kinds.push(1, 1, 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  const cells = new Float32Array(count * 4);
  const rand = seededRandom(404);
  for (let i = 0; i < count; i++) cells.set([rand() * tile, rand() * tile, rand(), rand()], i * 4);
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));
  geo.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aCell;
      attribute float aKind;
      uniform sampler2D uHeight;
      uniform sampler2D uBiome;
      uniform sampler2D uSplat;
      uniform vec3 uPlayer;
      uniform vec2 uWindDir;
      uniform vec2 uWindTravel;
      uniform float uWindStrength;
      varying vec3 vColor;
      float hash1(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise1(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), f.x), mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        const float TILE = ${tile.toFixed(1)};
        vec2 rel = mod(aCell.xy - uPlayer.xz + TILE * 0.5, TILE) - TILE * 0.5;
        vec2 root = uPlayer.xz + rel;
        vec2 uv = root / ${SIZE.toFixed(1)} + 0.5;
        float ground = texture2D(uHeight, uv).r;
        vec4 biome = texture2D(uBiome, uv);
        vec4 splat = texture2D(uSplat, uv);
        float allowed = step(aCell.w, biome.g * 1.15) * step(max(splat.r, max(splat.g, splat.b)), 0.25)
          * step(2.2, ground) * step(ground, 95.0) * step(0.8, biome.a);
        float edge = 1.0 - smoothstep(TILE * 0.36, TILE * 0.49, length(rel));
        float size = (0.7 + aCell.z * 0.8) * allowed * edge;

        float roll = noise1((root - uWindTravel) * 0.045);
        float stem = 0.34 + aCell.z * 0.3;
        vec2 lean = uWindDir * uWindStrength * roll * 0.3;
        // Tilt the flower head so it faces a little toward the camera.
        vec3 p = position * size;
        float tilt = 0.6;
        p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
        float turn = aCell.z * 6.28;
        p = vec3(p.x * cos(turn) - p.z * sin(turn), p.y, p.x * sin(turn) + p.z * cos(turn));
        vec3 world = vec3(root.x + lean.x, ground + stem * step(0.01, size), root.y + lean.y) + p;

        // Colour varies in drifts across the land.
        float drift = noise1(root * 0.03 + 7.0);
        float pick = fract(aCell.w * 7.3 + drift * 1.7);
        vec3 petal = vec3(0.98, 0.97, 0.92);
        if (pick > 0.45) petal = vec3(0.98, 0.83, 0.25);
        if (pick > 0.65) petal = vec3(0.86, 0.38, 0.5);
        if (pick > 0.8) petal = vec3(0.62, 0.48, 0.9);
        if (pick > 0.92) petal = vec3(0.92, 0.3, 0.22);
        vec3 centre = pick > 0.45 && pick <= 0.65 ? vec3(0.75, 0.42, 0.12) : vec3(0.97, 0.76, 0.2);
        vColor = mix(petal, centre, aKind);

        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor * vColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, {
    uHeight: { value: heightTex },
    uBiome: groundUniforms.uBiome,
    uSplat: groundUniforms.uSplat,
    uPlayer: shared.uPlayer,
    uWindDir: shared.uWindDir,
    uWindTravel: shared.uWindTravel,
    uWindStrength: shared.uWindStrength,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function createGrass(
  near: number,
  far: number,
  flowers: number,
  heightTex: THREE.Texture,
): THREE.Group {
  const group = new THREE.Group();
  const tuft = grassTexture();
  group.add(createLayer(near, 46, 0.62, 0.42, 0.85, heightTex, tuft, 1));
  group.add(createLayer(far, 170, 1.7, 0.6, 1.15, heightTex, tuft, 2));
  group.add(createFlowers(flowers, 90, heightTex));
  return group;
}
