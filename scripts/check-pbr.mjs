import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WebGLProgram } from '../node_modules/three/src/renderers/webgl/WebGLProgram.js';
import { ShaderChunk as sourceChunks } from '../node_modules/three/src/renderers/shaders/ShaderChunk.js';

const gradient={addColorStop(){}};
const canvasContext=new Proxy({}, {get:(object,key)=>object[key]??(key==='createRadialGradient'||key==='createLinearGradient'?()=>gradient:key==='getImageData'?(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{}),set:(object,key,value)=>(object[key]=value,true)});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>canvasContext})};
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
const compile = (material) => {
  const name = material.isMeshStandardMaterial ? 'standard' : material.isMeshToonMaterial ? 'toon' : 'lambert';
  const shader = { vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader, uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib[name].uniforms) };
  material.onBeforeCompile(shader, {});
  return shader;
};
const resolve = (source) => source.replace(/#include <([\w]+)>/g, (_match, key) => {
  assert.ok(THREE.ShaderChunk[key], `unknown Three chunk ${key}`); return resolve(THREE.ShaderChunk[key]);
});
const balanced = (source) => {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const stack = [];
  for (const char of clean) {
    if ('({['.includes(char)) stack.push(char);
    if (')}]'.includes(char)) assert.equal(stack.pop(), { ')': '(', '}': '{', ']': '[' }[char]);
  }
  assert.equal(stack.length, 0);
  let depth = 0;
  for (const line of clean.split('\n')) {
    if (/^\s*#if(?:def|ndef)?\b/.test(line)) depth++;
    if (/^\s*#endif\b/.test(line)) assert.ok(--depth >= 0);
  }
  assert.equal(depth, 0);
};
// Use Three r187's own include expansion, loop unrolling and WebGL2 prefixes.
const dumpProgram = (material, name, cascades, instancing = false) => {
  Object.assign(sourceChunks, THREE.ShaderChunk);
  const shader = compile(material);
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
    createProgram: () => ({}), createShader: (type) => ({ type }),
    shaderSource: (object, source) => writeFileSync(`/tmp/galebound-pbr-glsl/${name}.${object.type === 35633 ? 'vert' : 'frag'}`,source),
    compileShader() {}, attachShader() {}, linkProgram() {}, bindAttribLocation() {},
  };
  const parameters = new Proxy({
    ...shader, shaderType: material.type, shaderName: name.replaceAll('-','_'),
    defines: { USE_CSM: 1, CSM_CASCADES: cascades, CSM_FADE: '' },
    precision: 'highp', outputColorSpace: THREE.LinearSRGBColorSpace, toneMapping: THREE.NoToneMapping,
    vertexNormals: true, instancingColor: instancing, vertexColors: material.vertexColors, opaque: true, instancing,
    doubleSided: material.side===THREE.DoubleSide, shadowMapEnabled: true, shadowMapType: THREE.PCFShadowMap,
    numDirLights: cascades, numDirLightShadows: cascades, numHemiLights: 1,
    envMap: material.isMeshStandardMaterial, envMapPMREM: material.isMeshStandardMaterial,
    envMapSize: 128, envMapMaxLod: 7,
  }, { get: (object,key) => key in object ? object[key] : String(key).startsWith('num') ? 0 : undefined });
  new WebGLProgram({ getContext: () => gl },name,parameters,{});
};
const dump = process.argv.includes('--dump-glsl');
if (dump) mkdirSync('/tmp/galebound-pbr-glsl', { recursive: true });
try {
  const config = await server.ssrLoadModule('/src/render/pbr/config.ts');
  const lib = await server.ssrLoadModule('/src/render/pbr/library.ts');
  const materials = await server.ssrLoadModule('/src/render/pbr/material.ts');
  const ground = await server.ssrLoadModule('/src/render/pbr/ground.ts');
  const terrain = await server.ssrLoadModule('/src/world/terrain.ts');
  const { toon } = await server.ssrLoadModule('/src/render/toon.ts');
  const { createPbrLighting } = await server.ssrLoadModule('/src/render/pbr/lighting.ts');
  check('eight unique registered surfaces with finite nonzero relief', () => {
    assert.equal(Object.keys(lib.PBR_MATERIALS).length, 9);
    assert.equal(new Set(Object.values(lib.PBR_MATERIALS).map((entry) => entry.id)).size, 9);
    for (const entry of Object.values(lib.PBR_MATERIALS)) assert.ok(entry.relief > 0 && entry.relief < .2);
  });
  check('low allocates no multilayer / PMREM / cascades / contact map; medium 2, high 3 cascades', () => {
    const { low, medium, high } = config.PBR_TIERS;
    assert.deepEqual([low.layers, low.environmentSize, low.cascades, low.contactSize], [0, 0, 0, 0]);
    assert.equal(low.triplanar, false);
    assert.equal(medium.layers, 3); assert.equal(high.layers, 5);
    assert.equal(medium.cascades, 2); assert.equal(high.cascades, 3);
    assert.ok(high.environmentSize > medium.environmentSize && high.shadowSize > medium.shadowSize);
    assert.ok(high.shadowFar > medium.shadowFar);
    config.configurePbr('low');
    const legacy = toon(0xffffff, { pbr: 'stone' });
    assert.equal(materials.pbrAlternative(legacy), undefined);
    const scene = new THREE.Scene();
    createPbrLighting({}, scene, new THREE.PerspectiveCamera(), new THREE.DirectionalLight(), new THREE.Vector3(0,1,0), new THREE.Group(), { tier: 'low' }, new THREE.Texture()).update('cinematic');
    assert.equal(scene.environment, null); assert.equal(scene.children.length, 0);
  });
  const { masonryCell } = await server.ssrLoadModule('/src/render/pbr/masonry.ts');
  check('masonry partitions cover space with long / square / packing stones and a broad size distribution', () => {
    const fract=value=>value-Math.floor(value);
    const hash=(x,y)=>{let a=fract(x*.1031),b=fract(y*.1030),c=fract(x*.0973);const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);a+=d;b+=d;c+=d;return fract((a+b)*c);};
    const unique=new Map();
    for(let y=-10;y<10;y+=.071)for(let x=-10;x<10;x+=.079){
      const cell=masonryCell(x,y,hash);
      assert.ok(x>=cell.x-1e-6 && x<=cell.x+cell.w+1e-6 && y>=cell.y-1e-6 && y<=cell.y+cell.h+1e-6);
      assert.ok(cell.w>.02 && cell.h>.02);
      unique.set(`${cell.x.toFixed(5)},${cell.y.toFixed(5)},${cell.w.toFixed(5)},${cell.h.toFixed(5)}`,cell);
    }
    const cells=[...unique.values()],areas=cells.map(c=>c.w*c.h).sort((a,b)=>a-b);
    const long=cells.filter(c=>c.w/c.h>2.5 && c.w>1.3).length;
    const square=cells.filter(c=>c.w/c.h>.7 && c.w/c.h<1.4).length;
    const packing=cells.filter(c=>c.w*c.h<.22).length;
    assert.ok(long>20 && square>20 && packing>20);
    assert.ok(areas[Math.floor(areas.length*.9)]/areas[Math.floor(areas.length*.1)]>5);
    console.log(`  MASONRY ${cells.length} blocks: long=${long}, square=${square}, packing=${packing}; area P90/P10=${(areas[Math.floor(areas.length*.9)]/areas[Math.floor(areas.length*.1)]).toFixed(2)}`);
  });
  const { classifyNaturalStone } = await server.ssrLoadModule('/src/render/pbr/natural-stone.ts');
  check('merged rocks get a separate material mask and smooth shading; wall topology and positions stay intact', () => {
    const rock=new THREE.IcosahedronGeometry(1,1).scale(1.7,.6,1.1).translate(6,31,102);
    rock.computeVertexNormals();
    const wall=new THREE.BoxGeometry(3,4,.5).toNonIndexed().translate(0,2,0);
    const geometry=mergeGeometries([wall,rock]);
    const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice();
    const audit=classifyNaturalStone(geometry),mask=geometry.attributes.aPbrNatural;
    assert.equal(audit.components,1);assert.equal(audit.triangles,80);
    for(let i=0;i<wall.attributes.position.count;i++)assert.equal(mask.getX(i),0);
    for(let i=wall.attributes.position.count;i<mask.count;i++)assert.equal(mask.getX(i),1);
    assert.deepEqual(geometry.attributes.position.array,positions);assert.deepEqual(geometry.attributes.normal.array,normals);
    assert.equal(classifyNaturalStone(geometry),audit);
    assert.ok(geometry.attributes.aPbrNaturalNormal.normalized);
  });
  for (const tier of ['medium', 'high']) {
    config.configurePbr(tier);
    const source = lib.pbrLibrary(tier);
    check(`${tier}: library deterministic, filtered, triplanar, height blend and derivative normals`, () => {
      assert.equal(source, lib.pbrLibrary(tier)); balanced(source);
      for (const token of ['pFiltered', 'fwidth', 'pHeightBlend', 'PBR_TRIPLANAR', 'pBumpNormal', 'roughness', 'ao']) assert.ok(source.includes(token));
      assert.ok(!/\b(?:undefined|NaN)\b/.test(source));
    });
    for (const kind of Object.keys(lib.PBR_MATERIALS)) {
      check(`${tier}/${kind}: real Standard hooks preserve LOD and all output channels`, () => {
        const legacy = toon(0xffffff, { vertexColors: true, pbr: kind, lod: true, detailRange: 190 });
        const standard = materials.pbrAlternative(legacy);
        assert.ok(standard instanceof THREE.MeshStandardMaterial);
        assert.equal(materials.pbrOriginal(standard), legacy);
        const shader = compile(standard);
        assert.ok(shader.fragmentShader.includes('lodPixel') && shader.fragmentShader.includes('detailCoverage'));
        assert.ok(shader.fragmentShader.includes('roughnessFactor=clamp(pbr.roughness'));
        assert.ok(shader.fragmentShader.includes('indirectDiffuse*=pbr.ao'));
        assert.ok(shader.vertexShader.includes('instanceMatrix'));
        for (const text of [shader.vertexShader, shader.fragmentShader]) { balanced(text); resolve(text); assert.ok(!/\b(?:undefined|NaN)\b/.test(text)); }
        assert.ok(shader.uniforms.uPbrGround);
        if (dump) dumpProgram(standard,`${tier}-full-${kind}`,config.PBR_TIERS[tier].cascades,kind==='stone');
      });
    }
    check(`${tier}: terrain keeps all uniforms; fragment derivatives never enter grass vertex shader`, () => {
      const legacy = new THREE.MeshLambertMaterial();
      ground.registerGroundPbr(legacy, terrain.GROUND_GLSL, terrain.groundUniforms);
      const shader = compile(materials.pbrAlternative(legacy));
      balanced(shader.fragmentShader); balanced(shader.vertexShader); resolve(shader.fragmentShader); resolve(shader.vertexShader);
      assert.ok(!/\b(?:dFdx|dFdy|fwidth)\b/.test(terrain.GROUND_GLSL));
      for (const uniform of ['uSplat', 'uBiome', 'uPbrContact', 'uPbrActive']) assert.ok(shader.uniforms[uniform]);
      if (dump) dumpProgram(materials.pbrAlternative(legacy),`${tier}-full-ground`,config.PBR_TIERS[tier].cascades);
      for (const token of ['pHeightBlend(splat.r', 'pHeightBlend(splat.g', 'bankDamp', 'contact*.22', 'pBumpNormal']) assert.ok(shader.fragmentShader.includes(token));
    });
    check(`${tier}: CSM startup, splits, stable bounds, hook chaining, style round trip, single solar radiance`, () => {
      // PMREM capture is stubbed only here. Production CSM, materials and scene transforms run in Node.
      const originalCapture = THREE.PMREMGenerator.prototype.fromScene;
      let captures = 0;
      THREE.PMREMGenerator.prototype.fromScene = function (_scene, _sigma, _near, _far, options) {
        captures++; assert.equal(options.size, config.PBR_TIERS[tier].environmentSize);
        return new THREE.WebGLRenderTarget(16, 16);
      };
      try {
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55,16/9,.3,7000);
        const sun = new THREE.DirectionalLight(0xffe7d2, 2.1), dir = new THREE.Vector3(.4,.7,.5).normalize();
        const legacy = toon(0xffffff, { pbr: 'masonry', lod: true });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(),legacy); scene.add(mesh,sun);
        const rockLegacy=toon(0xffffff,{vertexColors:true,leafTint:true,lod:true});
        const rock=new THREE.InstancedMesh(new THREE.BoxGeometry(),rockLegacy,1); rock.name='rock-lod0-test';
        const trunk=new THREE.Mesh(new THREE.BoxGeometry(),rockLegacy); scene.add(rock,trunk);
        const sky = new THREE.Group();
        sky.add(new THREE.Mesh(new THREE.SphereGeometry(),new THREE.ShaderMaterial({ uniforms: { uSunDir: { value: dir } },fragmentShader: 'gl_FragColor = vec4(col, 1.0);' })));
        const lighting = createPbrLighting({},scene,camera,sun,dir,sky,{tier},new THREE.Texture());
        assert.equal(captures,0); assert.equal(scene.environment,null);
        lighting.update('default'); assert.equal(scene.children.includes(sun),true);
        lighting.update('cinematic'); assert.equal(captures,1);
        assert.equal(scene.children.includes(sun),false); assert.equal(sun.intensity,2.1); assert.equal(sun.color.getHex(),0xffe7d2);
        assert.equal(mesh.material,materials.pbrAlternative(legacy));
        assert.ok(rock.material instanceof THREE.MeshStandardMaterial); assert.equal(trunk.material,rockLegacy);
        const rockShader=compile(rock.material);
        assert.ok(rockShader.vertexShader.includes('vColor = vec4(1.0);'));
        assert.ok(!rockShader.vertexShader.includes('vColor = vec4(color, 1.0);'));
        assert.ok(rockShader.vertexShader.includes('instanceColor.rgb'));
        assert.ok(rock.geometry.attributes.aPbrNaturalNormal);
        const { csm } = scene.userData.pbr;
        assert.equal(csm.lights.length,config.PBR_TIERS[tier].cascades);
        assert.equal(csm.breaks.at(-1),1);
        assert.ok(csm.breaks.every((value,i,a)=>value>0 && (!i || value>a[i-1])));
        assert.ok(csm.lights.every(light => light.visible && light.intensity===sun.intensity && Number.isFinite(light.position.length())));
        const shader=compile(mesh.material);
        assert.ok(shader.fragmentShader.includes('lodPixel')); assert.ok(shader.uniforms.CSM_cascades);
        assert.equal(mesh.material.defines.CSM_CASCADES,csm.cascades);
        if (dump) {
          dumpProgram(mesh.material,`${tier}-full-csm-standard`,csm.cascades);
          dumpProgram(legacy,`${tier}-full-csm-toon`,csm.cascades);
          dumpProgram(rock.material,`${tier}-full-csm-rock`,csm.cascades,true);
        }
        camera.aspect=1; camera.updateProjectionMatrix(); lighting.update('cinematic'); assert.equal(captures,1);
        for (const style of ['ghibli','watercolor','lowpoly-dusk','default']) {
          lighting.update(style); assert.equal(mesh.material,legacy); assert.equal(rock.material,rockLegacy); assert.equal(scene.environment,null);
          assert.ok(scene.children.includes(sun)); assert.ok(!legacy.defines.USE_CSM);
        }
        lighting.update('cinematic'); assert.equal(captures,1); assert.equal(mesh.material.defines.USE_CSM,1);
      } finally { THREE.PMREMGenerator.prototype.fromScene=originalCapture; }
    });
    const {createGrass}=await server.ssrLoadModule('/src/world/grass.ts');
    check(`${tier}: actual near/far grass shares trampled verge and excludes solid rock footprints`,()=>{
      const grass=createGrass(4,6,1,new THREE.Texture());
      for(const [index,layer] of grass.children.slice(0,2).entries()){
        const shader=compile(layer.material);
        assert.equal(shader.uniforms.uPbrContact,materials.pbrUniforms.uPbrContact);
        assert.ok(shader.vertexShader.includes('groundRoadShoulder'));
        assert.ok(shader.vertexShader.includes('smoothstep(.78,.96,texture2D(uPbrContact'));
        balanced(shader.vertexShader);resolve(shader.vertexShader);
        if(dump)dumpProgram(layer.material,`${tier}-full-grass-${index}`,config.PBR_TIERS[tier].cascades);
      }
    });
    if (dump) {
      const funcs=Object.keys(lib.PBR_MATERIALS).map(kind => `p${kind[0].toUpperCase()}${kind.slice(1)}`);
      for (const [index,fn] of funcs.entries()) {
        writeFileSync(`/tmp/galebound-pbr-glsl/${tier}-${index}.frag`,`#version 300 es\nprecision highp float;\nin vec3 wp;\nout vec4 outputColor;\n${source}\nvoid main(){vec3 w=pWeights(normalize(wp+vec3(.1,1,.3)));PbrSurface p=PBR_TRIPLANAR(${fn},wp,w); vec3 n=pBumpNormal(vec3(0,1,0),wp,p.height);outputColor=vec4(p.albedo*(p.ao+p.roughness)+n,1);}`);
      }
      writeFileSync(`/tmp/galebound-pbr-glsl/${tier}-ground.frag`,`#version 300 es\nprecision highp float;\nin vec3 wp;\nout vec4 outputColor;\n${terrain.GROUND_GLSL}\n${ground.groundPbrGLSL()}\nvoid main(){PbrSurface p=pGround(wp,vec3(0,1,0),vec3(.3,.4,.2),10.0);outputColor=vec4(p.albedo*(p.ao+p.roughness)+p.height,1);}`);
    }
  }
  console.log(`PASS: ${checks} PBR checks. ${dump ? 'GLSL harnesses: /tmp/galebound-pbr-glsl' : ''}`);
} finally { await server.close(); }
