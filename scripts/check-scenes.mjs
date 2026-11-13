import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { measure } from './detail-metrics.mjs';
import { createHash } from 'node:crypto';

// CPU-only production geometry/physics audit. No browser or WebGL context is created.
// The pre-existing procedural texture painter alone needs this canvas stand-in.
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, k) => k in o ? o[k] :
  k === 'createLinearGradient' || k === 'createRadialGradient' ? () => gradient :
  k === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {},
  set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let failures = 0;
const check = (name, fn) => { try { const result = fn(); console.log(`PASS ${name}${result ? ': ' + result : ''}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); } };
try {
  const detail = process.argv.includes('--low') ? 0 : process.argv.includes('--high') ? 2 : 1;
  const load = (path) => server.ssrLoadModule('/src/' + path + '.ts');
  const [H, L, C, D, P, G] = await Promise.all([
    load('world/heightmap'), load('world/layout'), load('world/colliders'), load('world/structure-detail'),
    load('world/scenes/plan'), load('world/scenes/geometry'),
  ]);
  D.setStructureDetail(detail); H.buildHeightmap(detail === 0 ? 8 : 4);
  const village = (await load('world/structures/village')).buildVillage(detail);
  const landmarks = (await load('world/structures/landmarks')).buildLandmarks();
  const city = (await load('world/structures/city')).buildCity(detail);
  const abbey = (await load('world/structures/abbey')).buildAbbey();
  const scenes = landmarks.object.getObjectByName('Reference landscape scenes');
  const M = await load('world/mountain-layout');
  const geology = await load('world/scenes/geology');
  const glacier = await load('world/scenes/glacier');
  assert.ok(scenes, 'production mountain scenery did not register the new scenes');
  const counts = scenes.userData.sceneCounts, solids = G.sceneSolids;
  const fingerprint = createHash('sha256');
  scenes.traverse((o) => { if (o.isMesh) for (const key of Object.keys(o.geometry.attributes).sort()) {
    const a=o.geometry.attributes[key].array; fingerprint.update(key).update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
  } });
  console.log('GEOMETRY SHA256 ' + fingerprint.digest('hex'));
  const meshCount = (root) => { let count = 0; root.traverse((o) => { if (o.isMesh) count++; }); return count; };
  console.log('STRUCTURE MESHES ' + JSON.stringify({ village: meshCount(village.object), landmarks: meshCount(landmarks.object), city: meshCount(city.object), abbey: meshCount(abbey), scenes: meshCount(scenes) }));
  check('finite terrain, stable palace and abbey shelves, bounded heights', () => {
    const data = H.grid().data; let min = Infinity, max = -Infinity;
    for (const h of data) { assert.ok(Number.isFinite(h)); min = Math.min(min, h); max = Math.max(max, h); }
    assert.ok(min > -30 && max < 900, `${min}..${max}`);
    assert.ok(Math.abs(H.heightAt(L.CITY.x, L.CITY.z) - 109) < 0.01);
    assert.ok(Math.abs(H.heightAt(L.ABBEY.x, L.ABBEY.z) - L.ABBEY.floor) < 0.01);
    assert.ok(H.heightAt(L.START.x, L.START.z) > 30);
    return `${min.toFixed(2)}..${max.toFixed(2)}m; palace=109m; abbey=64m`;
  });
  check('city has an exposed cliff outside the curtain wall', () => {
    let tested = 0, greatest = 0;
    for (let a = 0.15; a < Math.PI - 0.15; a += 0.08) {
      const edge = L.cityRadiusAt(a);
      const at = (d) => [L.CITY.x + Math.cos(a) * (edge + d), L.CITY.z + Math.sin(a) * (edge + d)];
      if ([at(5), at(30)].some(([x, z]) => L.roadClearance(x, z) < 9)) continue;
      const drop = H.heightAt(...at(5)) - H.heightAt(...at(30));
      if (drop > 24) tested++;
      greatest = Math.max(greatest, drop);
    }
    assert.ok(tested >= 12 && greatest > 36, `only ${tested} cliff transects, greatest drop ${greatest}`);
    return `${tested} steep transects, max ${greatest.toFixed(1)}m drop over 25m`;
  });
  check('all new solid footprints clear roads, spawn and abbey interior', () => {
    for (const s of solids) {
      assert.ok(Math.abs(s.x) + s.radius < L.HALF && Math.abs(s.z) + s.radius < L.HALF, `${s.kind} outside map`);
      assert.ok(L.roadClearance(s.x, s.z) > s.radius + 0.5, `${s.kind} on road at ${s.x},${s.z}`);
      assert.ok(Math.hypot(s.x - L.START.x, s.z - L.START.z) > 18 + s.radius, `${s.kind} on spawn`);
      assert.ok(Math.abs(s.x - L.ABBEY.x) > 33 + s.radius || Math.abs(s.z - L.ABBEY.z) > 40 + s.radius, `${s.kind} in abbey`);
    }
    return `${solids.length} surveyed footprints`;
  });
  check('new geometry stays finite and entirely inside map', () => {
    scenes.updateMatrixWorld(true);
    scenes.traverse((o) => {
      if (!o.isMesh) return;
      for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
      o.geometry.computeBoundingSphere(); assert.ok(Number.isFinite(o.geometry.boundingSphere.radius));
      if (o.geometry.isInstancedBufferGeometry) {
        const seeds=o.geometry.attributes.aSeed??o.geometry.attributes.aBase;
        assert.ok(seeds, 'unexamined custom instance attributes');
        for(let i=0;i<seeds.count;i++)assert.ok(Math.abs(seeds.getX(i))<L.HALF&&Math.abs(seeds.getZ(i))<L.HALF);
        return;
      }
      const p = o.geometry.attributes.position, q = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        q.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        assert.ok(Math.abs(q.x) < L.HALF && Math.abs(q.z) < L.HALF, `${o.name || 'merged scene'} vertex outside map (${q.x},${q.z})`);
      }
    });
    return `${meshCount(scenes)} batched meshes`;
  });
  check('glacier, hanging valley, waterfall and local water are continuous', () => {
    const f = P.GREAT_FALL;
    assert.equal(f.y - f.bottom, 100);
    for (const t of [0, .15, .4, .75, 1]) {
      const p = M.ALPINE_STREAM[Math.round(t * 14)];
      assert.ok(H.heightAt(p.x,p.z) < p.y + 2, `upstream bed emerges at ${p.x},${p.z}: ${H.heightAt(p.x,p.z)} > ${p.y}`);
    }
    for (const [x,z] of P.GLACIER_SPINE) assert.ok(H.heightAt(x,z)>180, `low glacier at ${x},${z}`);
    assert.ok(Math.abs(H.heightAt(f.x,f.z)-f.y)<5, 'fall lip does not join terrain');
    assert.ok(Math.abs(M.waterLevelAt(f.x,f.z)-f.y)<0.5);
    for (const end of [[P.VIADUCT.ax,P.VIADUCT.az],[P.VIADUCT.bx,P.VIADUCT.bz]]) {
      assert.ok(H.heightAt(...end)>P.VIADUCT.deck-6, `viaduct abutment suspended at ${end}: ground ${H.heightAt(...end)}`);
    }
    assert.ok(counts.arches >= 12, `${counts.arches} open arches`);
    return `100m cascade, ${counts.arches} open arches / 15 bays; glacier widths ${P.GLACIER_SPINE.map((p)=>p[2]*2).join('/')}m`;
  });
  check('ice has upward faces and blue/white crevasse vertex colours', () => {
    let blue=0,white=0;
    scenes.traverse((o)=>{if(!o.isMesh||o.geometry.isInstancedBufferGeometry)return;
      const p=o.geometry.attributes.position,c=o.geometry.attributes.color;
      for(let i=0;i<p.count;i++){
        if(p.getX(i)<-845||p.getX(i)>-740||p.getZ(i)>-835||p.getZ(i)<-965||!c)continue;
        if(c.getZ(i)>c.getX(i)*1.35)blue++;if(c.getX(i)>.7&&c.getZ(i)>.8)white++;
      }
    });
    assert.ok(blue>10&&white>10,`${blue} blue, ${white} white vertices`);
    for(const [x,z] of P.GLACIER_SPINE.slice(1,-1)){
      const hits=new THREE.Raycaster(new THREE.Vector3(x,H.heightAt(x,z)+10,z),new THREE.Vector3(0,-1,0)).intersectObject(scenes,true);
      assert.ok(hits.some(h=>h.point.y>H.heightAt(x,z)+.1&&h.face.normal.y>0),'buried or back-facing ice');
    }
    return `${blue} blue / ${white} white vertices`;
  });
  check('sharp ridge normals, slope-dependent snow and nonperiodic recessed ice fractures', () => {
    const stats=glacier.alpineSurfaceStats;
    assert.ok(stats.rockVertices>100&&stats.snowVertices>30,JSON.stringify(stats));
    assert.equal(stats.steepSnowVertices,0,'snow blankets steep rock faces');
    let ridges=0;
    for(const peak of P.GLACIAL_HORNS){
      const left=H.normalAt(peak.x-12,peak.z,new THREE.Vector3()),right=H.normalAt(peak.x+12,peak.z,new THREE.Vector3());
      if(left.dot(right)<.8)ridges++;
    }
    assert.ok(ridges>=2,`${ridges} sharp ridge crests`);
    let deepest=0;
    for(const f of geology.ICE_FRACTURES){const result=geology.iceFracture((f.ax+f.bx)/2,(f.az+f.bz)/2);deepest=Math.max(deepest,result.depth);}
    assert.ok(deepest>2,'fractures have colour but no geometric depth');
    const widths=geology.ICE_FRACTURES.map(f=>Math.hypot(f.bx-f.ax,f.bz-f.az));
    assert.ok(Math.max(...widths)>Math.min(...widths)*1.5,'repeated equal-width crevasses');
    return `${ridges} crests; ${stats.rockVertices} exposed rock / ${stats.snowVertices} snow vertices; cracks ${deepest.toFixed(2)}m deep`;
  });
  check('bedrock buttresses and talus are grounded, bridge piers meet masonry proportions', () => {
    assert.ok(counts.buttresses>0&&counts.talus>0);
    assert.ok(G.rockContacts.length>=counts.rocks);
    for(const p of G.rockContacts)assert.ok(Number.isFinite(p.gap)&&p.gap<.05,`floating rock at ${p.x},${p.z}`);
    const v=P.VIADUCT,bay=Math.hypot(v.bx-v.ax,v.bz-v.az)/v.bays;
    assert.ok(v.pierWidth/bay>=.25&&v.lowerDeck>35&&v.lowerDeck<v.deck-30);
    assert.ok(C.surfaceTop(-803,-971)>=H.heightAt(-803,-971)+.2,'snow mantle does not exclude shared floating pebbles');
    return `${G.rockContacts.length} rock contacts; pier/bay ${(v.pierWidth/bay).toFixed(3)}, lower arcade ${v.lowerDeck}m`;
  });
  check('valley mist stays below the subject and cloud optical density is normalized', () => {
    const mesh=scenes.getObjectByName('Valley clouds spray and cottage smoke');if(!detail){assert.equal(mesh,undefined);return;}
    const seeds=mesh.geometry.attributes.aSeed,kind=mesh.geometry.attributes.aKind;
    let cloud=0,spray=0;
    for(let i=0;i<seeds.count;i++){
      if(kind.getX(i)===2){cloud++;assert.ok(seeds.getY(i)<=90);assert.ok(seeds.getX(i)<-845||seeds.getX(i)>-470,'cloud in main waterfall sightline');}
      if(kind.getX(i)===0){spray++;assert.ok(seeds.getW(i)<=3.5);}
    }
    assert.ok(cloud>0&&spray<=35);assert.ok(mesh.material.uniforms.uCloudWeight.value<=1);
    return `${cloud} small cloud puffs on valley flanks; ${spray} low spray cards`;
  });
  check('waygate opening and meadow photo stances clear solid geometry', () => {
    for(let z=P.WAYGATE.z+7;z>P.WAYGATE.z-7;z-=.12){
      const x=P.WAYGATE.x,y=H.heightAt(x,z),p={x,z};C.resolveWalls(p,.32,y,y+1.7,.5);
      assert.ok(Math.hypot(p.x-x,p.z-z)<.04,`gate arch blocked at ${x},${z}`);
    }
    for(const [x,z] of [[-22,87],[75,70],[-220,-45],[367,-244]]){
      const y=H.heightAt(x,z); assert.ok(!C.solidAt(x,y+.8,z),`photo stance ${x},${z} inside solid`);
    }
  });
  check('new allocations respect tier budgets', () => {
    const limit = P.sceneDensity(detail);
    assert.equal(counts.trees, limit.trees); assert.equal(counts.flowers, limit.flowers); assert.equal(counts.rocks, limit.rapids);
    assert.ok(counts.homes >= 9 && counts.homes <= 11, `${counts.homes} hamlet homes`);
    assert.ok(counts.atmosphericInstances <= (detail === 2 ? 230 : detail === 1 ? 90 : 0));
    return JSON.stringify(counts);
  });
  const terrain = (await load('world/terrain')).createTerrain();
  const texture = H.createHeightTexture(), sun = new THREE.Vector3(.42, .72, .55).normalize();
  const water = (await load('world/water')).createWater(texture, sun, 0xc5dfed);
  const grass = (await load('world/grass')).createGrass(1000, 1200, 200, texture);
  const crops = (await load('world/structures/village')).buildCrops(.4, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const scatter = (await load('world/scatter')).createScatter({ tier: ['low', 'medium', 'high'][detail], treeDetailRange: [90,170,260][detail], propRange: [260,420,600][detail] }, sun);
  const life = (await load('world/life')).createLife(village.info, city.info, 7);
  life.update(1/60, 0, new THREE.Vector3(L.START.x, 40, L.START.z));
  const {Player}=await load('player/controller'),{FollowCamera}=await load('player/camera');
  const replayShot=(x,z,up,yaw,pitch)=>{
    const player=Object.assign(Object.create(Player.prototype),{
      pos:new THREE.Vector3(x,C.supportHeight(x,z,Infinity,0)+up,z),vel:new THREE.Vector3(),yaw:Math.PI,mode:up>.5?'air':'ground',
      coyote:0,landTimer:0,glideLock:0,glideSpeed:0,glideTime:0,turn:0,dive:0,lift:0,normal:new THREE.Vector3(),state:{wind:new THREE.Vector3()},
      character:{root:new THREE.Object3D(),update(){}},onJump(){},onLand(){},onGlide(){},onSplash(){},
    });
    const camera=new THREE.PerspectiveCamera(55,16/9,.3,7000),follow=new FollowCamera(camera,false);
    follow.yaw=yaw;follow.pitch=pitch;follow.distance=8.5;
    const idle={moveX:0,moveY:0,run:false,takeJump:()=>false},wind={gust:0,dir:new THREE.Vector2(0,-1),velocity:new THREE.Vector3()};
    for(let i=0;i<90;i++){player.update(1/60,12,idle,follow.yaw,wind);follow.update(1/60,player);}
    camera.updateMatrixWorld(true);return {player,camera};
  };
  check('spawn shot executes the production 90-step player and camera preparation',()=>{
    const {player,camera}=replayShot(0,100,0,-.16,.02);
    assert.ok([...player.pos.toArray(),...camera.position.toArray(),...camera.matrixWorld.elements].every(Number.isFinite));
    assert.ok(Math.hypot(player.pos.x,player.pos.z-100)<.5,'spawn shot slides into a collider');
    return `player (${player.pos.toArray().map(x=>x.toFixed(2)).join(',')}), camera (${camera.position.toArray().map(x=>x.toFixed(2)).join(',')})`;
  });
  check('reframed glacier photo includes all three principal peak tips',()=>{
    const {camera}=replayShot(-420,-250,140,.54,-.16);
    for(const peak of P.GLACIAL_HORNS){const p=new THREE.Vector3(peak.x,H.heightAt(peak.x,peak.z)+.24,peak.z).project(camera);
      assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1,`peak outside shot (${p.toArray()})`);}
    return `eye (${camera.position.toArray().map(x=>x.toFixed(2)).join(',')})`;
  });
  const roots = [village.object, landmarks.object, city.object, abbey, terrain, water, grass, crops, life.object];
  const after = measure(roots, scatter, D.updateStructureDetails);
  scenes.visible = false; const withoutScenes = measure(roots, scatter, D.updateStructureDetails); scenes.visible = true;
  const metrics = { tier: ['low','medium','high'][detail], counts, views: after, geometryDelta: after.map((v,i) => ({name:v.name, calls:v.calls-withoutScenes[i].calls, triangles:v.triangles-withoutScenes[i].triangles})) };
  // The shared baseline helper counts InstancedMesh, but not custom instanced
  // geometry used by clouds/flags. Include its full primitive count separately.
  let sceneTriangles=0;
  scenes.traverse((o)=>{if(!o.isMesh)return;
    const instances=o.isInstancedMesh?o.count:o.geometry.isInstancedBufferGeometry?o.geometry.instanceCount:1;
    sceneTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*instances;
  });
  metrics.fullSceneTriangles=sceneTriangles;
  check('medium/low landscape stays within geometry submission budgets', () => {
    if(detail<2){assert.ok(meshCount(scenes)<=(detail===0?10:17));assert.ok(sceneTriangles<(detail===0?30_000:320_000));}
    return `${meshCount(scenes)} meshes, ${sceneTriangles.toLocaleString()} allocated triangles`;
  });
  if (process.env.SCENES_METRICS) writeFileSync(process.env.SCENES_METRICS, JSON.stringify(metrics, null, 2));
  console.log('METRICS ' + JSON.stringify(metrics));
  check('all non-bridge roads and both city gate thresholds remain reachable', () => {
    let maxGrade = 0;
    for (const r of L.ROADS) {
      if (r.bridge) continue;
      for (let i=1; i<r.pts.length; i++) {
        const a=r.pts[i-1], b=r.pts[i], len=Math.hypot(b[0]-a[0],b[1]-a[1]); if(len<.001)continue;
        maxGrade=Math.max(maxGrade, Math.abs(H.heightAt(...a)-H.heightAt(...b))/len);
        for(let d=0;d<len;d+=.4){const x=a[0]+(b[0]-a[0])*d/len,z=a[1]+(b[1]-a[1])*d/len;
          if(r.id==='lake-road'&&Math.hypot(x-L.PIER.x,z-L.PIER.z)<45)continue;
          const y=C.surfaceTop(x,z), p={x,z};C.resolveWalls(p,.32,y,y+1.7,.5);
          assert.ok(Math.hypot(p.x-x,p.z-z)<.06,`${r.id} blocked`);
        }
      }
    }
    assert.ok(maxGrade<1.25);
    for(const g of [L.SOUTH_GATE,L.EAST_GATE]){const y=H.heightAt(g.x,g.z),p={...g};C.resolveWalls(p,.32,y,y+1.7,.5);assert.ok(Math.hypot(p.x-g.x,p.z-g.z)<.05);}
    return `max grade=${maxGrade.toFixed(3)}`;
  });
  check('main JS remains below 3MB', () => {
    const files = readdirSync('dist/assets').filter((x) => x.endsWith('.js'));
    let max=0; for(const file of files)max=Math.max(max,readFileSync('dist/assets/'+file).length);
    assert.ok(max < 3_000_000); return `${max.toLocaleString()} bytes`;
  });
} finally { await server.close(); }
console.log(`${failures ? 'FAIL' : 'PASS'}: ${failures} failed scene checks`);
process.exitCode = failures ? 1 : 0;
