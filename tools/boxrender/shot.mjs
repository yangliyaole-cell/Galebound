#!/usr/bin/env node
// node tools/boxrender/shot.mjs --repo . --tier high --view spawn --mode final
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuarded, memAvailMB } from './lib/guard.mjs';
import { parseArgs, wh, vec3 } from './lib/args.mjs';
import { VIEW_NAMES } from './lib/views.mjs';
import { defaultRepo, defaultOutDir } from './lib/paths.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const SPEC = { repo: 1, dist: 1, tier: 1, view: 1, mode: 1, size: 1, dpr: 1, style: 1, frames: 1, tile: 1, pad: 1, out: 1, eye: 1, target: 1, fov: 1,
  'preview-scale': 1, 'max-tile-mpx': 1, 'rss-limit': 1, 'min-avail': 1, timeout: 1, 'heap-mb': 1, query: 'multi', 'keep-tiles': 'bool', 'no-retry': 'bool',
  'in-process-gpu': 'bool', 'no-upscale': 'bool', quiet: 'bool', help: 'bool' };
const HELP = `shot.mjs: one reliable screenshot of a Galebound checkout on a GPU-less box (SwiftShader).
  --repo DIR            Galebound checkout (default: the repo that contains this tool, or $GALEBOUND_REPO). Built into tools/boxrender/.cache; the checkout is not edited.
  --tier low|medium|high   (default high)
  --view ${VIEW_NAMES.join('|')}   or --eye x,y,z --target x,y,z [--fov 55]   (default spawn)
  --mode final|preview  final = full resolution, game's own pipeline, tiled automatically if it would not fit.
                        preview = LABELLED PREVIEW: renders at --preview-scale (0.5) of the pixels, same CSS layout.
  --size WxH            CSS size of the frame (default 1600x900)      --dpr N  device pixel ratio (final, default 1; capped by tier: low 1, medium 1.5, high 2)
  --style cinematic|default|ghibli|watercolor|lowpoly-dusk  (default cinematic; tiling needs a post style)
  --frames N            game frames to render before the screenshot (default 1: one frame is bit-identical to 24 continuous frames, see README)
  --tile auto|CxR       final only. auto: split until each tile (with padding) is <= --max-tile-mpx (default 2.6) megapixels
  --pad N               overlap in CSS px per interior tile edge (default 40; post-process kernels reach 32)
  --out FILE.png        (default tools/boxrender/out/<view>-<tier>-<mode>.png)
  --query k=v           extra URL param for the game (x, z, camyaw, campitch, dist, hero, effects ...), repeatable
  --rss-limit MB        kill the browser tree above this RSS (default 6500)   --min-avail MB  kill if MemAvailable drops below (default 900)
  --no-retry            do not retry with smaller tiles after an out-of-memory kill
`;
let a;
try { a = parseArgs(process.argv.slice(2), SPEC).o; } catch (e) { console.error(e.message + '\n' + HELP); process.exit(2); }
if (a.help) { console.log(HELP); process.exit(0); }
const opt = {
  repo: resolve(a.repo ?? defaultRepo(here)), dist: a.dist, tier: a.tier ?? 'high', view: a.view ?? 'spawn', mode: a.mode ?? 'final',
  size: wh(a.size ?? '1600x900'), dpr: Number(a.dpr ?? 1), style: a.style ?? 'cinematic', frames: Number(a.frames ?? 1),
  tile: a.tile ?? 'auto', pad: Number(a.pad ?? 40), maxTileMpx: Number(a['max-tile-mpx'] ?? 2.6), previewScale: Number(a['preview-scale'] ?? 0.5),
  keepTiles: !!a['keep-tiles'], upscale: !a['no-upscale'],
  query: Object.fromEntries((a.query ?? []).map((q) => q.split(/=(.*)/s).slice(0, 2))),
  custom: a.eye ? { eye: vec3(a.eye), target: vec3(a.target ?? '0,0,0'), fov: Number(a.fov ?? 55) } : {},
  chrome: { heapMB: Number(a['heap-mb'] ?? 3072), inProcessGpu: !!a['in-process-gpu'] },
};
if (!['low', 'medium', 'high'].includes(opt.tier)) { console.error('--tier must be low|medium|high'); process.exit(2); }
if (!['final', 'preview'].includes(opt.mode)) { console.error('--mode must be final|preview'); process.exit(2); }
if (a.view === undefined && a.eye) opt.view = 'custom';
const outDefault = join(defaultOutDir(here), `${opt.view}-${opt.tier}-${opt.mode}.png`);
opt.out = resolve(a.out ?? outDefault);
opt.workdir = join(dirname(opt.out), `.tiles-${Date.now()}`);
mkdirSync(dirname(opt.out), { recursive: true });
const rssLimit = Number(a['rss-limit'] ?? 6500), minAvail = Number(a['min-avail'] ?? 900), timeoutMs = Number(a.timeout ?? 3_600_000);

