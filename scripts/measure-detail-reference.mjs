// Read-only archived reference measurement. Example: --root /tmp/reference --tier medium
import { createServer } from 'vite';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measure, reviewViews, screenshotViews, collisionDigest } from './detail-metrics.mjs';
const arg = name => { const index=process.argv.indexOf(name); return index<0?undefined:process.argv[index+1]; };
const root=resolve(arg('--root')), tier=arg('--tier') || 'medium', output=arg('--out');
if(!['low','medium','high'].includes(tier) || !output) throw new Error('Required: --root DIR --tier low|medium|high --out FILE');
const gradient={addColorStop(){}};
const context=new Proxy({},{get:(o,key)=> key==='createRadialGradient'||key==='createLinearGradient'?()=>gradient:key==='getImageData'?(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{},set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>context})};
const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
 const load=path=>server.ssrLoadModule('/src/'+path+'.ts'),low=tier==='low',detail=low?0:tier==='high'?2:1;
 const L=await load('world/layout'),H=await load('world/heightmap'),C=await load('world/colliders');
 H.buildHeightmap(low?8:4);
 const village=await load('world/structures/village'),v=village.buildVillage(detail);
 const landmarks=(await load('world/structures/landmarks')).buildLandmarks();
 const city=(await load('world/structures/city')).buildCity(detail),abbey=(await load('world/structures/abbey')).buildAbbey();
 const texture=H.createHeightTexture(),sun=new THREE.Vector3(.42,.72,.55).normalize();
 const terrain=(await load('world/terrain')).createTerrain(),water=(await load('world/water')).createWater(texture,sun,0xc5dfed);
 const amounts=low?[7000,9000,1200]:detail===2?[24000,36000,6000]:[14000,20000,3000];
 const grass=(await load('world/grass')).createGrass(...amounts,texture);
 const scatter=(await load('world/scatter')).createScatter({tier,treeDetailRange:low?90:detail===2?260:170,propRange:low?260:detail===2?600:420},sun);
 const life=(await load('world/life')).createLife(v.info,city.info,low?3:7);
 life.update(1/60,0,new THREE.Vector3(L.START.x,40,L.START.z));
 const crops=village.buildCrops(low?.4:1,new THREE.MeshBasicMaterial({vertexColors:true}));
 const roots=[v.object,landmarks.object,city.object,abbey,terrain,water,grass,crops,life.object];
 const data={reference:'7245ee5',tier,collision:collisionDigest(C.inspectColliders()),views:measure(roots,scatter,reviewViews(L,H),low?1100:detail===2?1800:1500),screenshots:measure(roots,scatter,screenshotViews(L,H),low?1100:detail===2?1800:1500)};
 writeFileSync(output,JSON.stringify(data,null,2));
 console.log(tier,output);
}finally{await server.close();}
