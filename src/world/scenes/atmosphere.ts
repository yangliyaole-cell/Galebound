import * as THREE from 'three';
import { shared } from '../../render/uniforms';
import { seededRandom } from '../noise';
import type { AtmosphereSeed } from './farmland';

/** One instanced, soft billboard draw for valley cloud shelves, spray and chimney smoke. */
export function createValleyAtmosphere(seeds: AtmosphereSeed[], cloudCount: number): THREE.Mesh<THREE.InstancedBufferGeometry> | null {
  if (!cloudCount) return null;
  const rand = seededRandom(5043), puffs = [...seeds];
  for (let i = 0; i < cloudCount; i++) {
    const t = i / cloudCount;
    puffs.push([-908 + t * 410 + rand() * 28, 105 + Math.sin(t * 5) * 30 + rand() * 13,
      -855 + t * 220 + rand() * 80, 15 + rand() * 22]);
  }
  const plane = new THREE.PlaneGeometry(2, 2), geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', plane.attributes.position); geo.setAttribute('uv', plane.attributes.uv); geo.setIndex(plane.index);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flat()), 4)); geo.instanceCount = puffs.length;
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      uniform float uTime; attribute vec4 aSeed; varying vec2 vUv; varying float vAlpha; varying float vPhase;
      void main(){float smoke=1.-step(2.,aSeed.w),cloud=step(12.,aSeed.w);
        float phase=fract(uTime*.035+aSeed.x*.043); vPhase=phase;vUv=uv;
        vec3 p=aSeed.xyz+vec3(sin(uTime*.06+aSeed.z)*aSeed.w*.18+phase*2.*smoke,phase*8.*smoke,0.);
        vec4 mvPosition=viewMatrix*vec4(p,1.);
        mvPosition.xy+=position.xy*aSeed.w*vec2(1.+cloud*1.9,.65)*(1.+phase*smoke*.7);
        vAlpha=mix(mix(.13,.075,cloud),.26,smoke)*mix(1.,sin(phase*3.14159265),smoke);
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
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'Valley clouds spray and cottage smoke';
  mesh.frustumCulled = false; mesh.renderOrder = 3; return mesh;
}
