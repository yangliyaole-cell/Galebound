import * as THREE from 'three';
import { shared } from '../../render/uniforms';
import { seededRandom } from '../noise';
import type { AtmosphereSeed } from './farmland';

/** One instanced, soft billboard draw for valley cloud shelves, spray and chimney smoke. */
export function createValleyAtmosphere(seeds: AtmosphereSeed[], cloudCount: number): THREE.Mesh<THREE.InstancedBufferGeometry> | null {
  if (!cloudCount) return null;
  const rand = seededRandom(5043), puffs = [...seeds];
  const kinds: number[] = seeds.map((p) => p[3] < 1.1 ? 1 : 0);
  for (let i = 0; i < cloudCount; i++) {
    // Keep the middle sightline to ice, falls and the upper arcade clear.
    const west = i % 2 === 0;
    puffs.push([west ? -899 + rand() * 50 : -465 + rand() * 45, 70 + rand() * 20,
      -817 + rand() * 120, 7 + rand() * 6]); kinds.push(2);
  }
  const plane = new THREE.PlaneGeometry(2, 2), geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', plane.attributes.position); geo.setAttribute('uv', plane.attributes.uv); geo.setIndex(plane.index);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flat()), 4)); geo.instanceCount = puffs.length;
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kinds), 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      uniform float uTime; uniform float uCloudWeight; attribute vec4 aSeed; attribute float aKind; varying vec2 vUv; varying float vAlpha; varying float vPhase;
      void main(){float smoke=step(.5,aKind)*(1.-step(1.5,aKind)),cloud=step(1.5,aKind);
        float phase=fract(uTime*.035+aSeed.x*.043); vPhase=phase;vUv=uv;
        vec3 p=aSeed.xyz+vec3(sin(uTime*.06+aSeed.z)*aSeed.w*.18+phase*2.*smoke,phase*8.*smoke,0.);
        vec4 mvPosition=viewMatrix*vec4(p,1.);
        mvPosition.xy+=position.xy*aSeed.w*vec2(1.+cloud*1.2,mix(.35,.65,smoke))*(1.+phase*smoke*.7);
        vAlpha=mix(mix(.035,.012*uCloudWeight,cloud),.14,smoke)*mix(1.,sin(phase*3.14159265),smoke);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      varying vec2 vUv; varying float vAlpha; varying float vPhase;
      void main(){vec2 p=(vUv-.5)*2.;float n=sin(p.x*12.+sin(p.y*8.+vPhase*4.))*sin(p.y*11.);
        float alpha=pow(max(0.,1.-dot(p,p)+n*.09),2.)*vAlpha;
        gl_FragColor=vec4(mix(vec3(.78,.85,.87),vec3(.97,.97,.91),vUv.y),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = shared.uTime;
  mat.uniforms.uCloudWeight = { value: 36 / Math.max(36, cloudCount) };
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'Valley clouds spray and cottage smoke';
  mesh.frustumCulled = false; mesh.renderOrder = 3; return mesh;
}
