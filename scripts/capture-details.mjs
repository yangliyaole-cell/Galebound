#!/usr/bin/env node
// Run in the external Chrome environment; like capture-styles, no project dependency.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
const options = { 'base-url': 'http://localhost:5199', out: 'artifacts/detail-captures', tier: 'high' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options) || !process.argv[i + 1]) throw new Error('Usage: --base-url URL --out DIR --tier low|medium|high');
  options[key] = process.argv[i + 1];
}
if (!['low','medium','high'].includes(options.tier)) throw new Error('Invalid quality tier');
const data = JSON.parse(await readFile(new URL(`../artifacts/detail-lod/after-${options.tier}.json`,import.meta.url),'utf8'));
const require = createRequire(import.meta.url), source = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = require(isAbsolute(source) ? source : source.startsWith('.') ? resolve(source) : source);
const out = resolve(options.out); await mkdir(out,{recursive:true});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: {width:1600,height:900}, deviceScaleFactor:1 });
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error' && /shader|webgl/i.test(m.text())) errors.push(m.text());});
  const url = new URL(options['base-url']);
  for(const [key,value] of Object.entries({autostart:'1',shot:'1',style:'cinematic',q:options.tier,dr:'0'})) url.searchParams.set(key,value);
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.__galeShotReady || window.__galeShotError,null,{timeout:180000});
  const results = [];
  for(const view of data.screenshots) {
    await page.evaluate(v=>window.__gale.reviewView(v.eye,v.target,v.fov ?? 55),view);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const error = await page.evaluate(()=>window.__galeShotError);
    if(error || errors.length) throw new Error(error || errors.join('\n'));
    await page.screenshot({path:join(out,`${view.name}.png`)});
    results.push({ ...view, runtime: await page.evaluate(()=>window.__gale.measure(12)) });
    await writeFile(join(out,'runtime-metrics.json'),JSON.stringify({note:'Actual render chain including shadows/postprocessing. SwiftShader milliseconds are not hardware GPU FPS.',tier:options.tier,views:results},null,2));
    console.log(`Captured ${view.name}`);
  }
  if(errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
