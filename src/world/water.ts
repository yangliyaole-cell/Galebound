import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { SIZE, WATER_LEVEL } from './layout';
import { TERRAIN_HEIGHT_GLSL, heightSamplingUniforms } from './heightmap';
import { ALPINE_LAKES, ALPINE_STREAM } from './mountain-layout';
import { sstep } from './heightmap';

/** CPU reference for checking the fragment's depth/foam/alpha/color inputs.
 * Heights come from the actual uploaded float texture in check-layout. */
export function waterFragmentSample(ground: number, level: number, wobble = 0.5, lapPhase = 0.5): {
  depth: number; alpha: number; foam: number; color: number[];
} {
  const depth = Math.max(level - ground, 0);
  const shore = 1 - sstep(0, 0.55, depth - wobble * 0.3);
  const lap = sstep(0.55, 0.8, lapPhase) * (1 - sstep(0.4, 1.6, depth));
  const foam = Math.max(0, Math.min(1, shore + lap * 0.6));
  const alpha = Math.max(0.5 + (0.94 - 0.5) * sstep(0, 2.6, depth), foam) * sstep(0, 0.06, depth);
  const color = new THREE.Color(0x62d2cf).lerp(new THREE.Color(0x1f6fb5), sstep(0, 6, depth))
    .lerp(new THREE.Color(0xffffff), foam * 0.9).toArray();
  return { depth, alpha, foam, color };
}

/** One flat sheet for sea, lake and river; the terrain's height decides its look. */
export function createWater(heightTex: THREE.Texture, sunDir: THREE.Vector3, horizon: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uShallow: { value: new THREE.Color(0x62d2cf) },
        uDeep: { value: new THREE.Color(0x1f6fb5) },
        uSky: { value: new THREE.Color(horizon) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uHeight;
      uniform float uCell;
      uniform int uN;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWPos;
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      ${TERRAIN_HEIGHT_GLSL}
      void main() {
        vec2 p = vWPos.xz;
        vec2 uv = p / ${SIZE.toFixed(1)} + 0.5;
        float ground = -22.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ground = terrainHeight(p);
        float depth = max(vWPos.y - ground, 0.0);

        vec3 view = normalize(cameraPosition - vWPos);
        float dist = length(cameraPosition - vWPos);
        float t = uTime;
        float rippleFade = 1.0 - smoothstep(150.0, 500.0, dist);
        float nx = gNoise(p * 0.45 + vec2(t * 0.5, t * 0.2)) + gNoise(p * 1.3 - vec2(t * 0.3, t * 0.6)) * 0.5 - 0.75;
        float nz = gNoise(p * 0.45 + vec2(13.0 - t * 0.2, 7.0 + t * 0.45)) + gNoise(p * 1.3 + vec2(t * 0.5, -t * 0.25) + 31.0) * 0.5 - 0.75;
        vec3 normal = normalize(vec3(nx * 0.35 * rippleFade, 1.0, nz * 0.35 * rippleFade));

        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 6.0, depth));
        float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
        col = mix(col, uSky, fresnel * 0.65);
        col *= cloudShadow(p);

        // Painted highlights: sun glints and drifting light streaks.
        float glint = pow(max(dot(reflect(-uSunDir, normal), view), 0.0), 90.0);
        col += vec3(1.0, 0.97, 0.88) * smoothstep(0.35, 0.6, glint) * 0.8;
        float streak = gNoise(vec2(p.x * 0.05 + t * 0.03, p.y * 0.5 - t * 0.12));
        col += vec3(0.1) * smoothstep(0.74, 0.8, streak) * rippleFade * smoothstep(1.0, 4.0, depth);

        // Foam where the water meets land.
        float wobble = gNoise(p * 0.9 + vec2(t * 0.4, -t * 0.3));
        float shore = 1.0 - smoothstep(0.0, 0.55, depth - wobble * 0.3);
        float lap = smoothstep(0.55, 0.8, sin(depth * 5.0 - t * 1.6 + wobble * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.4, 1.6, depth));
        float foam = clamp(shore + lap * 0.6, 0.0, 1.0);
        col = mix(col, vec3(1.0), foam * 0.9);

        float alpha = mix(0.5, 0.94, smoothstep(0.0, 2.6, depth));
        alpha = max(alpha, foam);
        alpha *= smoothstep(0.0, 0.06, depth);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, heightSamplingUniforms(heightTex));
  mat.uniforms.uSunDir = { value: sunDir };
  mat.uniforms.uTime = shared.uTime;
  mat.uniforms.uCloudDrift = shared.uCloudDrift;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), mat);
  mesh.position.y = WATER_LEVEL;
  mesh.renderOrder = 1;
  // Lake fans and a descending ribbon share one shader/material and one extra draw call.
  const positions: number[] = [];
  const tri = (...v: THREE.Vector3[]): void => { for (const p of v) positions.push(p.x, p.y, p.z); };
  for (const l of ALPINE_LAKES) {
    const rim = (a: number): THREE.Vector3 => {
      const r = 1.22 * (1 + 0.09 * Math.sin(3 * a + l.x) + 0.05 * Math.cos(5 * a));
      return new THREE.Vector3(l.x + Math.cos(a) * l.rx * r, l.level, l.z + Math.sin(a) * l.rz * r);
    };
    for (let k = 0; k < 56; k++) tri(new THREE.Vector3(l.x, l.level, l.z), rim((k + 1) / 56 * Math.PI * 2), rim(k / 56 * Math.PI * 2));
  }
  for (let i = 0; i < ALPINE_STREAM.length - 1; i++) {
    const a = ALPINE_STREAM[i], b = ALPINE_STREAM[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * 6.4, nz = dx / len * 6.4;
    const a1 = new THREE.Vector3(a.x + nx, a.y, a.z + nz), a2 = new THREE.Vector3(a.x - nx, a.y, a.z - nz);
    const b1 = new THREE.Vector3(b.x + nx, b.y, b.z + nz), b2 = new THREE.Vector3(b.x - nx, b.y, b.z - nz);
    tri(a1, b1, a2); tri(a2, b1, b2);
  }
  const local = new THREE.BufferGeometry(); local.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  local.computeVertexNormals();
  const inland = new THREE.Mesh(local, mat); inland.renderOrder = 1; inland.position.y = -WATER_LEVEL;
  mesh.add(inland);
  return mesh;
}
