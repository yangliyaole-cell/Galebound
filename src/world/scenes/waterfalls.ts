import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/glsl';
import { WATERFALLS } from '../mountain-layout';
import { SHOWCASE_FALL, PLUNGE_POOL } from './plan';

export const waterfallStats={layers:0,heroLayers:0,heroWidth:0,triangles:0};

export function waterfallPoint(f:typeof SHOWCASE_FALL,t:number,side=0):THREE.Vector3 {
  const dx=f.bx-f.x,dz=f.bz-f.z,len=Math.hypot(dx,dz),travel=.16*t+.84*Math.sqrt(Math.max(0,t));
  const bow=Math.sin(t*Math.PI)*2.5,width=f.width*(.94+t*t*.22);
  return new THREE.Vector3(f.x+dx*travel+dx/len*bow-dz/len*width*.5*side,
    f.y+(f.bottom-f.y)*t+.32,f.z+dz*travel+dz/len*bow+dx/len*width*.5*side);
}

/** Several physically separated sheets form one merged translucent draw. */
export function createWaterfallScene(detail:number):THREE.Group {
  const group=new THREE.Group(),parts:THREE.BufferGeometry[]=[];
  waterfallStats.layers=0;waterfallStats.heroLayers=0;waterfallStats.heroWidth=SHOWCASE_FALL.width;
  const rows=detail===2?120:detail===1?48:16,across=detail===2?48:detail===1?16:6;
  for(const f of WATERFALLS){
    const hero=f===SHOWCASE_FALL,layers=hero?(detail===2?8:detail===1?4:1):(detail===2?3:detail===1?2:1);
    const dx=f.bx-f.x,dz=f.bz-f.z,len=Math.hypot(dx,dz);
    for(let layer=0;layer<layers;layer++){
      const p:number[]=[],uv:number[]=[],weight:number[]=[],index:number[]=[];
      const full=layer===0,span=full?1:.27+(layer%3)*.08,offset=full?0:((layer-1)/Math.max(1,layers-2)-.5)*.78;
      for(let i=0;i<=rows;i++)for(let j=0;j<=across;j++){
        const t=i/rows,u=j/across*2-1,side=u*span+offset*2,point=waterfallPoint(f,t,side);
        const forward=layer*.21*Math.sin(t*Math.PI);
        point.x+=dx/len*forward;point.z+=dz/len*forward;
        point.y+=Math.sin(j*.41+layer*2.3+t*17)*.12*Math.sin(t*Math.PI);
        p.push(...point.toArray());uv.push(j/across,t+layer*.173);weight.push(full?.72:.48);
        if(i<rows&&j<across){const k=i*(across+1)+j;index.push(k,k+1,k+across+1,k+1,k+across+2,k+across+1);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      g.setAttribute('aWeight',new THREE.Float32BufferAttribute(weight,1));g.setIndex(index);g.computeVertexNormals();parts.push(g);
      waterfallStats.layers++;if(hero)waterfallStats.heroLayers++;
    }
  }
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
    uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{}]),
    vertexShader:`#include <common>
      #include <fog_pars_vertex>
      uniform float uTime;attribute float aWeight;varying vec2 vUv;varying float vWeight;
      void main(){vUv=uv;vWeight=aWeight;vec3 p=position;
        p+=normal*sin(uTime*2.7+uv.y*31.+uv.x*7.)*.18*sin(fract(uv.y)*3.14159265);
        vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`#include <common>
      #include <fog_pars_fragment>
      uniform float uTime;varying vec2 vUv;varying float vWeight;
      ${NOISE_GLSL}
      void main(){float flow=vUv.y*22.-uTime*2.5;
        float volume=gFbm(vec2(vUv.x*11.,flow));float threads=gNoise(vec2(vUv.x*125.+volume*2.,flow*.41));
        float edge=smoothstep(0.,.08,vUv.x)*smoothstep(1.,.92,vUv.x);
        vec3 col=mix(vec3(.58,.82,.9),vec3(.98,.995,.98),.58+.35*threads);
        gl_FragColor=vec4(col,edge*vWeight*(.65+volume*.35));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });material.uniforms.uTime=shared.uTime;
  const geometry=mergeGeometries(parts),curtains=new THREE.Mesh(geometry,material);
  waterfallStats.triangles=(geometry.index?.count??geometry.attributes.position.count)/3;
  curtains.name='Layered waterfall curtains';curtains.renderOrder=2;group.add(curtains);for(const part of parts)part.dispose();

  const pos:number[]=[],coords:number[]=[];
  for(const f of WATERFALLS){
    const hero=f===SHOWCASE_FALL,cx=hero?PLUNGE_POOL.x:f.bx,cz=hero?PLUNGE_POOL.z:f.bz;
    const rx=f.width*(hero?.36:.5),rz=f.width*(hero?.25:.32),segments=detail===2?96:detail===1?40:20;
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
      pos.push(cx,f.bottom+.16,cz,cx+Math.cos(b)*rx,f.bottom+.16,cz+Math.sin(b)*rz,cx+Math.cos(a)*rx,f.bottom+.16,cz+Math.sin(a)*rz);
      coords.push(.5,.5,Math.cos(b)*.5+.5,Math.sin(b)*.5+.5,Math.cos(a)*.5+.5,Math.sin(a)*.5+.5);
    }
  }
  const foamGeo=new THREE.BufferGeometry();foamGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));foamGeo.setAttribute('uv',new THREE.Float32BufferAttribute(coords,2));
  const foamMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,side:THREE.DoubleSide,
    uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{}]),
    vertexShader:`#include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader:`#include <common>
      #include <fog_pars_fragment>
      uniform float uTime;varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){float d=length(vUv-.5)*2.;float n=gFbm(vUv*24.+vec2(uTime*.35,-uTime*.21));
        float ring=sin(d*31.-uTime*3.+n*4.)*.5+.5;float edge=1.-smoothstep(.55,1.,d);
        gl_FragColor=vec4(mix(vec3(.65,.86,.86),vec3(.97,.99,.96),n),edge*(.45+ring*.4));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });foamMat.uniforms.uTime=shared.uTime;
  const foam=new THREE.Mesh(foamGeo,foamMat);foam.name='Waterfall impact whitewater';foam.renderOrder=3;group.add(foam);
  return group;
}
