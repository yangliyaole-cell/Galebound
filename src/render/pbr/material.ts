import * as THREE from 'three';
import { pbrTier } from './config';
import { classifyNaturalStone } from './natural-stone';
import { PBR_MATERIALS, pbrLibrary, type PbrEntry, type PbrKind } from './library';
import { ABBEY_INDOORS_GLSL } from '../../world/abbey-space';

export const pbrUniforms = {
  uPbrActive: { value: 0 },
  uPbrGround: { value: null as THREE.Texture | null },
  uPbrContact: { value: null as THREE.Texture | null },
  uPbrWorldSize: { value: 4096 },
  /** Bounced daylight inside the abbey, which no real-time light provides. */
  uAbbeyFill: { value: 0.4 },
  uAbbeyFloor: { value: 0 },
};
const alternatives = new Map<THREE.Material, THREE.Material>();
const originals = new Map<THREE.Material, THREE.Material>();
export function registerPbr(original: THREE.Material, material: THREE.Material): void {
  alternatives.set(original, material); originals.set(material, original);
}
export function pbrAlternative(material: THREE.Material): THREE.Material | undefined { return alternatives.get(material); }
export function pbrOriginal(material: THREE.Material): THREE.Material { return originals.get(material) ?? material; }

/**
 * @param interior lit throughout by the abbey's bounced daylight
 * @param shell the same, but only where the surface lies inside the abbey's rooms
 */
