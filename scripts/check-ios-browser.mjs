// Optional integration check. Uses the existing external Playwright loader, no npm dependency.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { loadPlaywright, chromeArgs, CHROME } from '../tools/boxrender/lib/page.mjs';
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true }, logLevel: 'error' });
await server.listen();
let browser;
try {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: chromeArgs() });
  const context = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
  await context.addInitScript(() => {
    Object.defineProperties(navigator, { platform: { get: () => 'MacIntel' }, maxTouchPoints: { get: () => 5 }, hardwareConcurrency: { get: () => 8 } });
  });
  const broken = await context.newPage();
  await broken.addInitScript(() => {
    const trace = JSON.parse(sessionStorage.getItem('test.trace') ?? '[]');
    trace.push(JSON.parse(sessionStorage.getItem('galebound.bootRetry') ?? 'null')?.quality ?? 'ultra');
    sessionStorage.setItem('test.trace', JSON.stringify(trace));
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await broken.goto('http://127.0.0.1:5187/?q=ultra');
  await broken.waitForFunction(() => document.querySelector('#start')?.textContent === '重试', null, { timeout: 60000 });
  const failure = await broken.evaluate(() => ({ trace: JSON.parse(sessionStorage.getItem('test.trace')),
    message: document.querySelector('#boot-status').textContent, guard: window.__galeBootGuard,
    preference: localStorage.getItem('galebound.quality') }));
  assert.deepEqual(failure.trace, ['ultra', 'high', 'medium', 'low']);
  assert.match(failure.message, /加载失败.*低画质/s); assert.match(failure.message, /WebGL/);
  assert.equal(failure.preference, null);
  // A low failure stays put longer than the automatic retry delay.
  await broken.waitForTimeout(2800);
  assert.equal(await broken.evaluate(() => JSON.parse(sessionStorage.getItem('test.trace')).length), 4);
  await broken.locator('#start').click();
  await broken.waitForFunction(() => JSON.parse(sessionStorage.getItem('test.trace')).length === 5 && document.querySelector('#start')?.textContent === '重试');
  console.log('PASS Chrome: WebGL unavailable → ultra/high/medium/low → stop; manual retry works');
  await broken.close();

  const shot = await context.newPage();
  await shot.addInitScript(() => {
    localStorage.setItem('galebound.bootGuard', JSON.stringify({ quality: 'high', stage: '建筑', ts: Date.now() }));
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await shot.goto('http://127.0.0.1:5187/?shot=1&q=ultra');
  await shot.waitForFunction(() => window.__galeShotError);
  assert.equal(await shot.evaluate(() => window.__galeBootGuard.quality), 'ultra');
  assert.equal(await shot.evaluate(() => JSON.parse(localStorage.getItem('galebound.bootGuard')).quality), 'high');
  console.log('PASS Chrome: shot reports __galeShotError and leaves sentinel untouched');
  await shot.close();

  const game = await context.newPage(), errors = [];
  game.on('pageerror', error => errors.push(error.message));
  game.on('console', message => { if (message.type() === 'error' && /shader|framebuffer|WebGL/i.test(message.text())) errors.push(message.text()); });
  await game.addInitScript(() => {
    localStorage.clear(); sessionStorage.clear();
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      return /EXT_color_buffer_(half_float|float)/.test(name) ? null : getExtension.call(this, name);
    };
  });
  await game.route('**/models/traveler.glb', route => route.abort());
  await game.goto('http://127.0.0.1:5187/?style=cinematic');
  await game.waitForFunction(() => document.querySelector('#start')?.textContent === '启程' || document.querySelector('#start')?.dataset.bootFailed, null, { timeout: 180000 });
  const result = await game.evaluate(() => ({ text: document.querySelector('#start').textContent,
    decision: { isIOS: window.__galeBootGuard.isIOS, quality: window.__galeBootGuard.quality },
    sentinel: localStorage.getItem('galebound.bootGuard'), dpr: window.__gale?.renderer.getPixelRatio(),
    classic: !window.__gale?.player.character.rig.setCapeState, status: document.querySelector('#boot-status').textContent }));
  assert.equal(result.text, '启程', result.status); assert.deepEqual(result.decision, { isIOS: true, quality: 'low' });
  assert.equal(result.sentinel, null); assert.equal(result.dpr, 1); assert.equal(result.classic, true);
  assert.deepEqual(errors, []);
  await game.locator('#start').click();
  await game.waitForFunction(() => document.querySelector('#title').classList.contains('hidden'));
  // Synthetic context-loss exercises the event path after entering the game.
  await game.evaluate(() => document.querySelector('#game').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await game.waitForFunction(() => document.querySelector('#start').textContent === '重试');
  assert.match(await game.locator('#boot-status').textContent(), /图形上下文丢失/);
  assert.equal(await game.locator('#title').evaluate(element => element.classList.contains('hidden')), false);
  console.log('PASS Chrome: Mac-UA touch iPad loads at low with byte targets + missing GLB fallback; context loss shows retry');
  await game.close(); await context.close();
} finally { await browser?.close(); await server.close(); }
