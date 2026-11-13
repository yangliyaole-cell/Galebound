import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

// Exercise the production capture boundary with a fake scheduler/context, no browser.
const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
const previousWindow=globalThis.window, previousDocument=globalThis.document;
const cleanups=[];
let failures=0;
const check=(name,fn)=>{try{fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}};
try {
  const {installShotCapture,observeShotDraws}=await server.ssrLoadModule('/src/world/scenes/shot-capture.ts');
  const setup=(search='?shot=1&q=high&style=cinematic&x=0&z=100')=>{
    const queue=[],events=new Map();let flushes=0,outputComplete=false;
    const native=cb=>(queue.push(cb),queue.length);
    const fake={location:{search},requestAnimationFrame:native,addEventListener:(name,fn)=>events.set(name,fn),__galeShotReady:false};
    globalThis.window=fake;globalThis.document={hidden:false};installShotCapture();
    cleanups.push(()=>events.get('error')?.({message:'test cleanup'}));
    const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());group.add(mesh);observeShotDraws(group);
    const renderer={getContext:()=>({isContextLost:()=>false,finish:()=>{assert.ok(outputComplete,'GPU flush preceded final compositor output');flushes++;}})};
    return {fake,native,events,queue,get flushes(){return flushes;},
      draw:()=>{outputComplete=false;mesh.onBeforeRender(renderer,group,new THREE.Camera(),mesh.geometry,mesh.material,null);outputComplete=true;},
      run:fn=>{fake.requestAnimationFrame(fn);queue.shift()(12_000);},
      cleanup:()=>events.get('error')?.({message:'test cleanup'})};
  };
  check('spawn high cinematic ready follows two full frozen output frames, never boot-only RAF',()=>{
    const s=setup();s.run(()=>{});assert.equal(s.fake.__galeShotReady,false);assert.equal(s.flushes,0);
    s.run(s.draw);assert.equal(s.fake.__galeShotReady,false);assert.equal(s.flushes,0);
    s.run(s.draw);assert.equal(s.fake.__galeShotReady,true);assert.equal(s.flushes,1);
    assert.equal(s.fake.__galeShotStatus.completedFrames,2);assert.equal(s.fake.requestAnimationFrame,s.native);
  });
  check('render exceptions become actionable __galeShotError and never ready',()=>{
    const s=setup();assert.throws(()=>s.run(()=>{s.draw();throw new Error('spawn frame failed');}),/spawn frame failed/);
    assert.match(s.fake.__galeShotError,/spawn frame failed/);assert.equal(s.fake.__galeShotReady,false);
  });
  check('optional 24-frame capture keeps the longer warmup for external comparison',()=>{
    const s=setup('?shot=1&shotwarmup=24');for(let i=0;i<23;i++){s.run(s.draw);assert.equal(s.fake.__galeShotReady,false);}
    s.run(s.draw);assert.equal(s.fake.__galeShotReady,true);assert.equal(s.fake.__galeShotStatus.completedFrames,24);
  });
  check('shader callback errors cannot be overwritten by successful frame completion',()=>{
    const s=setup();s.run(s.draw);s.run(()=>{s.draw();s.fake.__galeShotError='Shader compilation failed';});
    assert.equal(s.fake.__galeShotReady,false);assert.match(s.fake.__galeShotError,/Shader compilation failed/);
  });
  check('asset promise rejection and context loss report error instead of silent timeout',()=>{
    const a=setup();a.events.get('unhandledrejection')({reason:new Error('asset fetch failed')});assert.match(a.fake.__galeShotError,/asset fetch failed/);
    const b=setup();b.events.get('webglcontextlost')();assert.match(b.fake.__galeShotError,/context lost/);
  });
  check('normal autostart play retains the native RAF scheduler',()=>{
    const s=setup('?autostart=1&q=high');assert.equal(s.fake.requestAnimationFrame,s.native);assert.equal(s.fake.__galeShotStatus,undefined);
  });
}finally{for(const cleanup of cleanups)cleanup();globalThis.window=previousWindow;globalThis.document=previousDocument;await server.close();}
console.log(`${failures?'FAIL':'PASS'}: ${failures} failed shot checks`);process.exitCode=failures?1:0;
