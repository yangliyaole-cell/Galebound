// npm install --no-save --package-lock=false playwright, or set PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(error));
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.goto('http://127.0.0.1:5173/tools/hero-preview.html');
  await page.waitForFunction(() => window.heroPreview?.ready, { timeout: 60000 });
  if (process.argv.includes('--classic')) await page.evaluate(() => window.heroPreview.select('classic'));
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    document.querySelector('#pause').click();
    const hero = window.heroPreview;
    hero.character.rig.setBlink?.(false);
    if (hero.character.rig.eyes) hero.character.rig.eyes.scale.y = 1;
    hero.renderer.render(hero.scene, hero.camera);
  });
  await page.screenshot({path:path.resolve('art/hero', process.argv.includes('--classic') ? 'classic.png' : 'hero-preview.png')});
  console.log(await page.evaluate(() => window.heroPreview.stats()));
  await browser.close();
})();