export function applyPbr(material: THREE.MeshStandardMaterial, kind: PbrKind, unpaintedRock = false, interior = false, shell = false): void {
  const tier = pbrTier();
  const entry: PbrEntry = PBR_MATERIALS[kind];
  const minRough = (entry.minRough ?? 0.42).toFixed(3);
  material.roughness = .9;
  material.metalness = 0;
  material.name = `pbr-${kind}-${tier}`;
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  const fn = `p${kind[0].toUpperCase()}${kind.slice(1)}`;
  material.customProgramCacheKey = () => `${key}|pbr-v3-${kind}-${tier}-${unpaintedRock ? 1 : 0}-${interior ? 1 : shell ? 2 : 0}`;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, pbrUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('vColor = vec4(color, 1.0);', unpaintedRock ? 'vColor = vec4(1.0);' : 'vColor = vec4(color, 1.0);')
      .replace('#include <common>', `#include <common>\nvarying vec3 vPbrSeed;\n${(kind === 'masonry' || kind === 'stone') ? 'attribute float aPbrNatural; attribute vec3 aPbrNaturalNormal; varying float vPbrNatural; varying vec3 vPbrNaturalNormal;' : ''}`)
      .replace('vWorldN = normalize(mat3(worldMat) * normal);', `vWorldN = normalize(mat3(worldMat) * (normal / vec3(dot(worldMat[0].xyz,worldMat[0].xyz),dot(worldMat[1].xyz,worldMat[1].xyz),dot(worldMat[2].xyz,worldMat[2].xyz))));
        ${kind === 'masonry' || kind === 'stone' ? `vPbrNatural=aPbrNatural;
        if(aPbrNatural>.5) vWorldN=normalize(mat3(worldMat)*(aPbrNaturalNormal/vec3(dot(worldMat[0].xyz,worldMat[0].xyz),dot(worldMat[1].xyz,worldMat[1].xyz),dot(worldMat[2].xyz,worldMat[2].xyz))));
        vPbrNaturalNormal=mat3(viewMatrix)*vWorldN;` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 pbrWorldMatrix=modelMatrix;
        #ifdef USE_INSTANCING
          pbrWorldMatrix=modelMatrix*instanceMatrix;
        #endif
        vPbrSeed=pbrWorldMatrix[3].xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPbrSeed;
        ${(kind === 'masonry' || kind === 'stone') ? 'varying float vPbrNatural; varying vec3 vPbrNaturalNormal;' : ''}
        uniform sampler2D uPbrGround;
        uniform float uPbrWorldSize;
        uniform float uAbbeyFill;
        uniform float uAbbeyFloor;
        ${shell ? ABBEY_INDOORS_GLSL : ''}
        ${pbrLibrary(tier)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 pbrWeights=pWeights(normalize(vWorldN));
        vec3 pbrPosition=vWorldP+vPbrSeed*.173;
        ${kind === 'masonry' ? `PbrSurface pbr;
        if(vPbrNatural>.5) { pbr=PBR_TRIPLANAR(pStone,pbrPosition,pbrWeights); }
        else { pbr=PBR_TRIPLANAR(pMasonry,pbrPosition,pbrWeights); }` : `PbrSurface pbr=PBR_TRIPLANAR(${fn},pbrPosition,pbrWeights);`}
        float pbrMacro=pNoise(vWorldP.xz*.021+vWorldP.y*.014);
        float pbrRunoff=pNoise(vec2(dot(vWorldP.xz,vec2(.61,.79))*.7,vWorldP.y*.045));
        pbr.albedo*=1.0-smoothstep(.52,.81,pbrRunoff)*.18;
        pbr.albedo*=mix(vec3(.91,.96,1.02),vec3(1.04,1.0,.91),pbrMacro);
        float pbrGround=texture2D(uPbrGround,vWorldP.xz/uPbrWorldSize+.5).r;
        float pbrContact=(1.0-smoothstep(.06,1.25+(pFbm(vWorldP.xz*1.1+vWorldP.y*.3)-.5)*.8,vWorldP.y-pbrGround));
        float pbrDamp=pbrContact*smoothstep(.30,.66,pFbm(vWorldP.xz*1.3+vWorldP.y*.7));
        ${kind === 'wood' || kind === 'roof' || kind === 'slate' ? 'pbrDamp*=.35;' : ''}
        ${entry.clean || interior ? 'pbrDamp=0.0; pbrContact=0.0;' : ''}
        ${shell ? 'float pbrIndoors=abbeyIndoors(vWorldP); pbrDamp*=1.0-pbrIndoors; pbrContact*=1.0-pbrIndoors;' : ''}
        ${kind === 'ashlar' || kind === 'paving' ? 'pbrDamp*=.45;' : ''}
        ${kind === 'strata' ? `float pbrWetTop=smoothstep(.2,.8,normalize(vWorldN).y);
        pbrDamp=max(pbrDamp,pbrWetTop*smoothstep(.3,.6,pFbm(vWorldP.xz*.5+vWorldP.y*.2+7.0)));` : ''}
        ${kind === 'stone' || kind === 'masonry' ? `float pbrTop=smoothstep(.12,.78,normalize(vWorldN).y);
        float pbrShelter=pFbm(vWorldP.xz*.83+vWorldP.y*.31+27.0);
        pbrDamp=max(pbrDamp,pbrTop*smoothstep(.37,.65,pbrShelter)*.9);
        pbrDamp=max(pbrDamp,smoothstep(.58,.72,pFbm(vec2(vWorldP.x+vWorldP.z,vWorldP.y)*.6+31.0))*.32);` : ''}
        PbrSurface pbrGrowth=pMoss(vWorldP.xz+vWorldP.y);
        // Original vertex tint still distinguishes walls, voussoirs and architectural parts.
        diffuseColor.rgb*=pbr.albedo;
        diffuseColor.rgb=mix(diffuseColor.rgb,pbrGrowth.albedo*.66,pbrDamp*.48);
        pbr.ao*=1.0-pbrContact*.14;
        pbr.roughness=mix(pbr.roughness,.98,pbrDamp);
        float pbrRelief=pbr.height*${kind === 'masonry' ? 'mix(.14,.11,vPbrNatural)' : entry.relief.toFixed(4)};
        vec3 pbrFillAlbedo=diffuseColor.rgb;
        pbrRelief*=1.0-smoothstep(${tier === 'high' ? '100.0,380.0' : '55.0,180.0'},distance(cameraPosition,vWorldP));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor=clamp(pbr.roughness,${minRough},1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor=${(entry.metal ?? 0).toFixed(3)};`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${interior || shell ? `// Light that has bounced about the nave: warm from above, cooler from the floor.
        vec3 pbrFillN=normalize(vWorldN);
        vec3 pbrFill=mix(vec3(.74,.7,.7),vec3(1.0,.94,.82),pbrFillN.y*.5+.5);
        // Brightest near the floor, where the windows throw their light; cooler and dimmer up in the vault.
        float pbrLift=clamp((vWorldP.y-uAbbeyFloor)/30.0,0.0,1.0);
        pbrFill*=mix(vec3(1.1,1.08,1.04),vec3(.72,.78,.9),pbrLift);
        totalEmissiveRadiance+=pbrFillAlbedo*pbrFill*pbr.ao*uAbbeyFill${shell ? '*pbrIndoors' : ''};` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${(kind === 'masonry' || kind === 'stone') ? 'normal=normalize(mix(normal,vPbrNaturalNormal,vPbrNatural));' : ''}\nnormal=pBumpNormal(normal,-vViewPosition,pbrRelief);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse*=pbr.ao;
        reflectedLight.indirectSpecular*=pbr.ao;`);
  };
}

/** A hook for instanced scatter rocks without changing the geometry owner's files. */
export function registerSceneRocks(scene: THREE.Scene): void {
  const byOriginal = new Map<THREE.Material, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const alternative = pbrAlternative(object.material)?.name ?? '';
    if (alternative.startsWith('pbr-masonry-')) classifyNaturalStone(object.geometry);
    // Builder.rock() fractured rubble/wall stones: every component is a natural rock.
    else if (alternative.startsWith('pbr-stone-')) classifyNaturalStone(object.geometry, true);
    if (!object.name.startsWith('rock-lod')) return;
    classifyNaturalStone(object.geometry, true);
    const legacy = object.material;
    let pbr = byOriginal.get(legacy);
    if (!pbr && legacy instanceof THREE.MeshToonMaterial) {
      const standard = new THREE.MeshStandardMaterial({ color: legacy.color, vertexColors: legacy.vertexColors, side: legacy.side });
      standard.onBeforeCompile = legacy.onBeforeCompile;
      standard.customProgramCacheKey = legacy.customProgramCacheKey;
      // Replace the old face-normal paint with physical shading; keep instanceColor.
      applyPbr(standard, 'stone', true);
      pbr = standard; byOriginal.set(legacy, pbr);
    }
    // A per-mesh choice because the legacy material is also shared by tree trunks.
    if (pbr) object.userData.pbrRock = { legacy, pbr };
  });
}
export function usePbr(scene: THREE.Scene, enabled: boolean): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const rock = object.userData.pbrRock as { legacy: THREE.Material; pbr: THREE.Material } | undefined;
    if (rock) { object.material = enabled ? rock.pbr : rock.legacy; return; }
    const choose = (material: THREE.Material): THREE.Material => {
      const original = pbrOriginal(material);
      return enabled ? pbrAlternative(original) ?? original : original;
    };
    object.material = Array.isArray(object.material) ? object.material.map(choose) : choose(object.material);
  });
}
