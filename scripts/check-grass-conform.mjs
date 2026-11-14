import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

/**
 * Measures how many grass / flower roots disagree with the terrain mesh by
 * more than 5 cm. The production sampler (R32F + triangle interpolation,
 * matching heightAt and the grass shader) must stay under 5%, ideally ~0.
 * The pre-fix model (half-float + uv = xz/SIZE+0.5 + bilinear) is reported
 * for comparison and is not a pass condition.
 */
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => {
  if (key in o) return o[key];
  if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
  if (key === 'getImageData') return (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
  return () => {};
}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  logLevel: 'error',
});

const L = await server.ssrLoadModule('/src/world/layout.ts');
const H = await server.ssrLoadModule('/src/world/heightmap.ts');
const hydro = await server.ssrLoadModule('/src/world/gen/hydro.ts');
H.buildHeightmap(4);
const texture = H.createHeightTexture();
const grass = (await server.ssrLoadModule('/src/world/grass.ts')).createGrass(24000, 36000, 6000, texture);
const { data, width, height } = texture.image;
const nn = width - 1;
const cellSize = L.SIZE / nn;
assert.equal(texture.type, THREE.FloatType);
assert.equal(width, L.SIZE / 4 + 1);
assert.equal(H.grid().n, L.SIZE / 4);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const atFloat = (i, j) => data[clamp(j, 0, height - 1) * width + clamp(i, 0, width - 1)];

/** Same triangle split as heightAt() / TERRAIN_HEIGHT_GLSL. */
function shaderHeight(x, z) {
  const gx = clamp((x + L.HALF) / cellSize, 0, nn - 1e-4);
  const gz = clamp((z + L.HALF) / cellSize, 0, nn - 1e-4);
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const a = atFloat(i, j);
  const b = atFloat(i + 1, j);
  const c = atFloat(i, j + 1);
  const d = atFloat(i + 1, j + 1);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

const half = new Uint16Array(H.grid().data.length);
for (let i = 0; i < H.grid().data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(H.grid().data[i]);
const atHalf = (i, j) => THREE.DataUtils.fromHalfFloat(half[clamp(j, 0, height - 1) * width + clamp(i, 0, width - 1)]);

/** Pre-fix shader: half-float texture, uv = xz/SIZE+0.5, hardware bilinear. */
function legacyHeight(x, z) {
  const u = x / L.SIZE + 0.5;
  const v = z / L.SIZE + 0.5;
  const gx = u * width - 0.5;
  const gz = v * height - 0.5;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  return (atHalf(ix, iz) * (1 - fx) + atHalf(ix + 1, iz) * fx) * (1 - fz)
    + (atHalf(ix, iz + 1) * (1 - fx) + atHalf(ix + 1, iz + 1) * fx) * fz;
}

const mod = (v, n) => ((v % n) + n) % n;
const TILES = [46, 170, 90];
const WIDTHS = [0.6, 1.6, 0];

const sites = [
  ['spawn', L.START.x, L.START.z],
  ['city', L.CITY.x, L.CITY.z],
  ['abbey', L.ABBEY.x, L.ABBEY.z],
  ['windmill', L.WINDMILL.x, L.WINDMILL.z],
  ['watchtower', L.WATCHTOWER.x, L.WATCHTOWER.z],
  ['lighthouse', L.LIGHTHOUSE.x, L.LIGHTHOUSE.z],
  ['plateau', L.PLATEAU.x, L.PLATEAU.z],
  ['river-mouth', 1430, 1650],
  ['nw-corner', -1900, -1900],
  ['ne-corner', 1900, -1900],
  ['sw-corner', -1900, 1900],
  ['se-corner', 1900, 1900],
  ['east-slope', 1400, -700],
  ['west-foothill', -1500, -400],
  ['scarp', -1300, -1250],
];
for (const lake of hydro.LAKES) sites.push([`lake-${lake.name}`, lake.x + lake.rx * 1.2, lake.z]);

function stats() {
  return { n: 0, over5: 0, over25: 0, over100: 0, max: 0, abs: [] };
}
function add(s, delta) {
  const a = Math.abs(delta);
  s.n++;
  if (a > 0.05) s.over5++;
  if (a > 0.25) s.over25++;
  if (a > 1) s.over100++;
  if (a > s.max) s.max = a;
  s.abs.push(a);
}
function p95(s) {
  if (!s.abs.length) return 0;
  const arr = s.abs.slice().sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))];
}
function fmt(s) {
  const pct = (c) => s.n ? (100 * c / s.n).toFixed(3) : 'n/a';
  return `n=${s.n}  >5cm=${pct(s.over5)}%  >25cm=${pct(s.over25)}%  >1m=${pct(s.over100)}%  p95=${p95(s).toFixed(3)}m  max=${s.max.toFixed(3)}m`;
}

