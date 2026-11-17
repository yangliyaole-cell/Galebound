// CPU allocations only: canvas painting and GPU work are stubbed. Run with --expose-gc.
import { createServer } from 'vite';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, join } from 'node:path';
if (!global.gc) throw new Error('Run node --expose-gc scripts/measure-boot-memory.mjs [low|medium|high]');
const tier = process.argv[2] ?? 'medium';
const ios = process.argv.includes('--ios');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'MacIntel', maxTouchPoints: ios ? 5 : 0, userAgent: 'Macintosh' } });
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'getImageData'
  ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  : k.includes?.('Gradient') ? () => gradient : () => {}), set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const checkpoint = process.argv.includes('--checkpoint');
const server = await createServer({ plugins: [{
  name: 'boot-memory-instrumentation', enforce: 'pre',
  load(id) {
    if (!checkpoint || !id.startsWith(process.cwd() + '/src/') || !id.endsWith('.ts')) return;
    if (!process.env.GALE_MEMORY_REFERENCE) throw new Error('--checkpoint needs GALE_MEMORY_REFERENCE (an exported source snapshot)');
    return readFileSync(join(process.env.GALE_MEMORY_REFERENCE, relative(process.cwd(), id)), 'utf8');
  },
  transform(code, id) {
    if (id.endsWith('/src/world/structures/city.ts')) return code.replace(
      'cityBuildTimes[stage] = Math.round(now - mark);',
      'cityBuildTimes[stage] = Math.round(now - mark); globalThis.__galeMemoryStage?.(stage);');
  },
}], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const held = [];
const mb = x => +(x / 1048576).toFixed(1);
const snapshot = () => { const m = process.memoryUsage(); return { heap: mb(m.heapUsed), arrays: mb(m.arrayBuffers), rss: mb(m.rss) }; };
try {
  const modules = {};
  for (const [key, path] of Object.entries({ quality: 'core/quality', detail: 'world/structure-detail', height: 'world/heightmap', maps: 'world/maps', land: 'world/landmaps', terrain: 'world/terrain', grass: 'world/grass', village: 'world/structures/village', landmarks: 'world/structures/landmarks', city: 'world/structures/city', abbey: 'world/structures/abbey', viaduct: 'world/structures/viaduct', scatter: 'world/scatter', life: 'world/life', crowd: 'world/crowd' })) modules[key] = await server.ssrLoadModule(`/src/${path}.ts`);
  const q = ios ? modules.quality.mobileCap(modules.quality.TIERS[tier]) : modules.quality.TIERS[tier], detail = q.tier === 'high' ? 2 : q.tier === 'medium' ? 1 : 0;
  modules.detail.setStructureDetail(detail);
  const measure = (name, fn) => {
    global.gc(); const before = snapshot(), start = performance.now();
    const result = fn(); held.push(result);
    const end = snapshot(); global.gc(); const retained = snapshot();
    console.log(JSON.stringify({ name, ms: Math.round(performance.now() - start), before, end, retained }));
    return result;
  };
  measure('heightmap', () => modules.height.buildHeightmap(q.terrainCell));
  const texture = modules.height.createHeightTexture(), sun = new THREE.Vector3(.42, .72, .55).normalize();
  measure('splat', () => modules.maps.buildSplat(q.splatSize));
  measure('fields', () => modules.maps.buildFields(Math.min(2048, q.splatSize)));
  const land = measure('landmaps', () => modules.land.buildLandMaps(sun));
  measure('terrain', () => modules.terrain.createTerrain(texture, land, q.terrainSplit));
  measure('grass', () => modules.grass.createGrass(q.grassNear, q.grassFar, q.flowers, texture));
  const village = measure('village', () => modules.village.buildVillage(detail));
  measure('landmarks', () => modules.landmarks.buildLandmarks());
  global.gc();
  const cityBefore = snapshot(), cityStart = performance.now();
  let peak = { ...cityBefore }, phase = 'start';
  const sampleCity = () => {
    const value = snapshot();
    for (const key of Object.keys(value)) peak[key] = Math.max(peak[key], value[key]);
    return value;
  };
  // End-of-function snapshots miss allocations inside mergeGeometries. Observe large typed
  // allocations (including slice/species and attribute.array.constructor) during city build.
  const restores = [];
  for (const name of ['Float32Array', 'Float64Array', 'Uint32Array', 'Uint16Array', 'Uint8Array', 'Int32Array']) {
    const original = globalThis[name];
    const wrapped = new Proxy(original, { construct(target, args) {
      const array = Reflect.construct(target, args);
      if (array.byteLength >= 1048576) sampleCity();
      return array;
    } });
    original.prototype.constructor = wrapped; globalThis[name] = wrapped;
    restores.push(() => { original.prototype.constructor = original; globalThis[name] = original; });
  }
  globalThis.__galeMemoryStage = stage => {
    phase = stage;
    console.log(JSON.stringify({ name: `city:${stage}`, sample: sampleCity() }));
  };
  const city = process.argv.includes('--sync') ? modules.city.buildCity(detail)
    : await modules.city.buildCityAsync(detail, async () => { sampleCity(); await new Promise(resolve => setImmediate(resolve)); });
  for (const restore of restores) restore();
  held.push(city);
  const cityEnd = sampleCity(); global.gc(); await new Promise(resolve => setImmediate(resolve)); global.gc();
  console.log(JSON.stringify({ name: 'city', mode: process.argv.includes('--sync') ? 'sync' : 'async', checkpoint,
    ms: Math.round(performance.now() - cityStart), before: cityBefore, end: cityEnd, retained: snapshot(), peak, phase }));
  delete globalThis.__galeMemoryStage;
  if (process.argv.includes('--geometry')) {
    const geometry = [];
    city.object.traverse(mesh => {
      if (!mesh.isMesh || (!mesh.name.startsWith('structure-') && mesh.name !== 'Settlement merged relief')) return;
      const g = mesh.geometry, corners = g.index?.count ?? g.attributes.position.count;
      const hash = createHash('sha256'), block = new Float32Array(4096 * 3);
      for (const name of ['position', 'normal', 'color']) {
        const attribute = g.attributes[name];
        for (let from = 0; from < corners; from += 4096) {
          const length = Math.min(4096, corners - from);
          for (let i = 0; i < length; i++) {
            const v = g.index ? g.index.getX(from + i) : from + i;
            block[i * 3] = attribute.getX(v); block[i * 3 + 1] = attribute.getY(v); block[i * 3 + 2] = attribute.getZ(v);
          }
          hash.update(Buffer.from(block.buffer, 0, length * 12));
        }
      }
      geometry.push({ name: mesh.userData.structureDetail ? 'relief' : mesh.name, corners, hash: hash.digest('hex'),
        bytes: [...Object.values(g.attributes), g.index].filter(Boolean).reduce((sum, a) => sum + (a.cpuBytes ?? a.array.byteLength), 0) });
    });
    console.log(JSON.stringify({ name: 'city-geometry', meshes: geometry.sort((a, b) => (a.name + a.hash).localeCompare(b.name + b.hash)) }));
  }
  measure('abbey', () => modules.abbey.buildAbbey());
  measure('viaduct', () => modules.viaduct.buildViaduct());
  const renderer = { autoClear: true, getRenderTarget: () => null, getClearColor: c => c, getClearAlpha: () => 1, setRenderTarget() {}, setClearColor() {}, clear() {}, render() {} };
  measure('scatter+forest (no GPU)', () => modules.scatter.createScatter(q, sun, { renderer, sun: new THREE.DirectionalLight(), hemisphere: new THREE.HemisphereLight() }));
  measure('life', () => modules.life.createLife(village.info, city.info, detail === 0 ? 3 : 7));
  measure('crowd', () => modules.crowd.createCrowd(detail === 0 ? 120 : detail === 1 ? 260 : 450));
  global.gc(); await new Promise(resolve => setImmediate(resolve)); global.gc();
  console.log(JSON.stringify({ name: 'complete', retained: snapshot() }));
} finally { await server.close(); }
