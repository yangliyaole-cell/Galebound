import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { grassTexture } from '../render/textures';
import { shared } from '../render/uniforms';
import { seededRandom } from './noise';

/**
 * Lawns in gardens and courts: turf that is mottled, a little worn and, where it is
 * kept, mown in stripes, with short grass growing thick out of it. Builders mark out
 * a lawn here; the turf and the grass are made once everything is built.
 */
interface Lawn {
  x: number; z: number; w: number; d: number; y: number; rot: number;
  stripes: boolean;
  /** False where something stands on the lawn: a path, a bed, a fountain. */
  keep?: (x: number, z: number) => boolean;
}
const lawns: Lawn[] = [];

export function lawn(x: number, z: number, w: number, d: number, y: number, rot = 0,
  options: { stripes?: boolean; keep?: (x: number, z: number) => boolean } = {}): void {
  lawns.push({ x, z, w, d, y, rot, stripes: options.stripes ?? false, keep: options.keep });
}

/** Turf colour at a point, shared by the ground and the blades growing from it. */
const TURF_GLSL = /* glsl */ `
  vec3 turfColour(vec2 p, vec3 stripe) {
    float m = gNoise(p * 0.31) * 0.55 + gNoise(p * 1.9 + 4.0) * 0.3 + gNoise(p * 6.3 - 2.0) * 0.15;
    vec3 c = mix(vec3(0.062, 0.15, 0.03), vec3(0.135, 0.255, 0.05), m);
    // Mown in alternate directions: the light catches every other stripe.
    float band = step(0.5, fract(dot(p, stripe.xy) / 1.5));
    c *= mix(1.0, mix(0.82, 1.1, band), stripe.z);
    // Worn, drier patches where people walk and the sun beats down.
    c = mix(c, vec3(0.19, 0.22, 0.07), smoothstep(0.68, 0.9, gNoise(p * 0.17 + 11.0)) * 0.45);
    return c;
  }
  // A scatter of small daisies, each a round white dot with a yellow eye.
  vec3 daisies(vec2 p, vec3 c) {
    vec2 cell = floor(p * 5.0), f = fract(p * 5.0) - 0.5 - (vec2(gHash(cell + 3.1), gHash(cell + 7.7)) - 0.5) * 0.5;
    float r = length(f), here = step(0.955, gHash(cell));
    c = mix(c, vec3(0.8, 0.8, 0.74), here * (1.0 - smoothstep(0.07, 0.1, r)));
    return mix(c, vec3(0.75, 0.55, 0.08), here * (1.0 - smoothstep(0.025, 0.04, r)));
  }
`;

