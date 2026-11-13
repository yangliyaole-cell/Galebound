import * as THREE from 'three';

/** Local high-tier rock shading over the Builder's plain material. All lighting,
 * cloud shading and style hooks are retained; sub-metre detail is filtered by the
 * pixel footprint so distant peaks do not sparkle. */
export function finishAlpineMaterial(group:THREE.Group):void {
  group.name='Alpine erosion mantle';
  group.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
    const original=object.material,compile=original.onBeforeCompile,key=original.customProgramCacheKey();
    const material=original.clone();object.material=material;
    material.customProgramCacheKey=()=>key+'-alpine-multiscale-v1';
    material.onBeforeCompile=(shader,renderer)=>{
      compile.call(original,shader,renderer);
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute float aSnow;varying float vGeoSnow;varying vec3 vGeoWorld;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
        vGeoSnow=aSnow;vGeoWorld=(modelMatrix*vec4(transformed,1.)).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying float vGeoSnow;varying vec3 vGeoWorld;
        float geoHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float geoNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(geoHash(i),geoHash(i+vec3(1,0,0)),f.x),mix(geoHash(i+vec3(0,1,0)),geoHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(geoHash(i+vec3(0,0,1)),geoHash(i+vec3(1,0,1)),f.x),mix(geoHash(i+vec3(0,1,1)),geoHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        float geoPixel=max(length(dFdx(vGeoWorld)),length(dFdy(vGeoWorld)));
        float geoBroad=geoNoise(vGeoWorld*.63);
        float geoFine=geoNoise(vGeoWorld*2.7)*(1.-smoothstep(.15,.7,geoPixel));
        float geoHeight=(geoBroad*.10+geoFine*.022)*mix(1.,.06,vGeoSnow);
        vec3 geoDx=dFdx(-vViewPosition),geoDy=dFdy(-vViewPosition);
        vec3 geoR1=cross(geoDy,normal),geoR2=cross(normal,geoDx);float geoDet=dot(geoDx,geoR1);
        normal=normalize(abs(geoDet)*normal-sign(geoDet)*(dFdx(geoHeight)*geoR1+dFdy(geoHeight)*geoR2));
        diffuseColor.rgb*=mix(.87+geoBroad*.23,.98+geoBroad*.025,vGeoSnow);
      `);
    };
  });
}
