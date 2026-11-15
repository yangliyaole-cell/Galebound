// Renders one rectangle of the walkable land to a hillshaded PNG with contours,
// rivers and roads, and prints a table of heights. For planning earthworks.
//   node scripts/region-preview.mjs x0 z0 x1 z1 [out.png] [--scale 1] [--table 100] [--cell 4]
import { createServer } from 'vite';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : Number(args[i + 1]); };
const [x0, z0, x1, z1] = args.slice(0, 4).map(Number);
const out = args[4] && !args[4].startsWith('--') ? args[4] : 'artifacts/terrain/region.png';
const scale = flag('scale', 1), table = flag('table', 0), cell = flag('cell', 4);
mkdirSync(dirname(out), { recursive: true });

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

const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key.toString().startsWith('create') ? () => gradient
  : key === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const H = await server.ssrLoadModule('/src/world/heightmap.ts');
  const L = await server.ssrLoadModule('/src/world/layout.ts');
  const Hy = await server.ssrLoadModule('/src/world/gen/hydro.ts');
  H.buildHeightmap(cell);
  const w = Math.round((x1 - x0) * scale), h = Math.round((z1 - z0) * scale), rgb = Buffer.alloc(w * h * 3);
  const at = (px, pz) => H.heightAt(x0 + px / scale, z0 + pz / scale);
  let lo = Infinity, hi = -Infinity;
  const heights = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = heights[j * w + i] = at(i, j); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const get = (i, j) => heights[Math.max(0, Math.min(h - 1, j)) * w + Math.max(0, Math.min(w - 1, i))];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = get(i, j), step = 2 / scale;
    const nx = (get(i - 1, j) - get(i + 1, j)) / step, nz = (get(i, j - 1) - get(i, j + 1)) / step;
    const light = Math.max(0, (-0.55 * nx + 0.62 - 0.55 * nz) / Math.hypot(nx, 1, nz));
    const t = (v - lo) / Math.max(1, hi - lo);
    let c = [90 + 120 * t, 150 + 60 * t - 70 * t * t, 80 + 100 * t * t].map((q) => q * (0.4 + 0.9 * light));
    // Contours every 10 m, heavier every 50 m.
    const band = (m) => Math.floor(v / m) !== Math.floor(get(i + 1, j) / m) || Math.floor(v / m) !== Math.floor(get(i, j + 1) / m);
    if (band(50)) c = [40, 30, 20]; else if (band(10)) c = c.map((q) => q * 0.72);
    const wx = x0 + i / scale, wz = z0 + j / scale;
    if (Hy.waterSurfaceAt(wx, wz, v) > v) c = [70, 140, 210];
    const r = Hy.nearestRiver(wx, wz, 40);
    if (r.found && r.fall && r.distance < r.width / 2) c = [235, 245, 255];
    if (L.roadClearance(wx, wz) < 0) c = [200, 150, 90];
    // 100 m grid.
    if (Math.abs(wx / 100 - Math.round(wx / 100)) * 100 < 0.5 / scale || Math.abs(wz / 100 - Math.round(wz / 100)) * 100 < 0.5 / scale) c = c.map((q) => q * 0.8 + 30);
    for (let q = 0; q < 3; q++) rgb[(j * w + i) * 3 + q] = Math.max(0, Math.min(255, c[q]));
  }
  writeFileSync(out, png(w, h, rgb));
  console.log(`${out}: ${w}x${h}, heights ${lo.toFixed(0)}..${hi.toFixed(0)} m; abbey floor ${L.ABBEY.floor}`);
  if (table) {
    let head = 'z\\x'.padStart(7);
    for (let x = x0; x <= x1; x += table) head += String(x).padStart(6);
    console.log(head);
    for (let z = z0; z <= z1; z += table) {
      let line = String(z).padStart(7);
      for (let x = x0; x <= x1; x += table) line += H.heightAt(x, z).toFixed(0).padStart(6);
      console.log(line);
    }
  }
} finally {
  await server.close();
}