const attempts = [];
let tilePlans = [opt.tile];
if (opt.mode === 'final' && !a['no-retry']) {
  // after an OOM kill, retry with tiles that are half, then a quarter of the size
  tilePlans = [opt.tile, ...(opt.tile === 'auto' ? ['auto:1.2', 'auto:0.6'] : [])];
}
let final;
for (const plan of tilePlans) {
  const o = { ...opt };
  if (plan.startsWith('auto:')) { o.tile = 'auto'; o.maxTileMpx = Number(plan.slice(5)); }
  if (a.quiet !== true) console.error(`[shot] ${o.view} ${o.tier} ${o.mode} ${o.size.join('x')} tile=${o.tile}${o.tile === 'auto' ? `(<=${o.maxTileMpx}MPx)` : ''}  MemAvailable ${memAvailMB()}MB`);
  const g = await runGuarded('node', [join(here, 'shot-worker.mjs'), JSON.stringify(o)], { cwd: here, limitMB: rssLimit, minAvailMB: minAvail, timeoutMs });
  const wj = o.out.replace(/\.png$/, '') + '.worker.json';
  const worker = existsSync(wj) ? JSON.parse(readFileSync(wj, 'utf8')) : null;
  attempts.push({ tile: plan, guard: g, worker });
  final = { ok: g.code === 0 && worker?.ok, worker, guard: g };
  if (final.ok) break;
  const oom = g.killedBy || g.signal === 'SIGKILL' || g.code === 137;
  console.error(`[shot] attempt failed (${g.killedBy ?? g.signal ?? 'exit ' + g.code}), peak ${g.peakMB}MB ${JSON.stringify(g.peakByRole)}`);
  if (!oom) break;
}
const summary = {
  ok: final.ok, out: final.ok ? opt.out : null, tool: 'boxrender', options: { ...opt, workdir: undefined },
  wallMs: attempts.reduce((s, x) => s + x.guard.ms, 0), peakRssMB: Math.max(...attempts.map((x) => x.guard.peakMB)),
  peakByRole: final.guard.peakByRole, minMemAvailableMB: Math.min(...attempts.map((x) => x.guard.minAvailMB ?? 1e9)),
  attempts: attempts.map((x) => ({ tile: x.tile, ms: x.guard.ms, peakMB: x.guard.peakMB, killedBy: x.guard.killedBy, code: x.guard.code })),
  worker: final.worker,
};
writeFileSync(opt.out.replace(/\.png$/, '') + '.json', JSON.stringify(summary, null, 2));
const w = final.worker;
console.log(final.ok
  ? `OK ${opt.out}\n   ${w.outputPx.join('x')}px  mode=${w.mode}  tiles=${w.tilePlan}  wall ${(summary.wallMs / 1000).toFixed(1)}s (boot ${(w.bootMs / 1000).toFixed(1)}s, render ${(w.renderTotalMs / 1000).toFixed(1)}s)  peak RSS ${summary.peakRssMB}MB`
  : `FAILED ${w?.error ?? final.guard.killedBy ?? ''}`);
process.exit(final.ok ? 0 : 1);
