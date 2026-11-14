// Times each CPU-side stage of world construction, without a browser.
//   node scripts/boot-profile.mjs [low|medium|high]
import { createServer } from 'vite';
import * as THREE from 'three';

const tier = process.argv[2] ?? 'high';
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key.toString().startsWith('create') ? () => gradient
  : key === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
globalThis.location = { search: `?q=${tier}` };
globalThis.window = { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 };

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const times = {};
let mark = performance.now();
const lap = (name) => { const now = performance.now(); times[name] = Math.round(now - mark); mark = now; };
try {
  const Q = await server.ssrLoadModule('/src/core/quality.ts');
  const quality = Q.pickQuality();
  (await server.ssrLoadModule('/src/render/pbr/config.ts')).configurePbr(quality.tier);
  const H = await server.ssrLoadModule('/src/world/heightmap.ts');
  const M = await server.ssrLoadModule('/src/world/gen/macro.ts');
  const maps = await server.ssrLoadModule('/src/world/maps.ts');
  const LM = await server.ssrLoadModule('/src/world/landmaps.ts');
  const village = await server.ssrLoadModule('/src/world/structures/village.ts');
  const landmarks = await server.ssrLoadModule('/src/world/structures/landmarks.ts');
  const city = await server.ssrLoadModule('/src/world/structures/city.ts');
  const detailMod = await server.ssrLoadModule('/src/world/structure-detail.ts');
  lap('load modules');
  M.buildMacro();
  lap('macro erosion');
  H.buildHeightmap(quality.terrainCell);
  lap('fine heightmap');
  maps.buildSplat(quality.splatSize);
  maps.buildBiome();
  lap('splat + biome');
  LM.buildLandMaps(new THREE.Vector3(-0.74, 0.62, 0.12));
  lap('land maps');
  const detail = quality.tier === 'high' ? 2 : quality.tier === 'medium' ? 1 : 0;
  detailMod.setStructureDetail(detail);
  village.buildVillage(detail);
  lap('village');
  landmarks.buildLandmarks();
  lap('landmarks');
  city.buildCity(detail);
  lap('city');
  console.log(`tier ${quality.tier} (cell ${quality.terrainCell} m)`);
  let total = 0;
  for (const [name, ms] of Object.entries(times)) { total += ms; console.log(`${name.padEnd(16)} ${String(ms).padStart(6)} ms`); }
  console.log(`${'total'.padEnd(16)} ${String(total).padStart(6)} ms`);
} finally {
  await server.close();
}
