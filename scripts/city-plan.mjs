#!/usr/bin/env node
// Top-down plan of Hightown: hill shading, streets, squares, wall and every house plot.
// Usage: node scripts/city-plan.mjs [out.svg] [--radius 470] [--high]
// Prints why plots were refused (city-parcels.ts parcelRejects) and the city build stage timings.
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const out = args.find((a) => a.endsWith('.svg')) ?? 'artifacts/city-plan.svg';
const R = Number(args[args.indexOf('--radius') + 1]) || 470;
const detail = args.includes('--high') ? 2 : 1;
// Canvas painting is not needed for the plan; stub it as check-layout does.
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : key.startsWith('create') ? () => gradient
  : key === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const L = await server.ssrLoadModule('/src/world/layout.ts');
  const H = await server.ssrLoadModule('/src/world/heightmap.ts');
  (await server.ssrLoadModule('/src/world/structure-detail.ts')).setStructureDetail(detail);
  H.buildHeightmap(4);
  const { buildCity, cityBuildTimes } = await server.ssrLoadModule('/src/world/structures/city.ts');
  const city = buildCity(detail);
  const { builtHouses } = await server.ssrLoadModule('/src/world/structures/house.ts');
  const { parcelRejects } = await server.ssrLoadModule('/src/world/structures/city-parcels.ts');
  const { x: cx, z: cz } = L.CITY, step = 6;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - R} ${cz - R} ${2 * R} ${2 * R}" width="1400" height="1400">`];
  let lo = Infinity, hi = -Infinity; const cells = [];
  for (let z = cz - R; z < cz + R; z += step) for (let x = cx - R; x < cx + R; x += step) {
    const h = H.heightAt(x + step / 2, z + step / 2); cells.push([x, z, h]); lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  for (const [x, z, h] of cells) {
    const t = (h - lo) / (hi - lo), band = Math.floor(h / 3.5) % 2 ? 0.92 : 1;
    svg.push(`<rect x="${x}" y="${z}" width="${step + 0.1}" height="${step + 0.1}" fill="rgb(${Math.round((90 + 150 * t) * band)},${Math.round((110 + 130 * t) * band)},${Math.round((80 + 140 * t) * band)})"/>`);
  }
  for (const r of L.ROADS) for (let i = 0; i < r.pts.length - 1; i++) {
    svg.push(`<path d="M${r.pts[i].join(' ')}L${r.pts[i + 1].join(' ')}" stroke="${r.kind === 'dirt' ? '#e8c397' : r.stairs ? '#e0d2b0' : '#fff6dc'}" stroke-width="${r.widths[i]}" stroke-linecap="round" fill="none"/>`);
  }
  for (const q of L.CITY_SQUARES) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2; let a0 = 0, a1 = 80;
      for (let k = 0; k < 20; k++) { const m = (a0 + a1) / 2; if (L.squareDistance(q, q.x + Math.cos(a) * m, q.z + Math.sin(a) * m) < 0) a0 = m; else a1 = m; }
      pts.push([q.x + Math.cos(a) * a0, q.z + Math.sin(a) * a0]);
    }
    svg.push(`<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="#efe6cf" stroke="#06c" stroke-width="0.8"/><text x="${q.x}" y="${q.z}" font-size="7" text-anchor="middle">${q.id}</text>`);
  }
  svg.push(`<polygon points="${L.cityWallPolygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#333" stroke-width="3.8"/>`);
  for (const { spec: h } of builtHouses) {
    const fill = h.shop ? '#d9773a' : h.tower ? '#7a4a8a' : h.arcade ? '#c9a24a' : '#b7603c';
    svg.push(`<rect x="${h.x - h.w / 2}" y="${h.z - h.d / 2}" width="${h.w}" height="${h.d}" fill="${fill}" stroke="#5a2a18" stroke-width="0.3" transform="rotate(${-h.rot * 180 / Math.PI} ${h.x} ${h.z})"/>`);
  }
  svg.push(`<text x="${cx - R + 6}" y="${cz + R - 8}" font-size="12">ground ${lo.toFixed(0)}–${hi.toFixed(0)} m · ${city.info.houseCount} houses · orange: shop, gold: arcade, violet: tower house</text></svg>`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg.join('\n'));
  console.log(`Plan: ${out}`);
  console.log('Refused plots:', JSON.stringify(parcelRejects));
  console.log('City build (ms):', JSON.stringify(cityBuildTimes));
} finally { await server.close(); }
