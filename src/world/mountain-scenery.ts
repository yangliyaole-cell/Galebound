import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from '../render/uniforms';
import { Builder } from './build';
import { heightAt, normalAt } from './heightmap';
import { roadClearance } from './layout';
import { MOUNTAIN_HAMLETS, WATERFALLS, waterLevelAt } from './mountain-layout';
import { seededRandom } from './noise';
import { addHouse } from './structures/house';
import { structureDetail } from './structure-detail';
import { buildReferenceScenes } from './scenes';
import { batchSettlementDetails } from './scenes/batch-details';
import { installShotCapture } from './scenes/shot-capture';

installShotCapture();

/** One merged waterfall mesh and one instanced mist/smoke mesh. No lights or shadows. */
export function buildMountainScenery(): THREE.Group {
  const group = new THREE.Group(), b = new Builder(), rand = seededRandom(901);
  const smoke: [number, number, number, number][] = [];
  const normal = new THREE.Vector3();
  for (const village of MOUNTAIN_HAMLETS) {
    const taken: { x: number; z: number }[] = [];
    for (let attempt = 0; taken.length < village.n && attempt < 240; attempt++) {
      const a = rand() * Math.PI * 2, r = 13 + rand() * 33;
      const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
      if (roadClearance(x, z) < 7 || heightAt(x, z) < waterLevelAt(x, z) + 3 || normalAt(x, z, normal).y < 0.87) continue;
      if (taken.some((p) => Math.hypot(x - p.x, z - p.z) < 13)) continue;
      const h = addHouse(b, {
        x, z, w: 6.5 + rand() * 2, d: 6 + rand() * 1.5, floors: rand() < 0.23 ? 2 : 1,
        rot: Math.atan2(village.x - x, village.z - z) + (rand() - 0.5) * 0.35,
        wall: 0xd2c9b7, roof: rand() < 0.3 ? 0x6e7b83 : 0xb66d46, timber: false,
        ridgeAlongFront: rand() < 0.5, shutters: 0x5a7068, chimney: true, simple: 1,
      }, rand);
      taken.push({ x, z });
      // A gently rising plume over each stone cottage's roof.
      const u = h.spec.ridgeAlongFront ? h.spec.w * 0.27 : -h.spec.w * 0.2;
      const v = h.spec.ridgeAlongFront ? -h.spec.d * 0.18 : h.spec.d * 0.2;
      const c = Math.cos(h.spec.rot), s = Math.sin(h.spec.rot);
      smoke.push([x + u * c + v * s, h.topY + 1.4, z - u * s + v * c, 0.9]);
    }
    group.userData[`hamlet:${village.x},${village.z}`] = taken.length;
  }
  group.add(b.build(false));
  const falls: THREE.BufferGeometry[] = [];
  for (const f of WATERFALLS) {
    // A bowed cascade, with a skirt that widens into spray at its foot.
    const points: number[] = [], uv: number[] = [], idx: number[] = [];
    const dx = f.bx - f.x, dz = f.bz - f.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, bow = Math.sin(t * Math.PI) * 2.2;
      const x = f.x + dx * t + dx / len * bow, z = f.z + dz * t + dz / len * bow;
      const y = f.y + (f.bottom - f.y) * t;
      const w = f.width * (0.7 + 0.55 * t * t);
      for (const side of [-1, 1]) { points.push(x + nx * w / 2 * side, y + 0.35, z + nz * w / 2 * side); uv.push((side + 1) / 2, t); }
      if (i < 12) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); falls.push(g);
  }
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: shared.uTime }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv; void main(){ vUv=uv; vec4 mvPosition=modelViewMatrix*vec4(position,1.);
      gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; varying vec2 vUv;
      void main(){ float stripes=sin(vUv.x*65.+sin(vUv.y*18.-uTime*5.)*1.8)*.5+.5;
        float grain=sin(vUv.x*153.+vUv.y*49.-uTime*9.)*.5+.5;
        float edge=smoothstep(0.,.12,vUv.x)*smoothstep(1.,.88,vUv.x);
        vec3 col=mix(vec3(.48,.78,.87),vec3(.96,.99,1.),.45+.4*stripes);
        gl_FragColor=vec4(col,edge*(.48+.27*grain));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  fallMat.uniforms.uTime = shared.uTime;
  const waterfall = new THREE.Mesh(mergeGeometries(falls), fallMat); waterfall.renderOrder = 2; group.add(waterfall);
  // This legacy batch now owns cottage smoke only. Valley clouds and spray are
  // authored once in scenes/atmosphere, avoiding two overlapping opaque fog banks.
  const quad = new THREE.PlaneGeometry(2, 2), mistGeo = new THREE.InstancedBufferGeometry();
  mistGeo.setAttribute('position', quad.attributes.position); mistGeo.setAttribute('uv', quad.attributes.uv); mistGeo.setIndex(quad.index);
  mistGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(smoke.flat()), 4)); mistGeo.instanceCount = smoke.length;
  const mistMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      uniform float uTime; attribute vec4 aBase; varying vec2 vUv; varying float vOpacity;
      void main(){ float phase=fract(uTime*.04+aBase.x*.039); float smoke=1.-step(2.,aBase.w);
        vec3 p=aBase.xyz+vec3(sin(uTime*.1+aBase.z)*aBase.w*.8,phase*9.*smoke,0.);
        vec4 mvPosition=viewMatrix*vec4(p,1.); mvPosition.xy+=position.xy*aBase.w*(1.+phase*smoke);
        vUv=uv; vOpacity=mix(.11,.19,smoke)*(1.-phase*.75*smoke); gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      varying vec2 vUv; varying float vOpacity; void main(){ float d=length(vUv-.5)*2.;
        float alpha=pow(max(0.,1.-d*d),2.)*vOpacity; gl_FragColor=vec4(.92,.94,.92,alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mistMat.uniforms.uTime = shared.uTime;
  const mist = new THREE.Mesh(mistGeo, mistMat); mist.frustumCulled = false; mist.renderOrder = 2; group.add(mist);
  batchSettlementDetails(group);
  group.add(buildReferenceScenes(structureDetail()));
  return group;
}
