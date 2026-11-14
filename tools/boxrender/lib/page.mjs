// Launch Chrome (SwiftShader) with a frame gate and open Galebound in shot mode.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);

export function loadPlaywright() {
  // Prefer PLAYWRIGHT_CORE or a normal node resolve; the last entry is a last-resort path used on the GPU-less box.
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core',
    '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch {} }
  throw new Error('playwright-core not found; set PLAYWRIGHT_CORE to the playwright-core package directory (or install it)');
}

export const CHROME = process.env.CHROME_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

/** Chrome flags. `profile` picks a memory/CPU trade-off. */
export function chromeArgs({ heapMB = 3072, rendererLimit = 1, inProcessGpu = false, devShm = false } = {}) {
  const a = [
    '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--js-flags=--max-old-space-size=${heapMB}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-extensions', '--disable-sync', '--no-first-run', '--mute-audio', '--disable-component-update',
    '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
  ];
  if (rendererLimit) a.push(`--renderer-process-limit=${rendererLimit}`);
  if (inProcessGpu) a.push('--in-process-gpu');
  if (!devShm) a.push('--disable-dev-shm-usage');
  return a;
}

/** Init script: keep the game's own render loop, but only run it when we call __boxStep(n).
 * Before the world is ready (window.__galeShotState.shadersReady) requestAnimationFrame is untouched,
 * because boot awaits it. After that every rAF callback is queued instead of scheduled. */
export const GATE_SCRIPT = `(() => {
  const real = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  let queue = [], id = 1000000;
  window.__boxGate = { queued: () => queue.length, steps: 0 };
  window.requestAnimationFrame = (cb) => {
    if (window.__galeShotState && window.__galeShotState.shadersReady) { queue.push([++id, cb]); return id; }
    return real(cb);
  };
  window.cancelAnimationFrame = (i) => { if (i >= 1000000) queue = queue.filter((e) => e[0] !== i); else realCancel(i); };
  /** Run n game frames synchronously; returns ms (including a GL finish) per frame. */
  window.__boxStep = (n = 1) => {
    const gl = window.__gale && window.__gale.renderer.getContext();
    const times = [], px = new Uint8Array(4);
    for (let i = 0; i < n; i++) {
      const cur = queue; queue = [];
      const t0 = performance.now();
      const now = performance.now();
      for (const [, cb] of cur) cb(now);
      if (gl) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } /* sync: waits for deferred SwiftShader work */
      times.push(performance.now() - t0);
      window.__boxGate.steps++;
    }
    return times;
  };
})();`;

export async function openGame({ dist, port, tier, style = 'cinematic', size, dpr = 1, query = {}, gate = true, args, init, log = () => {} }) {
  const { chromium } = loadPlaywright();
  const t0 = Date.now();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: args ?? chromeArgs() });
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  if (gate) await context.addInitScript(GATE_SCRIPT);
  if (init) await context.addInitScript(init);
  const url = new URL(`http://127.0.0.1:${port}/`);
  const params = { autostart: '1', shot: '1', q: tier, style, dr: '0', ...query };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  log(`launch ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const t1 = Date.now();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.waitForFunction(() => (window.__galeShotState && window.__galeShotState.shadersReady) || window.__galeShotError, null, { timeout: 600_000, polling: 250 });
  const err = await page.evaluate(() => window.__galeShotError);
  if (err) throw new Error(`game reported: ${err}`);
  const bootMs = Date.now() - t1;
  log(`boot ${(bootMs / 1000).toFixed(1)}s`);
  return { browser, context, page, errors, url: url.href, bootMs, launchMs: t1 - t0 };
}

/** Init script: lets the harness render one TILE of a larger frame through the game's own pipeline.
 * The post pass ("look") computes vignette / chromatic aberration from its own uv and adds noise from
 * gl_FragCoord, so a tile would get the wrong values. We rewrite that one shader on the way to the GPU
 * (WebGL2 shaderSource hook) so it uses the tile's position inside the full frame. The camera side is
 * plain camera.setViewOffset, done from shot-worker. Nothing in the repo is modified. */
export const TILE_HOOK = `(() => {
  const T = window.__boxTile = { o: [0, 0], s: [1, 1], frag: [0, 0], hooked: false, draws: 0, fragPatched: 0 };
  const P = WebGL2RenderingContext.prototype;
  const fragShaders = new WeakSet(), lookShaders = new WeakSet(), fragPrograms = new WeakSet(), lookPrograms = new WeakSet(), locs = new WeakMap();
  const ss = P.shaderSource;
  P.shaderSource = function (shader, src) {
    // 1) every fragment shader that dithers or hashes on gl_FragCoord.xy: shift it by the tile origin so the
    //    pattern is the one the full frame would have had (LOD cross-fade dither, grass, sky jitter ...).
    if (src.includes('gl_FragCoord.xy') && /^precision /m.test(src)) {
      src = src.replace(/gl_FragCoord\\.xy/g, '(gl_FragCoord.xy + uBoxFrag)').replace(/^precision /m, 'uniform highp vec2 uBoxFrag;\\nprecision ');
      fragShaders.add(shader); T.fragPatched++;
    }
    // 2) the post-processing "look" pass: vignette and chromatic aberration use the uv of the FULL frame.
    if (src.includes('uniform vec4 uGrade') && src.includes('vec2 lens = (vUv - 0.5)')) {
      const before = src;
      src = src
        .replace('uniform float uTime;', 'uniform float uTime;\\nuniform vec4 uBoxTile;\\nvec2 boxUv(vec2 u) { return uBoxTile.xy + u * uBoxTile.zw; }')
        .replace('vec2 lens = (vUv - 0.5)', 'vec2 lens = (boxUv(vUv) - 0.5)')
        .replace('vec2 radial = (uv - 0.5)', 'vec2 radial = (boxUv(uv) - 0.5)');
      if (src !== before && src.includes('boxUv(vUv)') && src.includes('boxUv(uv)')) { lookShaders.add(shader); T.hooked = true; }
    }
    return ss.call(this, shader, src);
  };
  const at = P.attachShader;
  P.attachShader = function (p, s) { if (fragShaders.has(s)) fragPrograms.add(p); if (lookShaders.has(s)) lookPrograms.add(p); return at.call(this, p, s); };
  let cur = null;
  const up = P.useProgram;
  P.useProgram = function (p) { cur = p; return up.call(this, p); };
  const wrap = (name) => {
    const orig = P[name];
    P[name] = function (...a) {
      if (cur && fragPrograms.has(cur)) {
        let l = locs.get(cur);
        if (!l) { l = { f: this.getUniformLocation(cur, 'uBoxFrag'), t: lookPrograms.has(cur) ? this.getUniformLocation(cur, 'uBoxTile') : null }; locs.set(cur, l); }
        if (l.f) this.uniform2f(l.f, T.frag[0], T.frag[1]);
        if (l.t) this.uniform4f(l.t, T.o[0], T.o[1], T.s[0], T.s[1]);
        T.draws++;
      }
      return orig.apply(this, a);
    };
  };
  for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) wrap(n);
})();`;
