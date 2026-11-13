/** Shot audit using real teleport/support, 90 idle frames, FollowCamera and mesh rays.
 * No renderer or screenshot. Recomputes a clear close-up around the target rock.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
const gradient={addColorStop(){}};
const context=new Proxy({}, {get:(o,key)=>o[key]??(key==='createRadialGradient'||key==='createLinearGradient'?()=>gradient:key==='getImageData'?(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{}),set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const load=path=>server.ssrLoadModule(`/src/${path}.ts`);
  const H=await load('world/heightmap'),details=await load('world/structure-detail');
  details.setStructureDetail(2);H.buildHeightmap(4);
  (await load('render/pbr/config')).configurePbr('high');
  const village=(await load('world/structures/village')).buildVillage(2),landmarks=(await load('world/structures/landmarks')).buildLandmarks();
  const city=(await load('world/structures/city')).buildCity(2),abbey=(await load('world/structures/abbey')).buildAbbey();
  const terrain=(await load('world/terrain')).createTerrain();
  const scatter=(await load('world/scatter')).createScatter({tier:'high',treeDetailRange:260,propRange:600},new THREE.Vector3(.42,.72,.55).normalize());
  const scene=new THREE.Scene();scene.add(village.object,landmarks.object,city.object,abbey,terrain,scatter.object);
  const {registerSceneRocks}=await load('render/pbr/material');
  const classifyStart=performance.now();registerSceneRocks(scene);
  const classificationMs=performance.now()-classifyStart;
  const C=await load('world/colliders'),{Player}=await load('player/controller'),{FollowCamera}=await load('player/camera'),{Wind}=await load('world/wind');
  const shot=(x,z,camyaw,campitch,dist)=>{
    x=+x.toFixed(4);z=+z.toFixed(4);camyaw=+camyaw.toFixed(5);campitch=+campitch.toFixed(3);
    const player=Object.assign(Object.create(Player.prototype),{pos:new THREE.Vector3(),vel:new THREE.Vector3(),yaw:Math.PI,mode:'ground',coyote:0,landTimer:0,glideLock:0,glideSpeed:0,glideTime:0,turn:0,dive:0,lift:0,normal:new THREE.Vector3(),state:{wind:new THREE.Vector3()},character:{root:new THREE.Object3D(),update(){}},onJump(){},onLand(){},onGlide(){},onSplash(){}});
    player.teleport(x,z);
    const camera=new THREE.PerspectiveCamera(55,16/9,.3,7000),follow=new FollowCamera(camera,false);
    follow.yaw=camyaw;follow.pitch=campitch;follow.distance=dist;
    const wind=new Wind();wind.update(0);
    const idle={moveX:0,moveY:0,run:false,takeJump:()=>false};
    for(let frame=0;frame<90;frame++){player.update(1/60,12,idle,follow.yaw,wind);follow.update(1/60,player);}
    camera.updateMatrixWorld();scatter.update(camera.position);details.updateStructureDetails(camera.position);scene.updateMatrixWorld(true);
    return {camera,player,params:{x,z,camyaw,campitch,dist},url:`http://localhost:5173/?autostart=1&shot=1&q=high&style=cinematic&x=${x.toFixed(4)}&z=${z.toFixed(4)}&camyaw=${camyaw.toFixed(5)}&campitch=${campitch.toFixed(3)}&dist=${dist}&dr=0`};
  };
  const matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),point=new THREE.Vector3();
  const findRock=(x,z)=>{
    let best;
    scatter.object.traverse(object=>{
      if(!object.isInstancedMesh||!object.name.startsWith('rock-lod0'))return;
      object.geometry.computeBoundingBox();
      for(let i=0;i<object.count;i++){
        object.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
        const distance=Math.hypot(point.x-x,point.z-z);
        if(!best||distance<best.distance){
          world.multiplyMatrices(object.matrixWorld,matrix);
          best={mesh:object,instance:i,distance,origin:point.clone(),box:object.geometry.boundingBox.clone().applyMatrix4(world)};
        }
      }
    });return best;
  };
  const project=(box,camera)=>{
    const corners=[];
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z).project(camera));
    const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()).project(camera);
    const min=[Math.min(...corners.map(p=>p.x)),Math.min(...corners.map(p=>p.y))],max=[Math.max(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.y))];
    return {size:size.toArray(),center:center.toArray(),min,max,pixels:[(max[0]-min[0])*960,(max[1]-min[1])*540]};
  };
  const visible=(candidate,box,match)=>{
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const samples=[center,center.clone().add(new THREE.Vector3(0,size.y*.22,0)),center.clone().add(new THREE.Vector3(size.x*.2,0,0)),center.clone().add(new THREE.Vector3(-size.x*.2,0,0))];
    return samples.map(target=>{
      const direction=target.clone().sub(candidate.camera.position),ray=new THREE.Raycaster(candidate.camera.position,direction.clone().normalize(),.1,direction.length()+.2);
      const first=ray.intersectObjects(scene.children,true)[0];
      return {clear:!!first&&match(first),first:first?{mesh:first.object.name||first.object.material?.name||first.object.type,instance:first.instanceId,distance:first.distance}:null};
    });
  };
  const old=shot(26.1871,-318.5534,0,.2,2.2),oldRock=findRock(26.1871,-322.5534);
  assert.ok(oldRock&&oldRock.distance<.02);
  const original={params:old.params,player:old.player.pos.toArray(),ground:H.heightAt(old.params.x,old.params.z),projection:project(oldRock.box,old.camera),origin:oldRock.origin.toArray(),rays:visible(old,oldRock.box,hit=>hit.object===oldRock.mesh&&hit.instanceId===oldRock.instance)};
  // This is the same instance, not a guessed coordinate or a newly placed rock.
  const center=oldRock.box.getCenter(new THREE.Vector3()),size=oldRock.box.getSize(new THREE.Vector3());
  let best;
  const candidates=[];
  for(let angle=0;angle<Math.PI*2;angle+=Math.PI/4)for(const gap of [.5,1.0,1.5])for(const side of [-.7,.7])for(const pitch of [.45,.65,.85]){
    const dir=new THREE.Vector2(Math.sin(angle),Math.cos(angle)),right=new THREE.Vector2(Math.cos(angle),-Math.sin(angle));
    const reach=Math.max(size.x,size.z)*.5+gap;
    const x=center.x+dir.x*reach+right.x*side,z=center.z+dir.y*reach+right.y*side;
    if(C.solidAt(x,H.heightAt(x,z)+.8,z)||C.surfaceTop(x,z)-H.heightAt(x,z)>.5)continue;
    const candidate=shot(x,z,angle,pitch,2.2),projection=project(oldRock.box,candidate.camera);
    if(candidate.player.mode!=='ground'||Math.hypot(candidate.player.pos.x-x,candidate.player.pos.z-z)>.05)continue;
    if(Math.abs(projection.center[0])<.13||Math.abs(projection.center[0])>.7||Math.abs(projection.center[1])>.6)continue;
    if(projection.min.some(v=>v<-.95)||projection.max.some(v=>v>.95))continue;
    candidates.push({candidate,projection,score:projection.pixels[0]*projection.pixels[1]});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const rejected=[];
  for(const entry of candidates){
    scatter.update(entry.candidate.camera.position);scene.updateMatrixWorld(true);
    const current=findRock(oldRock.origin.x,oldRock.origin.z);
    if(!current||current.distance>.05)continue;
    const rays=visible(entry.candidate,current.box,hit=>hit.object===current.mesh&&hit.instanceId===current.instance);
    if(rejected.length<8)rejected.push({params:entry.candidate.params,player:entry.candidate.player.pos.toArray(),projection:entry.projection,rays});
    if(rays.filter(ray=>ray.clear).length>=3){best={...entry,rays};break;}
  }
  if(!best)writeFileSync('/tmp/pbr-shots-debug.json',JSON.stringify({original,candidates:candidates.length,rejected},null,2));
  assert.ok(best,'no clear framing for original independent rock');
  assert.ok(best.projection.pixels[0]>150 && best.projection.pixels[1]>90,'rock too small for a material close-up');
  const rubble=[];
  landmarks.object.traverse(object=>{
    if(!object.isMesh)return;
    for(const bounds of object.geometry.userData.pbrNaturalBounds??[]){
      const box=new THREE.Box3(new THREE.Vector3(...bounds.slice(0,3)),new THREE.Vector3(...bounds.slice(3))).applyMatrix4(object.matrixWorld);
      const c=box.getCenter(new THREE.Vector3());
      if(Math.hypot(c.x-6,c.z-102)<13 && box.max.y-box.min.y>.5)rubble.push({mesh:object,box,distance:Math.hypot(c.x-6,c.z-102)});
    }
  });
  rubble.sort((a,b)=>a.distance-b.distance);assert.ok(rubble.length>0,'spawn rubble never classified');
  const target=rubble[0],rc=target.box.getCenter(new THREE.Vector3());
  // Walkway-side view of the nearest full-sized spawn fragment, not its painted masonry band.
  let rubbleBest;
  for(const angle of [Math.PI/2,0,Math.PI,-Math.PI/2])for(const gap of [1,1.6,2.2])for(const pitch of [.35,.55,.75]){
    const x=rc.x+Math.sin(angle)*gap+.7*Math.cos(angle),z=rc.z+Math.cos(angle)*gap-.7*Math.sin(angle);
    if(C.surfaceTop(x,z)-H.heightAt(x,z)>.5||C.solidAt(x,H.heightAt(x,z)+.8,z))continue;
    const candidate=shot(x,z,angle,pitch,2.2),projection=project(target.box,candidate.camera);
    if(Math.abs(projection.center[0])>.75||Math.abs(projection.center[1])>.7||projection.min.some(v=>v<-.98)||projection.max.some(v=>v>.98))continue;
    const rays=visible(candidate,target.box,hit=>{
      if(hit.object!==target.mesh)return false;
      const index=hit.object.geometry.index,vertex=index?index.getX(hit.faceIndex*3):hit.faceIndex*3;
      return hit.object.geometry.attributes.aPbrNatural.getX(vertex)>.5 && target.box.clone().expandByScalar(.01).containsPoint(hit.point);
    });
    if(rays.filter(r=>r.clear).length>=3&&(!rubbleBest||projection.pixels[0]*projection.pixels[1]>rubbleBest.projection.pixels[0]*rubbleBest.projection.pixels[1]))rubbleBest={candidate,projection,rays};
  }
  assert.ok(rubbleBest,'spawn rubble has no clear checked framing');
  const independent={params:best.candidate.params,url:best.candidate.url,player:best.candidate.player.pos.toArray(),camera:best.candidate.camera.position.toArray(),origin:oldRock.origin.toArray(),projection:best.projection,rays:best.rays};
  const spawn={params:rubbleBest.candidate.params,url:rubbleBest.candidate.url,center:rc.toArray(),projection:rubbleBest.projection,rays:rubbleBest.rays};
  const classification={ms:classificationMs,components:0,vertices:0,triangles:0,attributeBytes:0};
  scene.traverse(object=>{if(!object.isMesh||!object.geometry.userData.pbrNatural)return;const a=object.geometry.userData.pbrNatural;classification.components+=a.components;classification.vertices+=a.vertices;classification.triangles+=a.triangles;classification.attributeBytes+=object.geometry.attributes.aPbrNatural.array.byteLength+object.geometry.attributes.aPbrNaturalNormal.array.byteLength;});
  const output={scope:'1920x1080, real Player.teleport + 90-frame idle + FollowCamera + world mesh rays; grass/hero pixel occlusion requires external capture.',original,independent,spawn,classification};
  writeFileSync('/tmp/galebound-pbr-shots.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));console.log('PASS: independent rock and spawn rubble have checked, unobstructed close-up URLs');
}finally{await server.close();}
