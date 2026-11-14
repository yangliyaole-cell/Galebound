import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { RIVERS, type RiverPoint } from './gen/hydro';
import { seededRandom } from './noise';

/**
 * Every place a river falls freely: a curtain of water thrown out from the lip
 * along its true arc, torn into streaks as it falls, and a cloud of spray
 * rolling up from where it lands.
 */
export interface Fall { lip: RiverPoint; foot: RiverPoint; width: number; drop: number }

export function findFalls(): Fall[] {
  const falls: Fall[] = [];
  for (const river of RIVERS) {
    const pts = river.pts;
    for (let i = 1; i < pts.length; i++) {
      if (!pts[i].fall || pts[i - 1].fall) continue;
      let j = i;
      while (j + 1 < pts.length && pts[j + 1].fall) j++;
      const lip = pts[i - 1], foot = pts[Math.min(pts.length - 1, j + 1)];
      const drop = lip.level - foot.level;
      if (drop > 6) falls.push({ lip, foot, width: lip.width, drop });
      i = j;
    }
  }
  return falls;
}

export function createWaterfalls(sunDir: THREE.Vector3, detail: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Waterfalls';
  const falls = findFalls();
  if (!falls.length) return group;

  // ---- the curtain: a ribbon along the arc, many rows tall, slightly bowed
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const across = detail > 0 ? 14 : 6, down = detail > 0 ? 48 : 16;
  for (const f of falls) {
    const dir = new THREE.Vector3(f.foot.x - f.lip.x, 0, f.foot.z - f.lip.z);
    const run = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    // Throw speed chosen so the arc lands at the foot of the fall.
    const time = Math.sqrt((2 * f.drop) / 9.81), speed = Math.max(1.5, run / time);
    const base = positions.length / 3;
    for (let r = 0; r <= down; r++) {
      const t = (r / down) * time;
      const fall = 4.905 * t * t;
      // The curtain spreads a little as it falls.
      const spread = 1 + 0.35 * (r / down);
      for (let c = 0; c <= across; c++) {
        const u = c / across - 0.5;
        const bow = Math.cos(u * Math.PI) * 0.8;
        const p = new THREE.Vector3(f.lip.x, f.lip.level - fall + 0.15, f.lip.z)
          .addScaledVector(dir, speed * t + bow)
          .addScaledVector(side, u * f.width * spread);
        positions.push(p.x, p.y, p.z);
        // u across, v as distance fallen in metres (for streaks), w the fraction fallen.
        uvs.push(u, fall, r / down);
      }
    }
    for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) {
      const a = base + r * (across + 1) + c, b = a + 1, d = a + across + 1, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const curtain = new THREE.BufferGeometry();
  curtain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  curtain.setAttribute('aFlow', new THREE.Float32BufferAttribute(uvs, 3));
  curtain.setIndex(index);
  curtain.computeBoundingSphere();
  const curtainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: shared.uTime, uSunDir: { value: sunDir }, uCloudDrift: shared.uCloudDrift },
    vertexShader: /* glsl */ `
      attribute vec3 aFlow;
      varying vec3 vFlow;
      varying vec3 vWorld;
      void main() {
        vFlow = aFlow;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vFlow;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      void main() {
        float u = vFlow.x, fallen = vFlow.y, t = vFlow.z;
        // Streaks: narrow columns that race downward, each at its own pace.
        float column = u * 26.0;
        float pace = 0.8 + 0.4 * gHash(vec2(floor(column), 7.0));
        float streak = gNoise(vec2(column, fallen * 0.22 - uTime * 3.4 * pace));
        streak = streak * 0.65 + gNoise(vec2(u * 70.0, fallen * 0.6 - uTime * 7.0)) * 0.35;
        // The sheet is whole at the lip and tears into ragged ribbons lower down.
        float edge = 1.0 - smoothstep(0.32 - t * 0.12, 0.5, abs(u) + (gNoise(vec2(fallen * 0.15 - uTime * 2.0, u * 4.0)) - 0.5) * 0.2);
        float body = mix(0.85, smoothstep(0.28, 0.62, streak), smoothstep(0.05, 0.55, t));
        float alpha = clamp(body * edge, 0.0, 1.0) * mix(0.95, 0.75, t);
        vec3 lit = vec3(1.0, 0.98, 0.94) * (0.78 + 0.32 * streak);
        // Thicker water at the core is a touch blue-green in its depths.
        lit = mix(vec3(0.62, 0.78, 0.82), lit, smoothstep(0.2, 0.7, streak));
        lit *= cloudShadow(vWorld.xz);
        gl_FragColor = vec4(lit, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const curtainMesh = new THREE.Mesh(curtain, curtainMat);
  curtainMesh.renderOrder = 2;
  group.add(curtainMesh);

  // ---- spray: soft billows that rise and drift from each landing
  const puffs = detail === 2 ? 90 : detail === 1 ? 50 : 18;
  const centres: number[] = [], seeds: number[] = [];
  const rand = seededRandom(5309);
  for (const f of falls) for (let k = 0; k < puffs; k++) {
    centres.push(f.foot.x, f.foot.level, f.foot.z, f.width);
    seeds.push(rand(), rand(), rand(), f.drop);
  }
  const spray = new THREE.InstancedBufferGeometry();
  spray.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  spray.setIndex([0, 1, 2, 0, 2, 3]);
  spray.setAttribute('aCentre', new THREE.InstancedBufferAttribute(new Float32Array(centres), 4));
  spray.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
  spray.instanceCount = centres.length / 4;
  const sprayMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: shared.uTime, uSunDir: { value: sunDir }, uWindDir: shared.uWindDir, uWindStrength: shared.uWindStrength },
    vertexShader: /* glsl */ `
      attribute vec4 aCentre;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      void main() {
        // Each puff lives a few seconds: born in the plunge, swelling as it rises and thins.
        float life = 5.0 + aSeed.y * 4.0;
        float age = fract(uTime / life + aSeed.x);
        float a = aSeed.z * 6.2831853;
        float reach = aCentre.w * (0.3 + 2.4 * age * (0.4 + aSeed.y));
        vec3 centre = aCentre.xyz + vec3(cos(a) * reach, 1.0 + age * (6.0 + aSeed.w * 0.22), sin(a) * reach * 0.7);
        centre.xz += uWindDir * uWindStrength * age * 14.0;
        float size = aCentre.w * (0.25 + 0.9 * age) * (0.5 + 0.8 * aSeed.y);
        vFade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.45, 1.0, age));
        vUv = position.xy;
        vSeed = aSeed.x;
        vec4 view = viewMatrix * vec4(centre, 1.0);
        view.xy += position.xy * size;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      ${NOISE_GLSL}
      void main() {
        float r = length(vUv);
        float billow = gFbm3(vUv * 1.7 + vSeed * 31.0 + vFade * 0.6);
        float a = smoothstep(0.95, 0.1, r + (billow - 0.5) * 1.1) * vFade * 0.2 * smoothstep(0.25, 0.6, billow);
        if (a < 0.004) discard;
        vec3 col = mix(vec3(0.82, 0.87, 0.92), vec3(1.0, 0.99, 0.96), smoothstep(0.3, 0.7, billow + vUv.y * 0.25));
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sprayMesh = new THREE.Mesh(spray, sprayMat);
  sprayMesh.frustumCulled = false;
  sprayMesh.renderOrder = 3;
  group.add(sprayMesh);
  return group;
}
