// Finds a walkable route between two points on the eroded landscape and prints
// it as road control points. Cost grows steeply with grade, so routes wind and
// switch back up hillsides instead of climbing straight.
//   node scripts/route-road.mjs x0 z0 x1 z1 [cell=8]
import { createServer } from 'vite';
const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : k.toString().startsWith('create') ? () => ({ addColorStop() {} }) : k === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) };
const [x0, z0, x1, z1] = process.argv.slice(2, 6).map(Number);
const cell = Number(process.argv[6] ?? 8);
const s = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const M = await s.ssrLoadModule('/src/world/gen/macro.ts');
  const Hy = await s.ssrLoadModule('/src/world/gen/hydro.ts');
  M.buildMacro();
  const pad = 500;
  const minX = Math.min(x0, x1) - pad, minZ = Math.min(z0, z1) - pad;
  const w = Math.ceil((Math.abs(x1 - x0) + pad * 2) / cell), h = Math.ceil((Math.abs(z1 - z0) + pad * 2) / cell);
  const height = new Float32Array(w * h), wet = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = minX + i * cell, z = minZ + j * cell;
    height[j * w + i] = M.macroHeight(x, z);
    const r = Hy.nearestRiver(x, z, 60);
    if (r.found && r.distance < r.width / 2 + 6) wet[j * w + i] = 1;
  }
  const at = (x, z) => Math.round((z - minZ) / cell) * w + Math.round((x - minX) / cell);
  const start = at(x0, z0), goal = at(x1, z1);
  const dirs = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if ((dx || dz) && Math.abs(dx) + Math.abs(dz) <= 3 && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) dirs.push([dx, dz]);
  const D = dirs.length, angle = dirs.map(([dx, dz]) => Math.atan2(dz, dx));
  // State: cell and the direction it was entered by, so turning can be charged.
  const cost = new Float64Array(w * h * D).fill(Infinity), back = new Int32Array(w * h * D).fill(-1);
  const heap = [];
  const push = (c, k) => { heap.push([k, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= k) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
  for (let d = 0; d < D; d++) { cost[start * D + d] = 0; push(start * D + d, 0); }
  let end = -1;
  while (heap.length) {
    const [k, state] = pop();
    if (k > cost[state]) continue;
    const c = Math.floor(state / D), din = state % D;
    if (c === goal) { end = state; break; }
    const ci = c % w, cj = (c - ci) / w;
    for (let d = 0; d < D; d++) {
      const [dx, dz] = dirs[d];
      const i = ci + dx, j = cj + dz;
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const q = j * w + i;
      if (wet[q] && q !== goal) continue;
      const run = Math.hypot(dx, dz) * cell, grade = Math.abs(height[q] - height[c]) / run;
      if (grade > 0.16) continue;
      // Gentle bends are free; a hairpin costs as much as 60 m of road.
      const turn = Math.abs(Math.atan2(Math.sin(angle[d] - angle[din]), Math.cos(angle[d] - angle[din])));
      const step = run * (1 + (grade / 0.08) ** 2) + (turn > 0.5 ? 8 + 52 * (turn / Math.PI) ** 2 : 0);
      const next = q * D + d;
      if (cost[state] + step < cost[next]) { cost[next] = cost[state] + step; back[next] = state; push(next, cost[next]); }
    }
  }
  const from = new Int32Array(w * h).fill(-1);
  if (end >= 0) for (let st = end; back[st] >= 0; st = back[st]) from[Math.floor(st / D)] = Math.floor(back[st] / D);
  if (from[goal] < 0) { console.log('no route'); process.exit(1); }
  const path = [];
  for (let c = goal; c >= 0 && c !== start; c = from[c]) path.push([minX + (c % w) * cell, minZ + Math.floor(c / w) * cell]);
  path.push([minX + (start % w) * cell, minZ + Math.floor(start / w) * cell]);
  path.reverse();
  // Keep a control point every ~40 m of path, and every turn.
  const out = [path[0]];
  let run = 0;
  for (let i = 1; i < path.length - 1; i++) {
    run += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const a = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]);
    const b = Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]);
    const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    if (run > 40 || (turn > 0.9 && run > 14)) { out.push(path[i]); run = 0; }
  }
  out.push(path[path.length - 1]);
  let length = 0, steepest = 0;
  for (let i = 1; i < path.length; i++) {
    const r = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    length += r;
    steepest = Math.max(steepest, Math.abs(M.macroHeight(...path[i]) - M.macroHeight(...path[i - 1])) / r);
  }
  console.log(`length ${length.toFixed(0)} m, steepest ${(steepest * 100).toFixed(0)}%, ${out.length} controls`);
  console.log(JSON.stringify(out.map(([x, z]) => [Math.round(x), Math.round(z)])));
} finally {
  await s.close();
}
