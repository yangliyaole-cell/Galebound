import * as THREE from 'three';
import { pbrTier } from './config';
import { pbrLibrary } from './library';
import { pbrUniforms, registerPbr } from './material';

export function groundPbrGLSL(): string {
  return `${pbrLibrary(pbrTier())}
  PbrSurface pGround(vec3 wp,vec3 wn,vec3 turf,float dist) {
    vec3 weights=pWeights(wn);
    vec4 splat=texture2D(uSplat,worldUv(wp.xz));
    float macro=pNoise(wp.xz*.027), moisture=pFbm(wp.xz*.39);
    PbrSurface dirt=pDirt(wp.xz);
    PbrSurface moss=pMoss(wp.xz);
    PbrSurface rock=PBR_TRIPLANAR(pCliff,wp,weights);
    rock.albedo*=mix(uRockDark,uRock,macro);
    dirt.albedo*=mix(uDirtDark,uDirtLight,macro);
    // Turf keeps the style palette, with real clumped relief instead of painted dabs.
    PbrSurface turfSurface=PbrSurface(turf*(.82+moss.height*.28),moss.height,.98,moss.ao);
    float alpine=smoothstep(95.0,150.0,wp.y+(macro-.5)*30.0);
    float slope=1.0-smoothstep(.58,.83,wn.y);
    float cliff=pHeightBlend(max(slope,alpine*.72),turfSurface.height,rock.height,.26);
    PbrSurface s=pMix(turfSurface,rock,cliff);
    float sand=1.0-smoothstep(.9,2.1,wp.y-lakeLevel(wp.xz)+(moisture-.5)*.9);
    PbrSurface bank=PbrSurface(uSand*dirt.albedo/max(mix(uDirtDark,uDirtLight,macro),vec3(.02)),dirt.height,.87,dirt.ao);
    s=pMix(s,bank,pHeightBlend(sand,s.height,bank.height,.3));
    PbrSurface paving=pMasonry(wp.xz*1.2);
    paving.albedo*=uCobble;
    float cobble=pHeightBlend(splat.g,s.height,paving.height,.28);
    s=pMix(s,paving,cobble);
    float road=pHeightBlend(splat.r,s.height,dirt.height,.32);
    s=pMix(s,dirt,road);
    float roadShoulder=groundRoadShoulder(wp.xz,splat.r)*(1.0-cobble)*(1.0-cliff);
    s=pMix(s,dirt,roadShoulder*.48);
    // Discrete embedded chips only on the worn verge, not uniform pepper across the road.
    vec2 gravelCell=wp.xz*3.2, gravelId=floor(gravelCell);
    float gravelSeed=pHash(gravelId+71.0);
    vec2 gravelLocal=fract(gravelCell)-vec2(.3+gravelSeed*.4,.3+pHash(gravelId+19.0)*.4);
    float gravelRadius=.085+pHash(gravelId+3.0)*.13;
    float gravelAA=max(fwidth(gravelCell.x),fwidth(gravelCell.y));
    float gravelShape=1.0-smoothstep(gravelRadius-gravelAA,gravelRadius+gravelAA,length(gravelLocal*vec2(.8,1.2)));
    float gravel=gravelShape*step(.36,gravelSeed)*roadShoulder;
    PbrSurface vergeStone=PbrSurface(mix(uRockDark,uRock,gravelSeed)*(.79+gravelSeed*.21),dirt.height+.18,.83,.95);
    s=pMix(s,vergeStone,gravel);
    s.roughness=mix(s.roughness,.81,roadShoulder*.35);
    float field=smoothstep(.35,.6,splat.b);
    PbrSurface tilled=dirt; tilled.albedo=parcelColor(wp.xz)*(.8+dirt.height*.3);
    s=pMix(s,tilled,field);
    float snow=smoothstep(150.0,185.0,wp.y+(macro-.5)*26.0)*smoothstep(.3,.58,wn.y);
    s=pMix(s,PbrSurface(uSnow*(.95+moisture*.05),.7,.79,.98),snow);
    float contact=texture2D(uPbrContact,worldUv(wp.xz)).r;
    float bankDamp=(1.0-smoothstep(.12,1.8,wp.y-lakeLevel(wp.xz)))*(1.0-snow);
    // Broken dirt/moss transition around real solid footprints, plus damp river edges.
    float growth=max(contact*.62,bankDamp*.5)*smoothstep(.25,.68,moisture);
    growth*=1.0-road*.85;
    s=pMix(s,moss,growth*.48);
    s.ao*=1.0-contact*.22-bankDamp*.08;
    s.roughness=mix(s.roughness,.66,bankDamp*.5);
    // Macro albedo remains at distance; high-frequency height fades before it can shimmer.
    s.height*=1.0-smoothstep(${pbrTier() === 'high' ? '100.0,420.0' : '50.0,170.0'},dist);
    return s;
  }`;
}

export function registerGroundPbr(legacy: THREE.MeshLambertMaterial, groundGLSL: string,
  uniforms: Record<string, THREE.IUniform>): void {
  if (pbrTier() === 'low') return;
  const mat=new THREE.MeshStandardMaterial({ roughness: .94, metalness: 0 });
  mat.name=`pbr-ground-${pbrTier()}`;
  mat.customProgramCacheKey=()=>`pbr-ground-v2-${pbrTier()}`;
  mat.onBeforeCompile=(shader)=>{
    Object.assign(shader.uniforms,uniforms,pbrUniforms);
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvWPos=position;\nvWNormal=normal;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${groundGLSL}\n${groundPbrGLSL()}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        float grassAmount; vec3 grassTint;
        float groundDistance=distance(cameraPosition,vWPos);
        groundColor(vWPos,normalize(vWNormal).y,1000.0,grassAmount,grassTint);
        PbrSurface groundPbr=pGround(vWPos,normalize(vWNormal),grassTint,groundDistance);
        diffuseColor.rgb=groundPbr.albedo*cloudShadow(vWPos.xz);`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=groundPbr.roughness;')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=pBumpNormal(normal,-vViewPosition,groundPbr.height*.085);')
      .replace('#include <aomap_fragment>','#include <aomap_fragment>\nreflectedLight.indirectDiffuse*=groundPbr.ao;\nreflectedLight.indirectSpecular*=groundPbr.ao;');
  };
  registerPbr(legacy,mat);
}
