#!/usr/bin/env node
// One shot in one fresh browser. Normally launched by shot.mjs (which adds the memory guard).
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureBuild } from './lib/build.mjs';
import { serveDir } from './lib/serve.mjs';
import { openGame, chromeArgs, TILE_HOOK } from './lib/page.mjs';
import { resolveView } from './lib/views.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const opt = JSON.parse(process.argv[2]);
const TIER_CAP = { low: 1, medium: 1.5, high: 2 };
const t00 = Date.now();
const lap = (m) => console.error(`[${((Date.now() - t00) / 1000).toFixed(1)}s] ${m}`);

const [FW, FH] = opt.size;
const cap = TIER_CAP[opt.tier];
const preview = opt.mode === 'preview';
// final: the renderer's pixel ratio is min(devicePixelRatio, tier cap). preview: same CSS layout, fewer device pixels.
const ratio = preview ? opt.previewScale : Math.min(opt.dpr, cap);
const outW = Math.round(FW * ratio), outH = Math.round(FH * ratio);

// ---- tile plan (CSS px). Boundaries are multiples of 2 css px so x*ratio is an integer for ratio in {0.5,1,1.5,2}.
function plan() {
  let [cols, rows] = opt.tile === 'auto' ? [1, 1] : opt.tile.split('x').map(Number);
  if (opt.tile === 'auto') {
    const mpx = (w, h) => (w * h * ratio * ratio) / 1e6;
    while (mpx(Math.ceil(FW / cols) + 2 * opt.pad, Math.ceil(FH / rows) + 2 * opt.pad) > opt.maxTileMpx && cols * rows < 64) { if (FW / cols >= FH / rows) cols++; else rows++; }
  }
  if (preview) { cols = rows = 1; }
  const even = (v) => Math.round(v / 2) * 2;
  const xs = Array.from({ length: cols + 1 }, (_, i) => (i === cols ? FW : even((FW * i) / cols)));
  const ys = Array.from({ length: rows + 1 }, (_, i) => (i === rows ? FH : even((FH * i) / rows)));
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = xs[c], x1 = xs[c + 1], y0 = ys[r], y1 = ys[r + 1];
    const pl = c > 0 ? opt.pad : 0, pr = c < cols - 1 ? opt.pad : 0, pt = r > 0 ? opt.pad : 0, pb = r < rows - 1 ? opt.pad : 0;
    tiles.push({ c, r, x0, y0, x1, y1, rx: x0 - pl, ry: y0 - pt, rw: x1 + pr - (x0 - pl), rh: y1 + pb - (y0 - pt), pl, pt });
  }
  return { cols, rows, tiles };
}
const P = plan();
const tiled = P.tiles.length > 1;
if (tiled && opt.style === 'default') throw new Error('tiling needs a post-processed style (cinematic etc.); the default style draws its vignette with CSS');
lap(`plan ${P.cols}x${P.rows} tiles, output ${outW}x${outH}, ratio ${ratio}`);

const build = ensureBuild(opt.repo, { dist: opt.dist, log: lap });
const srv = await serveDir(build.dist);
const first = P.tiles[0];
const query = { ...opt.query };
if (preview) query.preview = '1';
const game = await openGame({
  dist: build.dist, port: srv.port, tier: opt.tier, style: opt.style, size: [first.rw, first.rh], dpr: preview ? opt.previewScale : ratio,
  query, gate: true, args: chromeArgs(opt.chrome), log: lap,
  init: tiled ? TILE_HOOK : undefined,
});
const { page } = game;
const result = { tool: 'boxrender', repo: opt.repo, commit: build.short, tier: opt.tier, view: opt.view, mode: opt.mode, style: opt.style,
  size: [FW, FH], outputPx: [outW, outH], pixelRatio: ratio, tiles: P.tiles.length, tilePlan: `${P.cols}x${P.rows}`, pad: tiled ? opt.pad : 0,
  warmFrames: opt.frames, chrome: opt.chrome, bootMs: game.bootMs, launchMs: game.launchMs, tileTimings: [] };