const current = { roots: stats(), grass: stats(), feet: stats() };
const legacy = { roots: stats(), grass: stats(), feet: stats() };

for (const [name, px, pz] of sites) {
  const siteCurrent = stats();
  const siteLegacy = stats();
  const siteGrass = stats();
  for (let m = 0; m < grass.children.length; m++) {
    const cells = grass.children[m].geometry.attributes.aCell;
    const tile = TILES[m];
    const halfWidth = WIDTHS[m] * 0.5;
    for (let i = 0; i < cells.count; i++) {
      const x = px + mod(cells.getX(i) - px + tile / 2, tile) - tile / 2;
      const z = pz + mod(cells.getY(i) - pz + tile / 2, tile) - tile / 2;
      const mesh = H.heightAt(x, z);
      const now = shaderHeight(x, z);
      const old = legacyHeight(x, z);
      add(current.roots, now - mesh);
      add(legacy.roots, old - mesh);
      add(siteCurrent, now - mesh);
      add(siteLegacy, old - mesh);
      const allowed = mesh > 0.25 && mesh < 95;
      if (allowed) {
        add(current.grass, now - mesh);
        add(legacy.grass, old - mesh);
        add(siteGrass, now - mesh);
      }
      if (halfWidth > 0) {
        const ang = cells.getZ(i);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        for (const side of [-halfWidth, halfWidth]) {
          const fx = x + side * cs, fz = z + side * sn;
          const footMesh = H.heightAt(fx, fz);
          add(current.feet, shaderHeight(fx, fz) - footMesh);
          add(legacy.feet, legacyHeight(fx, fz) - footMesh);
        }
      }
    }
  }
  const grassPct = siteGrass.n ? (100 * siteGrass.over5 / siteGrass.n).toFixed(2) : 'n/a';
  const legPct = siteLegacy.n ? (100 * siteLegacy.over5 / siteLegacy.n).toFixed(2) : 'n/a';
  console.log(`${name.padEnd(16)}  now >5cm ${grassPct.padStart(7)}% (${siteGrass.over5}/${siteGrass.n})  legacy >5cm ${legPct.padStart(7)}%  max(now)=${siteCurrent.max.toFixed(4)}m`);
}

console.log('\nCURRENT shader (R32F + triangle interpolation)');
console.log('  all roots     ', fmt(current.roots));
console.log('  grass-range   ', fmt(current.grass));
console.log('  blade feet    ', fmt(current.feet));
console.log('\nLEGACY shader (half-float + uv=xz/SIZE+0.5 + bilinear)');
console.log('  all roots     ', fmt(legacy.roots));
console.log('  grass-range   ', fmt(legacy.grass));
console.log('  blade feet    ', fmt(legacy.feet));

const grassPct = current.grass.n ? current.grass.over5 / current.grass.n : 0;
assert.ok(current.grass.n > 1000, `too few grass-range samples: ${current.grass.n}`);
assert.ok(grassPct < 0.05, `grass-range |Δ|>5cm is ${(grassPct * 100).toFixed(3)}%, target <5%`);
assert.equal(current.grass.over25, 0, `${current.grass.over25} grass-range blades off by >25cm`);
assert.ok(current.feet.n === 0 || current.feet.over5 / current.feet.n < 0.05, 'per-vertex feet |Δ|>5cm exceeds 5%');

await server.close();
console.log(`\nPASS: grass-range |Δ|>5cm = ${(grassPct * 100).toFixed(3)}% (target <5%, ideally ~0)`);
