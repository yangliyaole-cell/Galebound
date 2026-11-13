#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const defaults = ['default', 'ghibli', 'cinematic', 'watercolor', 'lowpoly-dusk'];
const options = { out: '/workspace/handoffs/galebound-styles', 'base-url': 'http://localhost:5199', styles: defaults.join(',') };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) {
    throw new Error('Usage: node scripts/capture-styles.mjs [--out dir] [--base-url url] [--styles a,b,c]');
  }
  options[key] = process.argv[++i];
}
const styles = options.styles.split(',').map((name) => name.trim()).filter(Boolean);
if (!styles.length || styles.some((name) => !defaults.includes(name))) throw new Error(`Styles must be one of ${defaults.join(', ')}`);
const source = process.env.PLAYWRIGHT_CORE || 'playwright-core';
// Accept either a package name or the absolute directory of an external installation.
const { chromium } = require(isAbsolute(source) ? source : source.startsWith('.') ? resolve(source) : source);
const out = resolve(options.out);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const perf = {
  note: 'SwiftShader software rendering is not representative of GPU performance. renderMs includes a synchronous 1x1 RGBA gl.readPixels readback; rafMs includes requestAnimationFrame scheduling. Calls/triangles include the entire postprocessing chain.',
  viewport: { width: 1280, height: 720 },
  frames: 60,
  styles: {},
};
try {
  for (const style of styles) {
    // Isolate storage and input state so every view starts from the same world.
    const context = await browser.newContext({ viewport: perf.viewport, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && /shader|webgl|render style/i.test(message.text())) errors.push(message.text());
      });
      const url = new URL(options['base-url']);
      for (const [key, value] of Object.entries({ autostart: '1', q: 'medium', dr: '0', shot: '1', style })) url.searchParams.set(key, value);
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180_000 });
      await page.waitForFunction(() => window.__galeShotReady || window.__galeShotError, null, { timeout: 180_000 });
      const shaderError = await page.evaluate(() => window.__galeShotError);
      if (shaderError || errors.length) throw new Error(`${style}: ${shaderError || errors.join('\n')}`);
      await page.screenshot({ path: join(out, `${style}.png`) });
      const result = await page.evaluate(() => window.__gale.measure(60));
      if (result.style !== style) throw new Error(`Requested ${style}, got ${result.style}`);
      if (errors.length) throw new Error(`${style}: ${errors.join('\n')}`);
      perf.styles[style] = result;
      // Preserve completed measurements if a later style fails.
      await writeFile(join(out, 'perf.json'), `${JSON.stringify(perf, null, 2)}\n`);
      console.log(`${style}: ${result.renderMs.toFixed(2)} ms render, ${result.rafMs.toFixed(2)} ms rAF, ${result.calls} calls, ${result.triangles} triangles, ${result.extraPasses} extra passes`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Saved screenshots and perf.json to ${out}`);
