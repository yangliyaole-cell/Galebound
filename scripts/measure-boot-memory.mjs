// CPU allocations only: canvas painting and GPU work are stubbed. Run with --expose-gc.
import { createServer } from 'vite';
import * as THREE from 'three';
if (!global.gc) throw new Error('Run node --expose-gc scripts/measure-boot-memory.mjs [low|medium|high]');
const tier = process.argv[2] ?? 'medium';
const ios = process.argv.includes('--ios');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'MacIntel', maxTouchPoints: ios ? 5 : 0, userAgent: 'Macintosh' } });
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'getImageData'
  ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  : k.includes?.('Gradient') ? () => gradient : () => {}), set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
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
  const city = measure('city', () => modules.city.buildCity(detail));
  measure('abbey', () => modules.abbey.buildAbbey());
  measure('viaduct', () => modules.viaduct.buildViaduct());
  const renderer = { autoClear: true, getRenderTarget: () => null, getClearColor: c => c, getClearAlpha: () => 1, setRenderTarget() {}, setClearColor() {}, clear() {}, render() {} };
  measure('scatter+forest (no GPU)', () => modules.scatter.createScatter(q, sun, { renderer, sun: new THREE.DirectionalLight(), hemisphere: new THREE.HemisphereLight() }));
  measure('life', () => modules.life.createLife(village.info, city.info, detail === 0 ? 3 : 7));
  measure('crowd', () => modules.crowd.createCrowd(detail === 0 ? 120 : detail === 1 ? 260 : 450));
} finally { await server.close(); }
