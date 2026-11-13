import { createServer } from 'vite';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';

// CPU main-pass estimate using the actual tier's grass, crop and scatter budgets.
// Also accepts --root=/path/to/baseline for the same audit against another checkout.
const option = (name) => process.argv.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const root = option('root') ?? process.cwd();
const tier = process.argv.includes('--low') ? 'low' : process.argv.includes('--high') ? 'high' : 'medium';
const output = option('output');
const gradient={addColorStop(){}};
const ctx=new Proxy({},{get:(o,k)=>k in o?o[k]:k==='createLinearGradient'||k==='createRadialGradient'?()=>gradient:k==='getImageData'?(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{},set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({getContext:()=>ctx})};globalThis.location={search:'?q='+tier};
const server=await createServer({root,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try{
 const load=p=>server.ssrLoadModule('/src/'+p+'.ts');
 const Q=(await load('core/quality')).pickQuality(),D=await load('world/structure-detail'),H=await load('world/heightmap');
 const detail={low:0,medium:1,high:2}[tier];D.setStructureDetail(detail);H.buildHeightmap(Q.terrainCell);
 const village=(await load('world/structures/village')).buildVillage(detail),landmarks=(await load('world/structures/landmarks')).buildLandmarks();
 const city=(await load('world/structures/city')).buildCity(detail),flags=(await load('world/flags')).createFlags(city.flags),abbey=(await load('world/structures/abbey')).buildAbbey();
 const texture=H.createHeightTexture(),sun=new THREE.Vector3(.42,.72,.55).normalize();
 const terrain=(await load('world/terrain')).createTerrain(),water=(await load('world/water')).createWater(texture,sun,0xc5dfed);
 const grass=(await load('world/grass')).createGrass(Q.grassNear,Q.grassFar,Q.flowers,texture);
 const crops=(await load('world/structures/village')).buildCrops(detail===0?.4:1,new THREE.MeshBasicMaterial({vertexColors:true}));
 const scatter=(await load('world/scatter')).createScatter(Q,sun),life=(await load('world/life')).createLife(village.info,city.info,detail===0?3:7);
 life.update(1/60,0,new THREE.Vector3(0,40,100));
 const roots=[village.object,landmarks.object,city.object,flags,abbey,terrain,water,grass,crops,scatter.object,life.object];
 const views=[{name:'spawn',eye:[0,40,100],target:[0,85,-400]},{name:'city',eye:[25,120,-245],target:[0,145,-430]},{name:'aerial',eye:[0,430,-160],target:[0,100,-430]}];
 const metrics=[];
 for(const view of views){
  const camera=new THREE.PerspectiveCamera(60,16/9,.1,1800);camera.position.fromArray(view.eye);camera.lookAt(...view.target);camera.updateMatrixWorld();
  scatter.update(camera.position);D.updateStructureDetails(camera.position);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const totals={name:view.name,calls:0,triangles:0,instances:0};
  for(const object of roots){object.updateMatrixWorld(true);object.traverseVisible(o=>{
   if(!o.isMesh)return;
   if(o.frustumCulled&&!frustum.intersectsObject(o))return;
   const n=o.isInstancedMesh?o.count:o.geometry.isInstancedBufferGeometry?o.geometry.instanceCount:1;
   if(!n)return;const base=o.geometry.index?.count??o.geometry.attributes.position.count;
   const count=Math.min(base-o.geometry.drawRange.start,o.geometry.drawRange.count);
   totals.calls+=Array.isArray(o.material)?o.geometry.groups.length:1;
   totals.triangles+=count/3*n;if(n>1)totals.instances+=n;
  });}
  metrics.push(totals);
 }
 const data={root,tier,grass:[Q.grassNear,Q.grassFar,Q.flowers],cropDensity:detail===0?.4:1,views:metrics};
 if (output) writeFileSync(output,JSON.stringify(data,null,2)); console.log(JSON.stringify(data,null,2));
}finally{await server.close();}
