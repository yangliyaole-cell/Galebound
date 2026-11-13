/** CPU submission estimate, not GPU timing. Includes real tier grass counts and shadow passes.
 * Run: node scripts/pbr-metrics.mjs --low|--high (default: medium).
 */
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const tier=process.argv.includes('--low')?'low':process.argv.includes('--high')?'high':'medium';
const gradient={addColorStop(){}};
const context=new Proxy({}, {get:(object,key)=>object[key]??(key==='createRadialGradient'||key==='createLinearGradient'?()=>gradient:key==='getImageData'?(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{}),set:(object,key,value)=>(object[key]=value,true)});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>context})};
globalThis.location={search:`?q=${tier}`};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const load=(path)=>server.ssrLoadModule(`/src/${path}.ts`);
  const {pickQuality}=await load('core/quality'), quality=pickQuality();
  const {configurePbr}=await load('render/pbr/config');configurePbr(tier);
  const details=await load('world/structure-detail');const detail=tier==='low'?0:tier==='medium'?1:2;details.setStructureDetail(detail);
  const H=await load('world/heightmap');H.buildHeightmap(quality.terrainCell);
  const {buildVillage,buildCrops}=await load('world/structures/village');
  const village=buildVillage(detail),landmarks=(await load('world/structures/landmarks')).buildLandmarks();
  const city=(await load('world/structures/city')).buildCity(detail),abbey=(await load('world/structures/abbey')).buildAbbey();
  const {toon}=await load('render/toon');
  const height=H.createHeightTexture(),sunDir=new THREE.Vector3(.42,.72,.55).normalize();
  const terrain=(await load('world/terrain')).createTerrain();
  const water=(await load('world/water')).createWater(height,sunDir,0xc5dfed);
  const grass=(await load('world/grass')).createGrass(quality.grassNear,quality.grassFar,quality.flowers,height);
  const scatter=(await load('world/scatter')).createScatter(quality,sunDir);
  const life=(await load('world/life')).createLife(village.info,city.info,detail===0?3:7);
  const crops=buildCrops(detail===0?.4:1,toon(0xffffff,{vertexColors:true,leafTint:true,sway:.05,doubleSided:true}));
  const scene=new THREE.Scene();scene.add(village.object,landmarks.object,city.object,abbey,terrain,water,grass,scatter.object,life.object,crops);
  const camera=new THREE.PerspectiveCamera(55,16/9,.3,7000),sun=new THREE.DirectionalLight(0xfff0cf,3);
  sun.castShadow=quality.shadowSize>0;sun.shadow.mapSize.setScalar(quality.shadowSize||256);
  Object.assign(sun.shadow.camera,{left:-quality.shadowRange,right:quality.shadowRange,top:quality.shadowRange,bottom:-quality.shadowRange,near:1,far:420});sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
  const sky=new THREE.Group();sky.add(new THREE.Mesh(new THREE.SphereGeometry(),new THREE.ShaderMaterial({uniforms:{uSunDir:{value:sunDir}},fragmentShader:'gl_FragColor = vec4(col, 1.0);'})));
  const {createPbrLighting}=await load('render/pbr/lighting');
  const capture=THREE.PMREMGenerator.prototype.fromScene;
  THREE.PMREMGenerator.prototype.fromScene=()=>new THREE.WebGLRenderTarget(16,16);
  const materialStart=performance.now();
  const lighting=createPbrLighting({},scene,camera,sun,sunDir,sky,quality,height);
  const materialSetup={ms:performance.now()-materialStart,attributeBytes:0,components:0};
  const auditedGeometry=new Set();
  scene.traverse(object=>{
    if(!object.isMesh||auditedGeometry.has(object.geometry)||!object.geometry.userData.pbrNatural)return;
    auditedGeometry.add(object.geometry);materialSetup.components+=object.geometry.userData.pbrNatural.components;
    materialSetup.attributeBytes+=object.geometry.attributes.aPbrNatural.array.byteLength+object.geometry.attributes.aPbrNaturalNormal.array.byteLength;
  });
  const count=(view,shadow=false)=>{
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse));
    let calls=0,triangles=0;
    scene.traverseVisible(object=>{
      if(!object.isMesh || (shadow && !object.castShadow))return;
      if(object.frustumCulled && !frustum.intersectsObject(object))return;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.every(material=>!material.visible))return;
      const g=object.geometry;
      const instances=object.isInstancedMesh?object.count:g.isInstancedBufferGeometry?g.instanceCount:1;
      if(!instances)return;
      const available=g.index?.count??g.attributes.position.count;
      const groups=Array.isArray(object.material)?g.groups:[{start:0,count:available,materialIndex:0}];
      for(const group of groups){
        if(!materials[group.materialIndex??0]?.visible)continue;
        const start=Math.max(group.start,g.drawRange.start),end=Math.min(available,group.start+group.count,g.drawRange.start+g.drawRange.count);
        if(end>start){calls++;triangles+=(end-start)/3*instances;}
      }
    });
    return {calls,triangles};
  };
  const {shared}=await load('render/uniforms');
  const views=[];
  for(const view of [{name:'spawn',eye:[0,40,100],target:[0,85,-400]},{name:'city',eye:[25,120,-245],target:[0,145,-430]},{name:'aerial',eye:[0,430,-160],target:[0,100,-430]}]){
    camera.position.fromArray(view.eye);camera.lookAt(...view.target);camera.updateMatrixWorld();shared.uPlayer.value.copy(camera.position);
    scatter.update(camera.position);details.updateStructureDetails(camera.position);life.update(1/60,0,camera.position);
    // Apply production interior visibility callbacks before collecting submissions.
    scene.traverse(object=>{if(object.isMesh)object.onBeforeRender();});
    scene.updateMatrixWorld(true);
    lighting.update('default');
    sun.target.position.copy(camera.position);sun.position.copy(sunDir).multiplyScalar(220).add(camera.position);scene.updateMatrixWorld(true);
    const before=count(camera);let originalShadow={calls:0,triangles:0};
    if(sun.castShadow){sun.shadow.updateMatrices(sun);originalShadow=count(sun.shadow.camera,true);}
    lighting.update('cinematic');scene.updateMatrixWorld(true);
    const after=count(camera);assert.deepEqual(after,before,'PBR must not add color-pass geometry');
    const shadows=(scene.userData.pbr?.csm.lights??[]).map(light=>{light.shadow.updateMatrices(light);return count(light.shadow.camera,true);});
    views.push({name:view.name,color:after,originalShadow,cascadeShadows:shadows,total:{calls:after.calls+shadows.reduce((sum,v)=>sum+v.calls,0),triangles:after.triangles+shadows.reduce((sum,v)=>sum+v.triangles,0)}});
  }
  THREE.PMREMGenerator.prototype.fromScene=capture;
  const L=await load('world/layout'),C=await load('world/colliders');
  const stances=[['abbey-masonry',-611,-454,0],['abbey-contact',-620,-449,0],['road',18,-330,0],['bridge-bank',29,-210,0],['city-gate',L.SOUTH_GATE.x,L.SOUTH_GATE.z+12,0],['watchtower',250,267,0]];
  const shots=stances.map(([name,x,z,camyaw])=>({name,x,z,camyaw,ground:H.heightAt(x,z),blocked:C.solidAt(x,H.heightAt(x,z)+.8,z)}));
  scatter.update(new THREE.Vector3(18,H.heightAt(18,-330)+2,-330));
  const rocks=[];const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
  scatter.object.traverse(object=>{if(object.isInstancedMesh&&object.name.startsWith('rock-lod0'))for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);rocks.push({x:position.x,y:position.y,z:position.z,d:Math.hypot(position.x-18,position.z+330)});}});
  rocks.sort((a,b)=>a.d-b.d);
  const nearestRocks=rocks.slice(0,4).map(rock=>({...rock,stance:{x:rock.x,z:rock.z+4,ground:H.heightAt(rock.x,rock.z+4),blocked:C.solidAt(rock.x,H.heightAt(rock.x,rock.z+4)+.8,rock.z+4)}}));
  const output={tier,scope:'CPU frustum/submission estimate: world + full tier grass/crops/scatter/life. Excludes sky/player/orbs/VFX/flags/postprocessing. Counts submitted triangles before alpha/LOD discard; no GPU timings.',materialSetup,views,shots,nearestRocks};
  writeFileSync(`/tmp/galebound-pbr-metrics-${tier}.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}finally{await server.close();}