try {
  // ---- camera
  const view = resolveView(opt.view, opt.repo, opt.custom ?? {});
  if (!view.native) {
    await page.evaluate((v) => {
      const g = window.__gale; if (!g.reviewView) throw new Error('this build has no __gale.reviewView (needs shot=1 build)');
      let eye = v.eye, target = v.target;
      if (v.orbit) {
        const [ax, az] = v.orbit.at, h = g.heightAt(ax, az), n = Math.hypot(...v.orbit.back);
        target = [ax, h + v.orbit.lookUp, az];
        eye = [ax + (v.orbit.back[0] / n) * v.orbit.dist, h + v.orbit.up, az + (v.orbit.back[1] / n) * v.orbit.dist];
        eye[1] = Math.max(eye[1], g.heightAt(eye[0], eye[2]) + 6);
      }
      window.__boxView = { eye, target, fov: v.fov };
      g.reviewView(eye, target, v.fov);
    }, view);
  }
  if (opt.setup) await page.evaluate(opt.setup);

  const files = [];
  for (const [i, t] of P.tiles.entries()) {
    const T0 = Date.now();
    if (i > 0 || (tiled && (t.rw !== first.rw || t.rh !== first.rh))) {
      await page.setViewportSize({ width: t.rw, height: t.rh });
    }
    await page.evaluate(({ FW, FH, t, ratio, tiled }) => {
      window.dispatchEvent(new Event('resize'));
      const cam = window.__gale.follow.camera;
      if (tiled) {
        // Cascaded shadow maps are fitted to camera.projectionMatrix. Fit them once to the FULL frame and freeze,
        // otherwise every tile would get its own (tighter, differently snapped) shadow cascades.
        const csm = window.__gale.scene.userData.pbr && window.__gale.scene.userData.pbr.csm;
        if (csm && !window.__boxCsmFrozen) {
          cam.clearViewOffset(); cam.aspect = FW / FH; cam.updateProjectionMatrix();
          csm.updateFrustums(); csm.updateFrustums = () => {}; window.__boxCsmFrozen = true;
        }
        cam.aspect = FW / FH;
        cam.setViewOffset(FW, FH, t.rx, t.ry, t.rw, t.rh);
        cam.updateProjectionMatrix();
        const T = window.__boxTile;
        T.o = [t.rx / FW, 1 - (t.ry + t.rh) / FH]; T.s = [t.rw / FW, t.rh / FH];
        T.frag = [t.rx * ratio, FH * ratio - (t.ry + t.rh) * ratio];
      }
    }, { FW, FH, t, ratio, tiled });
    const frames = opt.frames;
    const times = await page.evaluate((n) => window.__boxStep(n), frames);
    // Sun, cascades (frozen above) and camera position are identical for every tile, so the shadow maps rendered for the
    // first tile are valid for all of them: stop re-rasterising them (about a third of a steady high-tier frame).
    if (tiled && i === 0) await page.evaluate(() => { window.__gale.renderer.shadowMap.autoUpdate = false; });
    if (tiled && !(await page.evaluate(() => window.__boxTile.hooked && window.__boxTile.draws > 0))) throw new Error('post-pass shader hook did not match; tiled output would be wrong');
    const tr = Date.now();
    const file = tiled ? join(opt.workdir, `tile-${t.c}-${t.r}.png`) : opt.out;
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, type: 'png' });
    files.push({ file, t });
    const rec = { tile: [t.c, t.r], renderPx: [Math.round(t.rw * ratio), Math.round(t.rh * ratio)], frameMs: times.map((x) => Math.round(x)), screenshotMs: Date.now() - tr, totalMs: Date.now() - T0 };
    result.tileTimings.push(rec);
    lap(`tile ${i + 1}/${P.tiles.length} frames ${rec.frameMs.join('+')}ms shot ${rec.screenshotMs}ms`);
  }
  result.renderTotalMs = result.tileTimings.reduce((a, r) => a + r.totalMs, 0);
  result.stats = await page.evaluate(() => { const i = window.__gale.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length }; });
  result.pageErrors = game.errors;
  await game.browser.close(); await srv.close();

  if (tiled) {
    const specs = files.map(({ file, t }) => `${file}:${Math.round(t.x0 * ratio)}:${Math.round(t.y0 * ratio)}:${Math.round(t.pl * ratio)}:${Math.round(t.pt * ratio)}:${Math.round((t.x1 - t.x0) * ratio)}:${Math.round((t.y1 - t.y0) * ratio)}`);
    const r = spawnSync('python3', [join(here, 'lib/imgtool.py'), 'stitch', opt.out, String(outW), String(outH), ...specs], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`stitch failed: ${r.stderr}`);
    if (!opt.keepTiles) for (const { file } of files) rmSync(file, { force: true });
  }
  if (preview && opt.upscale) {
    const up = opt.out.replace(/\.png$/, '') + '-upscaled.png';
    spawnSync('python3', [join(here, 'lib/imgtool.py'), 'upscale', opt.out, up, String(FW), String(FH)]);
    result.upscaled = up;
  }
  result.out = opt.out; result.ok = true;
} catch (e) {
  result.ok = false; result.error = String(e.stack || e);
  try { await game.browser.close(); } catch {} try { await srv.close(); } catch {}
}
result.totalMs = Date.now() - t00;
writeFileSync(opt.out.replace(/\.png$/, '') + '.worker.json', JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
