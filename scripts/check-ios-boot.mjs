import assert from 'node:assert/strict';
import { createServer } from 'vite';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), clear: () => values.clear() };
};
const local = memoryStorage(), session = memoryStorage();
globalThis.localStorage = local;
globalThis.sessionStorage = session;
globalThis.location = { search: '' };
globalThis.window = { localStorage: local, sessionStorage: session, matchMedia: () => ({ matches: false }) };
const device = (platform = 'MacIntel', maxTouchPoints = 5, userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/17.0 Safari/605.1.15', coarse = false) => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform, maxTouchPoints, userAgent, hardwareConcurrency: 8 } });
  window.matchMedia = () => ({ matches: coarse });
};
const reset = () => { local.clear(); session.clear(); location.search = ''; device(); };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let count = 0;
const check = (name, run) => { reset(); run(); count++; console.log(`PASS ${name}`); };
try {
  const { pickQuality, mobileCap, TIERS, isIOSLike } = await server.ssrLoadModule('/src/core/quality.ts');
  const { BootGuard, BOOT_GUARD_KEY, BOOT_RETRY_KEY, BOOT_MAX_AGE, resetBootRecovery } = await server.ssrLoadModule('/src/core/boot-guard.ts');
  const { installBootErrorHandlers } = await server.ssrLoadModule('/src/core/boot-errors.ts');
  const { qualityLabel, installQualityPicker } = await server.ssrLoadModule('/src/ui/quality-picker.ts');
  const { Hud } = await server.ssrLoadModule('/src/ui/hud.ts');
  const { colorTargetType } = await server.ssrLoadModule('/src/render/target-type.ts');
  const { HalfFloatType, UnsignedByteType } = await import('three');
  const now = 1000000;
  const sentinel = (quality, stage = '正在砌墙盖瓦…', ts = now - 1000) => local.setItem(BOOT_GUARD_KEY, JSON.stringify({ quality, stage, ts }));
  const guard = (selected = 'high', disabled = false) => new BootGuard(selected, disabled, () => now);
  check('desktop-UA iPad uses low for both fine and coarse pointers', () => {
    for (const coarse of [false, true]) { device('MacIntel', 5, 'Macintosh', coarse); assert.ok(isIOSLike()); assert.equal(pickQuality().name, 'low'); }
  });
  check('desktop Mac stays high; iPhone and legacy iPad use low', () => {
    device('MacIntel', 0); assert.equal(isIOSLike(), false); assert.equal(pickQuality().name, 'high');
    for (const ua of ['iPhone', 'iPad', 'iPod']) { device('', 1, ua); assert.ok(isIOSLike()); assert.equal(pickQuality().name, 'low'); }
  });
  check('desktop high/ultra profiles remain exactly equal to TIERS', () => {
    device('MacIntel', 0);
    for (const name of ['high', 'ultra']) {
      location.search = `?q=${name}`;
      assert.deepEqual(pickQuality(), TIERS[name]); assert.strictEqual(mobileCap(TIERS[name]), TIERS[name]);
    }
  });
  check('iOS caps explicit URL and stored choices without mutating any tier', () => {
    const original = JSON.stringify(TIERS);
    for (const name of ['medium', 'high', 'ultra']) {
      for (const source of ['url', 'stored']) {
        location.search = source === 'url' ? `?q=${name}` : ''; local.setItem('galebound.quality', name);
        const q = pickQuality();
        assert.equal(q.name, name); assert.equal(q.tier, 'low'); assert.ok(q.pixelRatio <= 1);
        assert.ok(q.splatSize <= 1024 && q.shadowSize <= 1024 && q.grassNear <= 5000 && q.flowers <= 800);
        assert.equal(q.terrainCell, 8);
      }
    }
    assert.equal(JSON.stringify(TIERS), original);
  });
  check('uncleared high sentinel lowers to medium, preserving user choice and overriding q', () => {
    location.search = '?q=ultra'; local.setItem('galebound.quality', 'ultra'); sentinel('high');
    const g = guard('ultra');
    assert.equal(g.quality, 'medium'); assert.ok(g.downgradedByGuard); assert.equal(g.interruptedStage, '正在砌墙盖瓦…');
    assert.equal(pickQuality(g.quality).name, 'medium'); assert.equal(local.getItem('galebound.quality'), 'ultra');
    assert.equal(g.isIOS, true); assert.equal(g.selectedQuality, 'ultra');
  });
  check('uncleared low sentinel stays low and disables automatic retries', () => {
    sentinel('low'); const g = guard('ultra');
    assert.equal(g.quality, 'low'); assert.equal(g.autoRetry, false); assert.equal(g.fail(), null);
  });
  check('expired, future, malformed and unknown-tier sentinels are ignored', () => {
    for (const value of [{ quality: 'high', ts: now - BOOT_MAX_AGE }, { quality: 'high', ts: now + 1 }, { quality: 'bogus', ts: now }, null]) {
      local.setItem(BOOT_GUARD_KEY, JSON.stringify(value)); assert.equal(guard().quality, 'high');
    }
    local.setItem(BOOT_GUARD_KEY, '{bad'); assert.equal(guard().quality, 'high');
  });
  check('caught failures persist exactly ultra → high → medium → low → stop, without double downgrade', () => {
    let g = guard('ultra'); const sequence = [g.quality];
    for (let i = 0; i < 3; i++) {
      g.begin(); g.update('建筑'); const lower = g.fail(); sequence.push(lower);
      assert.equal(local.getItem(BOOT_GUARD_KEY), null);
      g = guard('ultra'); assert.equal(g.quality, lower);
    }
    assert.deepEqual(sequence, ['ultra', 'high', 'medium', 'low']); assert.equal(g.fail(), null);
  });
  check('sentinel tracks stages and ready clears it, keeping the session downgrade', () => {
    sentinel('high'); const g = guard(); g.begin(); g.update('种树');
    assert.deepEqual(JSON.parse(local.getItem(BOOT_GUARD_KEY)), { quality: 'medium', stage: '种树', ts: now });
    g.ready(); assert.equal(local.getItem(BOOT_GUARD_KEY), null); assert.equal(guard().quality, 'medium');
    resetBootRecovery(); assert.equal(session.getItem(BOOT_RETRY_KEY), null); assert.equal(guard().quality, 'high');
  });
  check('successful fresh boots do not pin auto/URL choices; recovery never raises a lower selection', () => {
    const g = guard('high'); g.begin(); g.ready();
    assert.equal(session.getItem(BOOT_RETRY_KEY), null); assert.equal(guard('low').quality, 'low');
    session.setItem(BOOT_RETRY_KEY, JSON.stringify({ quality: 'high', retries: 1 }));
    assert.equal(guard('low').quality, 'low');
  });
  check('shot mode neither reads nor writes recovery state and never retries', () => {
    sentinel('high'); const before = local.getItem(BOOT_GUARD_KEY);
    const g = guard('ultra', true); g.begin(); g.update('种树'); g.ready();
    assert.equal(g.quality, 'ultra'); assert.equal(g.fail(), null); assert.equal(local.getItem(BOOT_GUARD_KEY), before);
    assert.equal(session.getItem(BOOT_RETRY_KEY), null);
  });
  check('storage denial is safe and cannot cause a reload loop', () => {
    const deny = () => { throw new Error('denied'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
    try { const g = guard('ultra'); g.begin(); g.update('建筑'); assert.equal(g.fail(), null); g.ready(); }
    finally { Object.defineProperty(window, 'localStorage', { configurable: true, value: local }); Object.defineProperty(window, 'sessionStorage', { configurable: true, value: session }); }
  });
  check('colour targets use byte fallback without float colour-buffer support', () => {
    for (const available of [[], ['EXT_color_buffer_float'], ['EXT_color_buffer_half_float']]) {
      assert.equal(colorTargetType({ extensions: { has: name => available.includes(name) } }), available.length ? HalfFloatType : UnsignedByteType);
    }
  });
  check('title errors show the failed stage, quality and retry state even before HUD construction', () => {
    const elements = new Map(['title', 'hud', 'start', 'boot-status'].map(id => [id, {
      textContent: '', style: {}, dataset: {}, disabled: true,
      classList: { add() {}, remove() {} },
    }]));
    globalThis.document = { getElementById: id => elements.get(id) };
    let reloaded = false; location.reload = () => { reloaded = true; };
    Hud.bootFailure('正在砌墙盖瓦…', '测试错误', 'high', 'medium');
    assert.match(elements.get('boot-status').textContent, /正在砌墙盖瓦.*高画质.*测试错误/s);
    assert.match(elements.get('boot-status').textContent, /2.5 秒.*中/s);
    assert.equal(elements.get('start').disabled, true);
    Hud.bootFailure('正在生成世界…', 'WebGL 不可用', 'low', null);
    assert.equal(elements.get('start').textContent, '重试'); assert.equal(elements.get('start').disabled, false);
    elements.get('start').onclick(); assert.ok(reloaded);
    delete globalThis.document;
  });
  check('global error/rejection call failBoot before ready, and only log after ready', () => {
    const listeners = new Map(), failures = [], logs = [];
    window.addEventListener = (type, listener) => listeners.set(type, listener);
    let ready = false;
    installBootErrorHandlers(error => failures.push(error), () => ready);
    const error = new Error('全局脚本错误');
    listeners.get('error')({ error }); listeners.get('unhandledrejection')({ reason: '异步错误' });
    listeners.get('error')({ message: '只有消息' });
    assert.equal(failures[0], error); assert.equal(failures[1], '异步错误'); assert.equal(failures[2].message, '只有消息');
    const original = console.error; console.error = (...args) => logs.push(args);
    try { ready = true; listeners.get('error')({ error }); listeners.get('unhandledrejection')({ reason: '运行时' }); }
    finally { console.error = original; }
    assert.equal(failures.length, 3); assert.equal(logs.length, 2);
  });
  check('quality labels distinguish URL, saved and auto; mobileCap is unchanged', () => {
    location.search = '?q=high'; assert.match(qualityLabel('high'), /URL（高）/); assert.ok(!qualityLabel('high').includes('自动'));
    location.search = ''; local.setItem('galebound.quality', 'ultra'); assert.match(qualityLabel('ultra'), /已保存（极致）/);
    local.clear(); assert.match(qualityLabel('low'), /自动（低）.*内存保护/);
    assert.deepEqual(mobileCap(TIERS.ultra), {
      ...TIERS.ultra, tier: 'low', cape: 'low', pixelRatio: 1, antialias: false,
      terrainCell: 8, terrainSplit: 1.7, splatSize: 1024, shadowSize: 0, shadowRange: 0,
      grassNear: 5000, grassFar: 6000, flowers: 800, propRange: 260, viewRange: 3200,
      outline: false, particles: 60,
    });
  });
  check('title and HUD share one picker; applying saves choice, clears recovery and q, then reloads', () => {
    const element = () => {
      const classes = new Set(['hidden']), handlers = new Map(), children = [];
      return { textContent: '', style: {}, dataset: {}, disabled: false, children,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} },
        addEventListener: (type, handler) => handlers.set(type, handler),
        click() { handlers.get('click')?.(); }, append: child => children.push(child), querySelectorAll: () => children,
      };
    };
    const elements = new Map(['quality', 'title-quality', 'quality-picker', 'quality-options', 'quality-note', 'quality-apply', 'quality-cancel'].map(id => [id, element()]));
    globalThis.document = { getElementById: id => elements.get(id), createElement: element };
    location.search = '?q=high&style=cinematic'; location.href = 'https://example.test/?q=high&style=cinematic';
    let reloaded = false, replaced;
    location.reload = () => { reloaded = true; };
    globalThis.history = { replaceState: (_a, _b, url) => { replaced = String(url); } };
    sentinel('high'); session.setItem(BOOT_RETRY_KEY, JSON.stringify({ quality: 'medium', retries: 1 }));
    installQualityPicker('high');
    assert.equal(elements.get('quality-options').children.length, 5);
    elements.get('title-quality').click(); assert.equal(elements.get('quality-picker').classList.contains('hidden'), false);
    elements.get('quality').click(); assert.equal(elements.get('quality-picker').classList.contains('hidden'), true);
    elements.get('title-quality').click();
    elements.get('quality-options').children.find(button => button.dataset.tier === 'low').click();
    assert.equal(elements.get('quality-apply').disabled, false);
    elements.get('quality-apply').click();
    assert.equal(local.getItem('galebound.quality'), 'low'); assert.equal(local.getItem(BOOT_GUARD_KEY), null);
    assert.equal(session.getItem(BOOT_RETRY_KEY), null); assert.ok(reloaded);
    assert.equal(new URL(replaced).searchParams.get('q'), null); assert.equal(new URL(replaced).searchParams.get('style'), 'cinematic');
    delete globalThis.document; delete globalThis.history;
  });
  console.log(`PASS: ${count} iOS boot checks; no browser required`);
} finally { await server.close(); }
