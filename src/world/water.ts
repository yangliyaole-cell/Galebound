import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { HALF, WATER_LEVEL } from './layout';
import { TERRAIN_HEIGHT_GLSL, heightSamplingUniforms } from './heightmap';
import { LAKES, RIVERS, lakeShape, type Lake } from './gen/hydro';

/**
 * All open water: the sea as one sheet at level 0, each lake as a fan at its
 * own level, and every river as a ribbon that follows the surveyed surface
 * downhill, steepening into a white sheet where it falls.
 */
export function createWater(heightTex: THREE.Texture, sunDir: THREE.Vector3, horizon: number): THREE.Group {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uShallow: { value: new THREE.Color(0x58c7c0) },
        uDeep: { value: new THREE.Color(0x1b5f9c) },
        uSky: { value: new THREE.Color(horizon) },
        uZenith: { value: new THREE.Color(0x2f78d0) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aFlow;
      varying vec3 vWPos;
      varying vec4 vFlow;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vFlow = aFlow;
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
      uniform vec3 uZenith;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWPos;
      // xy: direction of flow, z: speed in metres a second, w: 0 mid-channel to 1 at the bank.
      varying vec4 vFlow;
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      ${TERRAIN_HEIGHT_GLSL}
      // Ripple slope from two crossing swells carried along with the current.
      vec2 ripple(vec2 p, vec2 drift, float t) {
        vec2 a = p * 0.42 - drift * t, b = p * 1.27 - drift * t * 1.7 + 19.0;
        return vec2(gNoise(a + vec2(t * 0.42, t * 0.17)) - gNoise(a + vec2(0.9, 0.0) - vec2(t * 0.2, -t * 0.31)),
                    gNoise(a + vec2(13.0, 7.0 + t * 0.4)) - gNoise(a + vec2(13.0, 7.9) + vec2(t * 0.3, 0.0)))
          + 0.5 * vec2(gNoise(b) - gNoise(b + vec2(0.8, 0.0)), gNoise(b + 5.0) - gNoise(b + vec2(5.0, 5.8)));
      }
      void main() {
        vec2 p = vWPos.xz;
        float ground = -40.0;
        if (max(abs(p.x), abs(p.y)) < ${(HALF - 2).toFixed(1)}) ground = terrainHeight(p);
        float depth = max(vWPos.y - ground, 0.0);
        vec3 toEye = cameraPosition - vWPos;
        float dist = length(toEye);
        vec3 view = toEye / dist;
        float t = uTime;
        float speed = vFlow.z;
        float steep = smoothstep(2.4, 5.0, speed);

        float calm = 1.0 - smoothstep(200.0, 900.0, dist);
        vec2 slope = ripple(p, vFlow.xy * speed, t) * (0.28 + 0.2 * min(speed, 3.0)) * calm;
        vec3 normal = normalize(vec3(slope.x, 1.0, slope.y));

        // Light dies with depth: the bed shows through the shallows and is lost in the deeps.
        float murk = 1.0 - exp(-depth * 0.55);
        vec3 col = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.24));
        col *= cloudShadow(p);
        float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
        vec3 mirror = reflect(-view, normal);
        vec3 sky = mix(uSky, uZenith, smoothstep(0.0, 0.7, mirror.y));
        col = mix(col, sky, fresnel * 0.85);
        float glint = pow(max(dot(mirror, uSunDir), 0.0), 220.0);
        col += vec3(1.0, 0.95, 0.82) * glint * 2.2;

        // Foam: at the margins, in streaks on fast water, and wholly on a fall.
        float wobble = gNoise(p * 0.9 + vec2(t * 0.4, -t * 0.3));
        float shore = 1.0 - smoothstep(0.0, 0.42, depth - wobble * 0.25);
        float lap = smoothstep(0.55, 0.8, sin(depth * 5.0 - t * 1.6 + wobble * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.3, 1.3, depth));
        vec2 along = vec2(dot(p, vFlow.xy), dot(p, vec2(-vFlow.y, vFlow.x)));
        float streak = gNoise(vec2(along.x * 0.16 - t * speed * 0.16, along.y * 1.3)) * gNoise(vec2(along.x * 0.05 - t * speed * 0.05, along.y * 0.5) + 9.0);
        float rapid = smoothstep(0.34, 0.6, streak + smoothstep(1.2, 3.0, speed) * 0.26 - 0.1) * smoothstep(0.9, 2.2, speed);
        float curtain = gNoise(vec2(along.y * 0.9, along.x * 0.09 - t * 2.4)) * 0.6 + gNoise(vec2(along.y * 3.1, along.x * 0.3 - t * 5.0)) * 0.4;
        float foam = clamp(shore * 0.9 + lap * 0.5 + rapid * 0.8, 0.0, 1.0);
        foam = mix(foam, 0.62 + 0.38 * curtain, steep);
        col = mix(col, vec3(0.96, 0.98, 1.0) * (0.86 + 0.14 * cloudShadow(p)), foam * 0.92);

        float alpha = mix(0.42, 0.97, murk);
        alpha = max(alpha, max(foam, fresnel));
        alpha *= smoothstep(0.0, 0.05, depth + steep);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, heightSamplingUniforms(heightTex));
  mat.uniforms.uSunDir = { value: sunDir };
  mat.uniforms.uTime = shared.uTime;
  mat.uniforms.uCloudDrift = shared.uCloudDrift;

  const group = new THREE.Group();
  group.name = 'Water';
  const still = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const flow = new Float32Array(geo.attributes.position.count * 4);
    for (let i = 0; i < flow.length; i += 4) flow[i] = 1;
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
    return geo;
  };
  const sea = new THREE.Mesh(still(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2)), mat);
  sea.position.y = WATER_LEVEL;
  sea.renderOrder = 1;
  group.add(sea);

  const positions: number[] = [], flows: number[] = [], index: number[] = [];
  const vertex = (x: number, y: number, z: number, fx: number, fz: number, speed: number, bank: number): number => {
    positions.push(x, y, z); flows.push(fx, fz, speed, bank);
    return positions.length / 3 - 1;
  };
  const inLake = (x: number, z: number): Lake | undefined => LAKES.find((l) =>
    Math.abs(x - l.x) < l.rx * 1.2 && Math.abs(z - l.z) < l.rz * 1.2 && lakeShape(l, x, z) < 0.94);
  for (const l of LAKES) {
    const centre = vertex(l.x, l.level, l.z, 1, 0, 0, 0);
    const rimStart = positions.length / 3, steps = 96;
    for (let k = 0; k < steps; k++) {
      const a = k / steps * Math.PI * 2;
      // Step outward until just past the shore along this bearing.
      let r = 0.6;
      while (lakeShape(l, l.x + Math.cos(a) * l.rx * r, l.z + Math.sin(a) * l.rz * r) < 1.05 && r < 2) r += 0.01;
      vertex(l.x + Math.cos(a) * l.rx * r, l.level, l.z + Math.sin(a) * l.rz * r, 1, 0, 0, 1);
    }
    for (let k = 0; k < steps; k++) index.push(centre, rimStart + (k + 1) % steps, rimStart + k);
  }
  for (const river of RIVERS) {
    let previous = -1;
    for (let i = 0; i < river.pts.length; i++) {
      const p = river.pts[i];
      // Falls are drawn as curtains of their own (waterfalls.ts).
      if (p.level < 0.04 || p.fall || inLake(p.x, p.z)) { previous = -1; continue; }
      const next = river.pts[Math.min(river.pts.length - 1, i + 1)], before = river.pts[Math.max(0, i - 1)];
      const run = Math.hypot(next.x - before.x, next.z - before.z) || 1;
      const drop = (before.level - next.level) / run;
      const speed = p.fall ? 6 : Math.min(4.5, 0.55 + drop * 26);
      const half = p.width * 0.5 + 0.9;
      const a = vertex(p.x - p.dz * half, p.level, p.z + p.dx * half, p.dx, p.dz, speed, 1);
      vertex(p.x, p.level, p.z, p.dx, p.dz, speed, 0);
      vertex(p.x + p.dz * half, p.level, p.z - p.dx * half, p.dx, p.dz, speed, 1);
      if (previous >= 0) index.push(previous, a, previous + 1, previous + 1, a, a + 1, previous + 1, a + 1, previous + 2, previous + 2, a + 1, a + 2);
      previous = a;
    }
  }
  const inland = new THREE.BufferGeometry();
  inland.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  inland.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 4));
  inland.setIndex(index);
  const fresh = new THREE.Mesh(inland, mat);
  fresh.renderOrder = 1;
  fresh.frustumCulled = false;
  group.add(fresh);
  return group;
}
