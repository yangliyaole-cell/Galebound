// Run with Vite on localhost:5173 and Playwright + a Chrome installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.HERO_TEST_URL || 'http://127.0.0.1:5173';
const output = path.resolve('art/hero');
const manifest = JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error' && !msg.text().includes('404'))errors.push(msg.text());});
  await page.goto(`${base}/tools/hero-preview.html`);
  await page.waitForFunction(()=>window.heroPreview?.ready,{timeout:60000});
  await page.evaluate(()=>document.querySelector('#pause').click());

  // Verify actual deformed vertices, rather than just checking that bones exist.
  const poses = await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {poseFor}=await import('/src/player/character.ts');
    const {applyPose}=await import('/src/player/rig.ts');
    const h=window.heroPreview, char=h.character;
    const meshes=[];
    char.root.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
    const v=new THREE.Vector3();
    const report=[];
    for(const motion of ['idle','walk','run','jump','fall','glide','land','swim']){
      let maxExtent=0, finite=true, maxBoneError=0;
      for(const phase of [0,.8,1.6,2.4,3.2,4.0,4.8,5.6]){
        applyPose(char.rig,poseFor(motion,phase,phase,0,0));
        char.rig.setCapeState?.(motion==='glide'?1:0,motion==='run'?.8:0,phase,4);
        char.root.updateMatrixWorld(true);
        const bones=[];
        char.root.traverse(o=>{if(o.isBone)bones.push(o)});
        for(const bone of bones){
          const expected=char.rig[bone.name].getWorldPosition(new THREE.Vector3());
          maxBoneError=Math.max(maxBoneError,bone.getWorldPosition(new THREE.Vector3()).distanceTo(expected));
        }
        for(const mesh of meshes){
          mesh.skeleton.update();
          const count=mesh.geometry.attributes.position.count;
          for(let i=0;i<count;i+=7){
            mesh.getVertexPosition(i,v);mesh.localToWorld(v);
            finite &&= [v.x,v.y,v.z].every(Number.isFinite);
            maxExtent=Math.max(maxExtent,Math.abs(v.x),Math.abs(v.y),Math.abs(v.z));
          }
        }
      }
      report.push({motion,finite,maxExtent,maxBoneError});
    }
    char.rig.setBlink(true);
    const eye=meshes.find(m=>m.morphTargetDictionary?.Blink!==undefined);
    const blinkClosed=eye.morphTargetInfluences[eye.morphTargetDictionary.Blink]===1;
    char.rig.setBlink(false);
    return {report,blinkClosed,stats:h.stats()};
  });
  assert.equal(poses.stats.skins,manifest.meshes,'Reference GLB must be loaded, not the fallback');
  const cape=await page.evaluate(()=>{
    const h=window.heroPreview,c=h.character,meshes=[];
    c.root.traverse(o=>{if(o.isMesh&&o.name.startsWith('Traveler_Cape'))meshes.push(o)});
    c.rig.setCapeState(1,.7,1.5,5);
    const opened=meshes.every(m=>m.morphTargetInfluences[m.morphTargetDictionary.Glide]===1);
    c.rig.setCapeState(0,0,0,0);
    const closed=meshes.every(m=>m.morphTargetInfluences[m.morphTargetDictionary.Glide]===0);
    return {panels:meshes.length,opened,closed,legacyHidden:!c.cloth.visible};
  });
  assert.deepEqual(cape,{panels:manifest.cape_objects.length,opened:true,closed:true,legacyHidden:true});
  assert.equal(cape.panels,1,'Flight cape must be a continuous garment');
  const transition=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {poseFor}=await import('/src/player/character.ts');
    const {applyPose,blendPose}=await import('/src/player/rig.ts');
    const c=window.heroPreview.character;
    const v=new THREE.Vector3();let finite=true,maxExtent=0;
    for(const amount of [.25,.5,.75]){
      const p=poseFor('idle',0,0,0,0);
      blendPose(p,poseFor('glide',0,0,0,0),amount);
      applyPose(c.rig,p);c.rig.setCapeState(amount,0,0,0);c.root.updateMatrixWorld(true);
      c.root.traverse(m=>{
        if(!m.isSkinnedMesh||!m.name.startsWith('Traveler_Cape'))return;
        m.skeleton.update();
        for(let i=0;i<m.geometry.attributes.position.count;i+=7){
          m.getVertexPosition(i,v);m.localToWorld(v);
          finite&&=[v.x,v.y,v.z].every(Number.isFinite);
          maxExtent=Math.max(maxExtent,Math.abs(v.x),Math.abs(v.y),Math.abs(v.z));
        }
      });
    }
    return {phases:3,finite,maxExtent};
  });
  assert(transition.finite&&transition.maxExtent<3,'Intermediate cape poses must remain finite and bounded');
  const maskToggle = await page.evaluate(()=>{
    const h=window.heroPreview;const masks=[];
    h.character.root.traverse(o=>{if(o.isMesh&&o.name.startsWith('Traveler_Mask'))masks.push(o)});
    h.character.rig.setMaskVisible(false);const hidden=masks.every(o=>!o.visible);
    h.character.rig.setMaskVisible(true);
    return masks.length===3&&hidden&&masks.every(o=>o.visible);
  });
  assert(maskToggle,'Mask, inlay and straps must toggle together');
  assert(poses.blinkClosed,'Blink morph must respond');
  for(const p of poses.report){assert(p.finite,`${p.motion}: nonfinite vertices`);assert(p.maxExtent<3,`${p.motion}: exploded skin`);assert(p.maxBoneError<.00001,`${p.motion}: pivot drift`)}

  // Deterministic snapshots exercise the real Character pose blending + cloth.
  for(const motion of ['idle','run','glide']){
    await page.evaluate(async(motion)=>{
      const THREE=await import('/node_modules/.vite/deps/three.js');
      const h=window.heroPreview;
      const state={motion,speed:motion==='run'?7.2:0,turn:0,dive:0,velocity:new THREE.Vector3(),wind:new THREE.Vector3(.2,0,-.35)};
      h.character.root.rotation.y=0;
      for(let i=0;i<150;i++)h.character.update(1/60,i/60,state,()=>0);
      h.character.rig.setBlink(false);
      h.controls.target.set(0,motion==='glide'?.6:.91,0);
      h.camera.position.set(motion==='glide'?2.8:2.5,motion==='glide'?2.5:1.9,4.5);
      h.controls.update();h.renderer.render(h.scene,h.camera);
      document.querySelector('#motion').value=motion;
    },motion);
    await page.waitForTimeout(50);
    await page.screenshot({path:path.join(output,`hero-${motion}.png`)});
  }
  await page.evaluate(()=>{
    const h=window.heroPreview;
    h.camera.position.set(0,1.65,-4.8);h.controls.target.set(0,.91,0);h.controls.update();
    const state={motion:'idle',speed:0,turn:0,dive:0,velocity:h.character.root.position.clone().set(0,0,0),wind:h.character.root.position.clone().set(.1,0,-.15)};
    for(let i=0;i<150;i++)h.character.update(1/60,i/60,state,()=>0);
    h.character.rig.setBlink(false);h.renderer.render(h.scene,h.camera);
  });
  await page.waitForTimeout(50);
  await page.screenshot({path:path.join(output,'hero-back.png')});

  // Test world integration with the actual player controller.
  await page.goto(`${base}/?autostart&q=low&dr=0&yaw=0&camyaw=0.4&campitch=0.05&dist=3.7&x=-50&z=75`);
  await page.waitForFunction(()=>window.__gale,{timeout:60000});
  const initial=await page.evaluate(()=>{
    const g=window.__gale;
    return {position:g.player.pos.toArray(),detailed:!!g.player.character.rig.setBlink,cape:!!g.player.character.rig.setCapeState,legacyHidden:!g.player.character.cloth.visible};
  });
  assert(initial.detailed&&initial.cape&&initial.legacyHidden,'Game must use the new cloak and hide the original strips');
  await page.keyboard.down('w');await page.waitForTimeout(700);await page.keyboard.up('w');
  const moved=await page.evaluate(()=>window.__gale.player.pos.toArray());
  assert(Math.hypot(moved[0]-initial.position[0],moved[2]-initial.position[2])>.1,'Controller must move the new character');
  await page.keyboard.press('Space');await page.waitForTimeout(150);
  const jump=await page.evaluate(()=>window.__gale.player.mode);
  assert.equal(jump,'air','Controller jump must work');
  await page.waitForTimeout(1300);
  await page.screenshot({path:path.join(output,'hero-in-game.png')});

  // A failed asset fetch must still leave a playable procedural character.
  await page.route('**/models/traveler.glb',route=>route.fulfill({status:404,body:'asset deliberately unavailable in fallback check'}));
  await page.goto(`${base}/?autostart&q=low&x=0&z=0`);
  await page.waitForFunction(()=>window.__gale,{timeout:60000});
  assert.equal(await page.evaluate(()=>!!window.__gale.player.character.rig.eyes),true,'Missing model must fall back');
  await page.unroute('**/models/traveler.glb');
  await page.goto(`${base}/?autostart&q=low&hero=classic`);
  await page.waitForFunction(()=>window.__gale,{timeout:60000});
  assert.equal(await page.evaluate(()=>!!window.__gale.player.character.rig.eyes),true,'Classic switch must work');
  assert.deepEqual(errors,[],'No runtime/shader errors');
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({...poses,maskToggle,cape,transition,world:{loaded:initial.detailed,cape:initial.cape,legacyHidden:initial.legacyHidden,movement:true,jump:true,missingAssetFallback:true,classicSwitch:true},errors},null,2));
  console.log(JSON.stringify({poses:poses.report.length,stats:poses.stats,world:'movement, jump, cloth, fallback and classic switch passed',errors}));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
