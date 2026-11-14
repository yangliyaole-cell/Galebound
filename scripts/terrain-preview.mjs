// Renders the generated landscape to PNG so terrain work can be judged without a browser.
//   node scripts/terrain-preview.mjs [outDir] [--fine]
// Writes macro.png (the whole sixteen kilometres, hillshaded) and, with --fine,
// fine.png (the walkable four kilometres from the real collision grid).
import { createServer } from 'vite';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'artifacts/terrain';
const fine = process.argv.includes('--fine');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), sum = Buffer.alloc(4);
    len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ramp = [[-60, [38, 74, 120]], [-1, [70, 128, 170]], [0, [206, 196, 150]], [8, [120, 160, 82]], [70, [146, 176, 90]],
  [180, [150, 160, 100]], [420, [136, 126, 104]], [900, [128, 122, 118]], [1500, [214, 218, 226]], [2600, [255, 255, 255]]];
function tint(h) {
  for (let i = 1; i < ramp.length; i++) if (h <= ramp[i][0]) {
    const [a, ca] = ramp[i - 1], [b, cb] = ramp[i], t = Math.max(0, (h - a) / (b - a));
    return ca.map((v, k) => v + (cb[k] - v) * t);
  }
  return ramp[ramp.length - 1][1];
}
/** Hillshade a square height grid. `water(i, j)` may return true for open water. */
function shade(n, cell, at, scale, water) {
  const size = Math.floor((n - 1) * scale) + 1, rgb = Buffer.alloc(size * size * 3);
  const sample = (x, y) => {
    const gx = Math.min(n - 1.001, Math.max(0, x / scale)), gy = Math.min(n - 1.001, Math.max(0, y / scale));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = sample(x, y), step = cell / scale * 2;
    const nx = (sample(x - 1, y) - sample(x + 1, y)) / step, nz = (sample(x, y - 1) - sample(x, y + 1)) / step;
    const len = Math.hypot(nx, 1, nz);
    // Light from the north-west, as on a printed relief map.
    const light = Math.max(0, (-0.55 * nx + 0.62 - 0.55 * nz) / len);
    const wet = water?.(Math.min(n - 1, Math.round(x / scale)), Math.min(n - 1, Math.round(y / scale)));
    const c = wet ? [64, 132, 196] : tint(h);
    const k = wet ? 1 : 0.35 + 0.95 * light;
    for (let q = 0; q < 3; q++) rgb[(y * size + x) * 3 + q] = Math.max(0, Math.min(255, c[q] * k));
  }
  return png(size, size, rgb);
}

const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key.toString().startsWith('create') ? () => gradient
  : key === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const M = await server.ssrLoadModule('/src/world/gen/macro.ts');
  const Hy = await server.ssrLoadModule('/src/world/gen/hydro.ts');
  let t = performance.now();
  const macro = M.buildMacro();
  console.log(`macro: ${(performance.now() - t).toFixed(0)} ms`);
  const n = M.MACRO_N;
  let top = -Infinity; for (const v of macro.height) top = Math.max(top, v);
  console.log(`highest point ${top.toFixed(0)} m`);
  const wetMacro = (i, j) => macro.height[j * n + i] < 0 || macro.area[j * n + i] > 2.5e6;
  writeFileSync(join(out, 'macro.png'), shade(n, M.MACRO_CELL, (i, j) => macro.height[j * n + i], 2, wetMacro));
  // The walkable square and its surroundings, enlarged.
  const c0 = Math.round((M.MACRO_HALF - 3072) / M.MACRO_CELL), span = Math.round(6144 / M.MACRO_CELL) + 1;
  writeFileSync(join(out, 'macro-centre.png'), shade(span, M.MACRO_CELL, (i, j) => macro.height[(j + c0) * n + i + c0], 5,
    (i, j) => macro.height[(j + c0) * n + i + c0] < 0 || macro.area[(j + c0) * n + i + c0] > 1.2e6));
  for (const river of Hy.RIVERS) {
    const line = [];
    for (let i = 0; i < river.pts.length; i += Math.ceil(river.pts.length / 14)) {
      const p = river.pts[i];
      line.push(`${p.level.toFixed(0)}/${M.macroHeight(p.x + p.dz * 150, p.z - p.dx * 150).toFixed(0)}`);
    }
    console.log(river.name.padEnd(11), 'level/land 150 m aside:', line.join(' '));
  }
  if (fine) {
    const H = await server.ssrLoadModule('/src/world/heightmap.ts');
    const L = await server.ssrLoadModule('/src/world/layout.ts');
    t = performance.now();
    H.buildHeightmap(4);
    console.log(`fine grid: ${(performance.now() - t).toFixed(0)} ms`);
    const g = H.grid(), row = g.n + 1;
    const wet = (i, j) => Hy.waterSurfaceAt(i * g.cell - L.HALF, j * g.cell - L.HALF, g.data[j * row + i]) > g.data[j * row + i];
    writeFileSync(join(out, 'fine.png'), shade(row, g.cell, (i, j) => g.data[j * row + i], 1, wet));
    for (const [name, p] of Object.entries({ START: L.START, VILLAGE: L.VILLAGE, CITY: L.CITY, ABBEY: L.ABBEY, WINDMILL: L.WINDMILL, LAKE: L.LAKE, LIGHTHOUSE: L.LIGHTHOUSE, WATCHTOWER: L.WATCHTOWER, STONES: L.STONES, FOREST: L.FOREST }))
      console.log(name.padEnd(11), H.heightAt(p.x, p.z).toFixed(1));
  }
} finally {
  await server.close();
}
