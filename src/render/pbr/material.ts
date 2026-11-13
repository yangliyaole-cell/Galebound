import * as THREE from 'three';
import { pbrTier } from './config';
import { PBR_MATERIALS, pbrLibrary, type PbrKind } from './library';

export const pbrUniforms = {
  uPbrActive: { value: 0 },
  uPbrGround: { value: null as THREE.Texture | null },
  uPbrContact: { value: null as THREE.Texture | null },
  uPbrWorldSize: { value: 2048 },
};
const alternatives = new Map<THREE.Material, THREE.Material>();
const originals = new Map<THREE.Material, THREE.Material>();
export function registerPbr(original: THREE.Material, material: THREE.Material): void {
  alternatives.set(original, material); originals.set(material, original);
}
export function pbrAlternative(material: THREE.Material): THREE.Material | undefined { return alternatives.get(material); }
export function pbrOriginal(material: THREE.Material): THREE.Material { return originals.get(material) ?? material; }

export function applyPbr(material: THREE.MeshStandardMaterial, kind: PbrKind): void {
  const tier = pbrTier();
  const entry = PBR_MATERIALS[kind];
  material.roughness = .9;
  material.metalness = 0;
  material.name = `pbr-${kind}-${tier}`;
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  const fn = `p${kind[0].toUpperCase()}${kind.slice(1)}`;
  material.customProgramCacheKey = () => `${key}|pbr-v1-${kind}-${tier}`;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, pbrUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPbrSeed;`)
      .replace('vWorldN = normalize(mat3(worldMat) * normal);', `vWorldN = normalize(mat3(worldMat) * (normal / vec3(dot(worldMat[0].xyz,worldMat[0].xyz),dot(worldMat[1].xyz,worldMat[1].xyz),dot(worldMat[2].xyz,worldMat[2].xyz))));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 pbrWorldMatrix=modelMatrix;
        #ifdef USE_INSTANCING
          pbrWorldMatrix=modelMatrix*instanceMatrix;
        #endif
        vPbrSeed=pbrWorldMatrix[3].xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPbrSeed;
        uniform sampler2D uPbrGround;
        uniform float uPbrWorldSize;
        ${pbrLibrary(tier)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 pbrWeights=pWeights(normalize(vWorldN));
        vec3 pbrPosition=vWorldP+vPbrSeed*.173;
        PbrSurface pbr=PBR_TRIPLANAR(${fn},pbrPosition,pbrWeights);
        float pbrMacro=pNoise(vWorldP.xz*.021+vWorldP.y*.014);
        float pbrRunoff=pNoise(vec2(dot(vWorldP.xz,vec2(.61,.79))*.7,vWorldP.y*.045));
        pbr.albedo*=1.0-smoothstep(.52,.81,pbrRunoff)*.12;
        pbr.albedo*=mix(vec3(.91,.96,1.02),vec3(1.04,1.0,.91),pbrMacro);
        float pbrGround=texture2D(uPbrGround,vWorldP.xz/uPbrWorldSize+.5).r;
        float pbrContact=(1.0-smoothstep(.06,1.25+(pbrMacro-.5)*.65,vWorldP.y-pbrGround));
        float pbrDamp=pbrContact*smoothstep(.30,.66,pFbm(vWorldP.xz*1.3+vWorldP.y*.7));
        ${kind === 'wood' || kind === 'roof' ? 'pbrDamp*=.35;' : ''}
        PbrSurface pbrGrowth=pMoss(vWorldP.xz+vWorldP.y);
        // Original vertex tint still distinguishes walls, voussoirs and architectural parts.
        diffuseColor.rgb*=pbr.albedo;
        diffuseColor.rgb=mix(diffuseColor.rgb,pbrGrowth.albedo*.66,pbrDamp*.48);
        pbr.ao*=1.0-pbrContact*.14;
        pbr.roughness=mix(pbr.roughness,.98,pbrDamp);
        float pbrRelief=pbr.height*${entry.relief.toFixed(4)};
        pbrRelief*=1.0-smoothstep(${tier === 'high' ? '100.0,380.0' : '55.0,180.0'},distance(cameraPosition,vWorldP));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=clamp(pbr.roughness,.42,1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=pBumpNormal(normal,-vViewPosition,pbrRelief);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse*=pbr.ao;
        reflectedLight.indirectSpecular*=pbr.ao;`);
  };
}

/** A hook for instanced scatter rocks without changing the geometry owner's files. */
export function registerSceneRocks(scene: THREE.Scene): void {
  const byOriginal = new Map<THREE.Material, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith('rock-lod') || Array.isArray(object.material)) return;
    const legacy = object.material;
    let pbr = byOriginal.get(legacy);
    if (!pbr && legacy instanceof THREE.MeshToonMaterial) {
      const standard = new THREE.MeshStandardMaterial({ color: legacy.color, vertexColors: legacy.vertexColors, side: legacy.side });
      standard.onBeforeCompile = legacy.onBeforeCompile;
      standard.customProgramCacheKey = legacy.customProgramCacheKey;
      applyPbr(standard, 'stone');
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