export function createLawns(detail: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lawns';
  const all = lawns.splice(0);
  if (!all.length) return group;
  const wind = { uTime: shared.uTime, uWindDir: shared.uWindDir, uWindStrength: shared.uWindStrength, uWindTravel: shared.uWindTravel, uCloudDrift: shared.uCloudDrift };

  // ---- the turf: one quad per lawn, carrying the direction of its mowing
  const pos: number[] = [], stripe: number[] = [], index: number[] = [];
  for (const l of all) {
    const c = Math.cos(l.rot), s = Math.sin(l.rot), base = pos.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = u * l.w / 2, lz = v * l.d / 2;
      pos.push(l.x + lx * c + lz * s, l.y + 0.012, l.z - lx * s + lz * c);
      stripe.push(c, -s, l.stripes ? 1 : 0);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const turf = new THREE.BufferGeometry();
  turf.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  turf.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  turf.setAttribute('aStripe', new THREE.Float32BufferAttribute(stripe, 3));
  turf.setIndex(index);
  const turfMaterial = new THREE.MeshLambertMaterial();
  turfMaterial.customProgramCacheKey = () => 'lawn-turf';
  turfMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aStripe;\nvarying vec3 vStripe;\nvarying vec2 vTurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripe = aStripe; vTurf = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vStripe;\nvarying vec2 vTurf;\n${NOISE_GLSL}\n${CLOUD_GLSL}\n${TURF_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Close-set blades read as a fine grain in the turf.
        diffuseColor.rgb = daisies(vTurf, turfColour(vTurf, vStripe) * (0.8 + 0.38 * gNoise(vTurf * 27.0))) * cloudShadow(vTurf);`);
  };
  const ground = new THREE.Mesh(turf, turfMaterial);
  ground.receiveShadow = true;
  ground.name = 'lawn-turf';
  group.add(ground);

  // ---- the grass: short tufts, thick on the turf
  const density = detail > 1 ? 30 : detail > 0 ? 20 : 9;
  const roots: number[] = [], sizes: number[] = [], stripes: number[] = [];
  const rand = seededRandom(733);
  for (const l of all) {
    const c = Math.cos(l.rot), s = Math.sin(l.rot), count = Math.round(l.w * l.d * density);
    for (let i = 0; i < count; i++) {
      const lx = (rand() - 0.5) * (l.w - 0.1), lz = (rand() - 0.5) * (l.d - 0.1);
      const x = l.x + lx * c + lz * s, z = l.z - lx * s + lz * c;
      const turn = rand() * Math.PI, tall = 0.07 + rand() * rand() * 0.12, wide = 0.2 + rand() * 0.12;
      if (l.keep && !l.keep(x, z)) continue;
      roots.push(x, l.y, z, turn);
      // Mown grass is shorter; the edges grow a little longer.
      const edge = Math.min(l.w / 2 - Math.abs(lx), l.d / 2 - Math.abs(lz));
      sizes.push(tall * (l.stripes ? 0.85 : 1.15) * (1 + 0.5 * (1 - Math.min(1, edge / 0.4))), wide);
      stripes.push(c, -s, l.stripes ? 1 : 0);
    }
  }
  const blade = new THREE.InstancedBufferGeometry();
  const bladePos: number[] = [];
  for (const y of [0, 0.5, 1]) bladePos.push(-0.5, y, 0, 0.5, y, 0);
  blade.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(bladePos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  blade.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  blade.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(roots), 4));
  blade.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 2));
  blade.setAttribute('aStripe', new THREE.InstancedBufferAttribute(new Float32Array(stripes), 3));
  blade.instanceCount = roots.length / 4;
  let low = Infinity, high = -Infinity;
  const box = new THREE.Box3();
  for (let i = 0; i < roots.length; i += 4) {
    box.expandByPoint(new THREE.Vector3(roots[i], roots[i + 1], roots[i + 2]));
    low = Math.min(low, roots[i + 1]); high = Math.max(high, roots[i + 1]);
  }
  blade.boundingSphere = box.isEmpty() ? new THREE.Sphere() : box.expandByScalar(1).getBoundingSphere(new THREE.Sphere());
  const tuft = grassTexture();
  const bladeMaterial = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  bladeMaterial.customProgramCacheKey = () => 'lawn-blades';
  bladeMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind, { uTuft: { value: tuft } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRoot; attribute vec2 aSize; attribute vec3 aStripe;
        uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength; uniform vec2 uWindTravel;
        varying vec2 vTuftUv; varying vec3 vStripe; varying vec2 vTurf; varying float vTip;
        ${NOISE_GLSL}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', `
        float far = distance(cameraPosition, aRoot.xyz);
        // Short grass is lost to the eye long before the turf is: it shrinks away by 70 m.
        float tall = aSize.x * (1.0 - smoothstep(45.0, 70.0, far));
        vec2 across = vec2(cos(aRoot.w), sin(aRoot.w)) * position.x * aSize.y;
        float tip = position.y;
        vec3 transformed = vec3(aRoot.x + across.x, aRoot.y + tip * tall, aRoot.z + across.y);
        float roll = gNoise((aRoot.xz - uWindTravel) * 0.05);
        transformed.xz += uWindDir * (0.04 + uWindStrength * 0.6 * roll) * tip * tip * tall;
        vTuftUv = vec2(position.x + 0.5, tip);
        vStripe = aStripe; vTurf = aRoot.xz; vTip = tip;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTuft;
        varying vec2 vTuftUv; varying vec3 vStripe; varying vec2 vTurf; varying float vTip;
        ${NOISE_GLSL}\n${CLOUD_GLSL}\n${TURF_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 t = texture2D(uTuft, vTuftUv);
        if (t.a < 0.38) discard;
        // Dark at the root where it meets the turf, sunlit and yellower at the tips.
        diffuseColor.rgb = turfColour(vTurf, vStripe) * (0.55 + 0.95 * t.r) * cloudShadow(vTurf) + vec3(0.02, 0.03, 0.0) * vTip;`)
      // Both faces of a blade are lit as the turf is, facing the sky.
      .replace('#include <normal_fragment_begin>', `float faceDirection = 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`);
  };
  const grass = new THREE.Mesh(blade, bladeMaterial);
  grass.receiveShadow = true;
  grass.name = 'lawn-grass';
  group.add(grass);
  group.userData.tufts = blade.instanceCount;
  return group;
}
