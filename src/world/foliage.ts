import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { seededRandom } from './noise';

export type Part = [number, number, number, number];

export interface FoliageLook {
  texture: THREE.Texture;
  /** Multiplier for the tint in shade and in full light. */
  dark: [number, number, number];
  light: [number, number, number];
}

/**
 * Leaves as camera-facing cards cut out with a painted texture. Each card
 * carries the normal of the crown it sits on, so the whole tree shades as one
 * rounded mass while its edge breaks up into individual leaves.
 */
export function foliageMaterial(look: FoliageLook, sunDir: THREE.Vector3): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 aCorner;
      attribute vec2 aCard;
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform vec2 uWindTravel;
      uniform float uWindStrength;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vTint;
      varying vec2 vXZ;
      varying float vRand;
      ${NOISE_GLSL}
      void main() {
        mat4 world = modelMatrix * instanceMatrix;
        vec4 wp = world * vec4(position, 1.0);
        vec3 origin = world[3].xyz;
        float scale = length(instanceMatrix[0].xyz);
        float lift = max(wp.y - origin.y, 0.0);
        float roll = gNoise((origin.xz - uWindTravel) * 0.03);
        float flutter = sin(uTime * (2.0 + aCard.y * 2.5) + aCard.y * 40.0 + wp.x);
        wp.xz += uWindDir * uWindStrength * lift * 0.022 * (0.35 + roll + 0.2 * flutter);
        vec4 mvPosition = viewMatrix * wp;
        // Each card is turned a different way, and rustles in the wind.
        float turn = (aCard.y - 0.5) * 2.6 + flutter * 0.1 * (0.3 + uWindStrength);
        vec2 c = vec2(aCorner.x * cos(turn) - aCorner.y * sin(turn), aCorner.x * sin(turn) + aCorner.y * cos(turn));
        mvPosition.xy += c * aCard.x * scale;
        vUv = aCorner * 0.5 + 0.5;
        vN = normalize(mat3(world) * normal);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(0.3, 0.6, 0.25);
        #endif
        vXZ = wp.xz;
        vRand = aCard.y;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uLeaf;
      uniform vec3 uSunDir;
      uniform vec3 uDark;
      uniform vec3 uLight;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vTint;
      varying vec2 vXZ;
      varying float vRand;
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      void main() {
        vec4 t = texture2D(uLeaf, vUv);
        if (t.a < 0.45) discard;
        vec3 n = normalize(vN);
        // Three painted tones; the leaf texture nudges where one gives way to the next.
        float l = dot(n, uSunDir) * 0.5 + 0.5;
        l += (t.r - 0.68) * 0.5 + (vRand - 0.5) * 0.14 - max(-n.y, 0.0) * 0.18;
        vec3 col = mix(vTint * uDark, vTint, smoothstep(0.36, 0.5, l));
        col = mix(col, vTint * uLight + vec3(0.05, 0.06, 0.0), smoothstep(0.68, 0.82, l));
        col *= cloudShadow(vXZ);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, {
    uLeaf: { value: look.texture },
    uSunDir: { value: sunDir },
    uDark: { value: new THREE.Vector3(...look.dark) },
    uLight: { value: new THREE.Vector3(...look.light) },
    uTime: shared.uTime,
    uWindDir: shared.uWindDir,
    uWindTravel: shared.uWindTravel,
    uWindStrength: shared.uWindStrength,
    uCloudDrift: shared.uCloudDrift,
  });
  return mat;
}

/**
 * Scatters cards over the surface of a cluster of spheres.
 * @param density cards per square metre of sphere radius squared
 * @param size half-width of a card, as a fraction of its sphere's radius
 */
export function leafCards(parts: Part[], density: number, size: number, seed: number): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const centre = new THREE.Vector3();
  let weight = 0;
  for (const [x, y, z, r] of parts) {
    centre.add(new THREE.Vector3(x, y, z).multiplyScalar(r * r));
    weight += r * r;
  }
  centre.divideScalar(weight);

  const pos: number[] = [];
  const nor: number[] = [];
  const corner: number[] = [];
  const card: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const out = new THREE.Vector3();
  let biggest = 0;
  parts.forEach(([x, y, z, r], pi) => {
    const count = Math.max(4, Math.round(density * r * r));
    for (let i = 0; i < count; i++) {
      // Evenly spread directions, skipping most of the underside.
      const t = (i + 0.5) / count;
      const dy = 1 - t * 1.72;
      const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
      const a = i * 2.39996 + pi;
      n.set(Math.cos(a) * ring, dy, Math.sin(a) * ring);
      p.set(x, y, z).addScaledVector(n, r * (0.86 + rand() * 0.14));
      // A card buried inside a neighbouring sphere would never be seen.
      if (parts.some(([ox, oy, oz, or], oi) => oi !== pi && p.distanceTo(out.set(ox, oy, oz)) < or * 0.72)) continue;
      out.copy(p).sub(centre).normalize();
      n.multiplyScalar(0.55).addScaledVector(out, 0.45).normalize();
      const s = r * size * (0.8 + rand() * 0.45);
      biggest = Math.max(biggest, s);
      const seedOfCard = rand();
      const base = pos.length / 3;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        corner.push(cx, cy);
        card.push(s, seedOfCard);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  geo.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.boundingSphere!.radius += biggest * 1.5;
  return geo;
}
