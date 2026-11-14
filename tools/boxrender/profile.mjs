#!/usr/bin/env node
// Which parts of a frame cost the most CPU time on SwiftShader?  Toggles one thing at a time on a warmed page.
// node tools/boxrender/profile.mjs --repo . --tier high --size 1600x900 --view spawn --reps 2
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild } from './lib/build.mjs';
import { serveDir } from './lib/serve.mjs';
import { openGame, chromeArgs } from './lib/page.mjs';
import { resolveView } from './lib/views.mjs';
import { parseArgs, wh } from './lib/args.mjs';
import { defaultRepo, defaultOutDir } from './lib/paths.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const { o: a } = parseArgs(process.argv.slice(2), { repo: 1, tier: 1, size: 1, view: 1, reps: 1, out: 1, style: 1 });
const repo = resolve(a.repo ?? defaultRepo(here)), tier = a.tier ?? 'high', size = wh(a.size ?? '1600x900'), reps = Number(a.reps ?? 2);
const out = resolve(a.out ?? join(defaultOutDir(here), `profile-${tier}.json`));
mkdirSync(dirname(out), { recursive: true });
const b = ensureBuild(repo), srv = await serveDir(b.dist);
const g = await openGame({ dist: b.dist, port: srv.port, tier, style: a.style ?? 'cinematic', size, gate: true, args: chromeArgs(), log: (m) => console.error(m) });
const { page } = g;
const view = resolveView(a.view ?? 'spawn', repo, {});
if (!view.native) await page.evaluate((v) => { window.__gale.reviewView(v.eye, v.target, v.fov); }, view);
const warmStep = async () => { await page.evaluate(() => window.__boxStep(1)); };
const step = async (n = reps) => { const t = await page.evaluate((k) => window.__boxStep(k), n); return t.reduce((x, y) => x + y, 0) / t.length; };
console.error('warm 1 (first frame: shader compile, PMREM, shadow maps) ...');
const first = await step(1);
const base = await step();
const rows = [{ what: 'first frame (one-time work included)', ms: Math.round(first) }, { what: 'steady frame, everything on', ms: Math.round(base) }];
const info = await page.evaluate(() => {
  const g = window.__gale, kids = g.scene.children.map((c, i) => {
    let tris = 0, meshes = 0, inst = 0;
    c.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { meshes++; const gm = o.geometry; const n = gm.index ? gm.index.count / 3 : (gm.attributes.position?.count ?? 0) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); if (o.isInstancedMesh) inst += o.count; } });
    return { i, name: c.name || c.type, meshes, tris: Math.round(tris), inst };
  });
  return { kids, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles, shadowCasters: 0 };
});
// 1) each top-level scene child hidden
const interesting = info.kids.filter((k) => k.meshes && (k.tris > 100000 || /^(Land|Water|Grass|Waterfalls|scatter)/.test(k.name)));
for (const k of interesting) {
  await page.evaluate((i) => { window.__gale.scene.children[i].visible = false; }, k.i);
  await warmStep();
  const ms = await step();
  await page.evaluate((i) => { window.__gale.scene.children[i].visible = true; }, k.i);
  rows.push({ what: `hide "${k.name}" (${k.meshes} meshes, ${k.tris} tris, ${k.inst} instances)`, ms: Math.round(ms), saved: Math.round(base - ms) });
  console.error(rows.at(-1).what, rows.at(-1).ms);
}
// 2) shadows: re-render of the shadow maps skipped (maps from the previous frame are reused)
await page.evaluate(() => { const r = window.__gale.renderer; r.shadowMap.autoUpdate = false; });
await warmStep();
let ms = await step(); rows.push({ what: 'shadow maps NOT re-rendered (autoUpdate=false)', ms: Math.round(ms), saved: Math.round(base - ms) });
await page.evaluate(() => { const r = window.__gale.renderer; r.shadowMap.autoUpdate = true; r.shadowMap.needsUpdate = true; });
// 3) shadows disabled outright for casting objects
await page.evaluate(() => { const g = window.__gale; g.scene.traverse((o) => { if (o.castShadow) { o.userData.__cs = true; o.castShadow = false; } }); g.scene.traverse((o) => { if (o.isLight && o.castShadow) { o.userData.__lcs = true; o.castShadow = false; } }); });
await warmStep(); ms = await step(); rows.push({ what: 'no object casts shadows (shadow pass empty)', ms: Math.round(ms), saved: Math.round(base - ms) });
await page.evaluate(() => { const g = window.__gale; g.scene.traverse((o) => { if (o.userData.__cs) o.castShadow = true; if (o.userData.__lcs) o.castShadow = true; }); });
// 4) post pipeline: skip it, draw the scene straight to the canvas
await page.evaluate(() => { const g = window.__gale, cam = g.follow.camera; window.__boxRaw = () => g.renderer.render(g.scene, cam); });
await page.evaluate(() => { const g = window.__gale; g.renderer.render(g.scene, g.follow.camera); });
const rawMs = await page.evaluate((n) => { const g = window.__gale, px = new Uint8Array(4), gl = g.renderer.getContext(), out = []; for (let i = 0; i < n; i++) { const t = performance.now(); window.__boxRaw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t); } return out.reduce((x, y) => x + y) / n; }, reps);
rows.push({ what: 'scene only: renderer.render straight to canvas (no MSAA target, no look/bloom/AO pass; shadows still on)', ms: Math.round(rawMs), saved: Math.round(base - rawMs) });
// 5) resolution scaling: same frame at 50% pixels
await page.setViewportSize({ width: Math.round(size[0] / 2), height: Math.round(size[1] / 2) });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await warmStep(); ms = await step(); rows.push({ what: `steady frame at ${Math.round(size[0] / 2)}x${Math.round(size[1] / 2)} (25% of the pixels)`, ms: Math.round(ms), saved: Math.round(base - ms) });
const res = { tier, size, view: view.name, commit: b.short, reps, rows, kids: info.kids };
writeFileSync(out, JSON.stringify(res, null, 2));
console.log(rows.map((r) => `${String(r.ms ?? '').padStart(7)} ms  ${r.saved !== undefined ? String((r.saved >= 0 ? '-' : '+') + Math.abs(r.saved)).padStart(7) : '       '}  ${r.what}`).join('\n'));
await g.browser.close(); await srv.close();
