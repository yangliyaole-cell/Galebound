import * as THREE from 'three';
import { Builder } from '../build';
import { ALPINE_STREAM, SHOWCASE_STREAM, WATERFALLS, waterLevelAt } from '../mountain-layout';
import { roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { shared } from '../../render/uniforms';
import { landscapeRock, ribbon } from './geometry';
import type { AtmosphereSeed } from './farmland';
import { alpineHeight, alpineNormal, stableRockFooting } from './surface';
import { SHOWCASE_FALL } from './plan';

export function addRapids(b: Builder, group: THREE.Group, detail: number, count: number, mist: AtmosphereSeed[]): number {
  const rand = seededRandom(5521); let rocks = 0;
  const normal=new THREE.Vector3();
  for (let attempt = 0; rocks < count && attempt < count * 100; attempt++) {
    const stream=attempt%3===0?SHOWCASE_STREAM:ALPINE_STREAM;
    const i = Math.floor(rand() * (stream.length - 2)) + 1, a = stream[i - 1], c = stream[i + 1];
    const p = stream[i], dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz) || 1;
    const off = (rand() < 0.5 ? -1 : 1) * (5 + rand() * 10), x = p.x - dz / len * off, z = p.z + dx / len * off;
    const r = 1.2 + rand() * 3.2, ground = alpineHeight(x, z);
    if (roadClearance(x, z) < r + 3 || ground > p.y + 8 || Math.hypot(x + 600, z + 495) < 45) continue;
    if(ground<waterLevelAt(x,z)+.2||alpineNormal(x,z,normal).y<.86||!stableRockFooting(x,z,r))continue;
    landscapeRock(b, x, ground - r * 0.3, z, r, detail, true); rocks++;
  }
  if (detail === 0) return rocks;
  for (const f of WATERFALLS) for (let k = 0; k < (f===SHOWCASE_FALL?(detail===2?12:6):(detail === 2 ? 7 : 3)); k++) {
    mist.push([f.bx + (rand() - 0.5) * f.width * 1.1, f.bottom + 0.6 + rand() * 1.2,
      f.bz + 3 + rand() * 7, 1.9 + rand() * 1.6]);
  }
  const geo = ribbon(ALPINE_STREAM, ALPINE_STREAM.map((_, i) => 5.1 + Math.sin(i * 0.3) * 0.5), detail === 2 ? 8 : 3,
    (_x, _z, t) => ALPINE_STREAM[Math.round(t * (ALPINE_STREAM.length - 1))].y + 0.12);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vWorld;
      void main(){vUv=uv;vWorld=position;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; varying vec2 vUv; varying vec3 vWorld;
      void main(){float flow=vUv.y*280.-uTime*2.2;
        float bands=sin(flow+sin(vUv.x*21.+flow*.2)*2.);
        float foam=smoothstep(.35,.95,bands)*(.5+.5*sin(vUv.x*43.+flow*.7));
        float edge=smoothstep(0.,.1,vUv.x)*smoothstep(1.,.9,vUv.x);
        vec3 color=mix(vec3(.37,.72,.78),vec3(.96,.985,.97),foam);
        gl_FragColor=vec4(color,edge*(.18+foam*.7));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms.uTime = shared.uTime;
  const mesh = new THREE.Mesh(geo, material); mesh.name = 'Glacial whitewater'; mesh.renderOrder = 2; group.add(mesh);
  return rocks;
}
