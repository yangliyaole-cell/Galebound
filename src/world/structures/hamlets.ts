import * as THREE from 'three';
import { shared } from '../../render/uniforms';
import { Builder } from '../build';
import { heightAt, normalAt, waterLevelAt } from '../heightmap';
import { roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { addHouse } from './house';
import { batchSettlementDetails } from './batch-details';

/**
 * Stone hamlets out in the hills: a handful of cottages round a little green,
 * each with smoke from its chimney. One in the hanging valley above Cloudfall,
 * one on the eastern highland road, one in the Wood Brook dale and one up the
 * North Beck.
 */
export const HAMLETS = [
  { x: -1690, z: -1500, n: 6 },
  { x: 1270, z: -360, n: 6 },
  { x: -880, z: 640, n: 5 },
  { x: -40, z: -820, n: 5 },
];

export function buildHamlets(): THREE.Group {
  const group = new THREE.Group(), b = new Builder(), rand = seededRandom(901);
  group.name = 'Hamlets';
  const smoke: number[] = [];
  const normal = new THREE.Vector3();
  // Dry over the whole plot, with a margin: cottages stand back from streams and tarns.
  const dry = (x: number, z: number): boolean => [[0, 0], [9, 0], [-9, 0], [0, 9], [0, -9], [7, 7], [-7, -7], [7, -7], [-7, 7]]
    .every(([dx, dz]) => heightAt(x + dx, z + dz) > Math.max(0, waterLevelAt(x + dx, z + dz)) + 2);
  for (const village of HAMLETS) {
    // Settle the green on the most level ground nearby.
    let best = { x: village.x, z: village.z, score: Infinity };
    for (let k = 0; k < 400; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 160;
      const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
      if (!dry(x, z)) continue;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 8; i++) {
        const h = heightAt(x + Math.cos(i * 0.785) * 30, z + Math.sin(i * 0.785) * 30);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const score = hi - lo + r * 0.02;
      if (score < best.score) best = { x, z, score };
    }
    const taken: { x: number; z: number }[] = [];
    for (let attempt = 0; taken.length < village.n && attempt < 400; attempt++) {
      const a = rand() * Math.PI * 2, r = 12 + rand() * 34;
      const x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
      if (roadClearance(x, z) < 7 || !dry(x, z) || normalAt(x, z, normal).y < 0.87) continue;
      if (taken.some((p) => Math.hypot(x - p.x, z - p.z) < 13)) continue;
      const h = addHouse(b, {
        x, z, w: 6.5 + rand() * 2, d: 6 + rand() * 1.5, floors: rand() < 0.23 ? 2 : 1,
        rot: Math.atan2(best.x - x, best.z - z) + (rand() - 0.5) * 0.35,
        wall: 0xd2c9b7, roof: rand() < 0.3 ? 0x6e7b83 : 0xb66d46, timber: false,
        ridgeAlongFront: rand() < 0.5, shutters: 0x5a7068, chimney: true, simple: 1,
      }, rand);
      taken.push({ x, z });
      const u = h.spec.ridgeAlongFront ? h.spec.w * 0.27 : -h.spec.w * 0.2;
      const v = h.spec.ridgeAlongFront ? -h.spec.d * 0.18 : h.spec.d * 0.2;
      const c = Math.cos(h.spec.rot), s = Math.sin(h.spec.rot);
      smoke.push(x + u * c + v * s, h.topY + 1.4, z - u * s + v * c, rand());
    }
    group.userData[`hamlet:${village.x},${village.z}`] = taken.length;
  }
  group.add(batchSettlementDetails(b.build(true)));

  // Wood smoke: soft puffs that rise, widen and thin out, leaning with the wind.
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const puffs: number[] = [];
  for (let i = 0; i < smoke.length; i += 4) for (let k = 0; k < 7; k++) puffs.push(smoke[i], smoke[i + 1], smoke[i + 2], smoke[i + 3] + k / 7);
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
  geo.instanceCount = puffs.length / 4;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: shared.uTime, uWindDir: shared.uWindDir, uWindStrength: shared.uWindStrength },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
      attribute vec4 aBase; varying vec2 vUv; varying float vOpacity;
      void main() {
        float age = fract(uTime * 0.06 + aBase.w);
        vec3 p = aBase.xyz + vec3(0.0, age * 14.0, 0.0);
        p.xz += (uWindDir * (0.6 + uWindStrength * 3.0) + vec2(sin(uTime * 0.3 + aBase.w * 9.0), 0.0) * 0.4) * age * 9.0;
        vec4 view = viewMatrix * vec4(p, 1.0);
        view.xy += position.xy * (0.5 + age * 2.6);
        vUv = position.xy;
        vOpacity = smoothstep(0.0, 0.1, age) * (1.0 - age) * 0.32;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vOpacity;
      void main() {
        float d = dot(vUv, vUv);
        float a = pow(max(0.0, 1.0 - d), 2.0) * vOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.86, 0.87, 0.88, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mist = new THREE.Mesh(geo, mat);
  mist.frustumCulled = false;
  mist.renderOrder = 2;
  group.add(mist);
  return group;
}
