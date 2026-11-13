import * as THREE from 'three';
import { DynamicResolution, pickQuality } from './core/quality';
import { Input } from './core/input';
import { loadSave, writeSave } from './core/save';
import { shared } from './render/uniforms';
import { createStyleController, type StyleController } from './render/styles';
import { seededRandom } from './world/noise';
import { Hud } from './ui/hud';
import { FollowCamera } from './player/camera';
import { Player } from './player/controller';
import { buildHeightmap, createHeightTexture, heightAt } from './world/heightmap';
import { START, ZONES } from './world/layout';
import { buildBiome, buildSplat } from './world/maps';
import { createTerrain, groundUniforms } from './world/terrain';
import { createWater } from './world/water';
import { HORIZON_COLOR, createSky } from './world/sky';
import { createGrass } from './world/grass';
import { createScatter } from './world/scatter';
import { Wind, createWindFx } from './world/wind';
import { toon } from './render/toon';
import { groundDetailTexture } from './render/textures';
import { createFlags } from './world/flags';
import { Sound } from './core/audio';
import { createLife } from './world/life';
import { createOrbs } from './world/orbs';
import { buildCity } from './world/structures/city';
import { buildAbbey } from './world/structures/abbey';
import { createAbbeyLighting } from './world/abbey-space';
import { buildLandmarks } from './world/structures/landmarks';
import { buildCrops, buildVillage } from './world/structures/village';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') === '1';
const debugWindow = window as unknown as Record<string, unknown>;
if (shot) {
  document.documentElement.classList.add('shot');
  debugWindow.__galeShotReady = false;
}
const num = (key: string, fallback: number): number => {
  const value = params.has(key) ? Number(params.get(key)) : fallback;
  return Number.isFinite(value) ? value : fallback;
};
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function boot(): Promise<void> {
  const quality = pickQuality();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const input = new Input(canvas);
  const hud = new Hud(input.touch, quality.tier);
  const save = loadSave();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
  const basePixelRatio = Math.min(window.devicePixelRatio, quality.pixelRatio);
  renderer.setPixelRatio(basePixelRatio);
  renderer.shadowMap.enabled = quality.shadowSize > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_COLOR, 110, quality.viewRange);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 7000);

  let styles: StyleController | undefined;
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    styles?.resize();
  };
  window.addEventListener('resize', resize);
  resize();
  const resolution = new DynamicResolution((scale) => {
    renderer.setPixelRatio(basePixelRatio * scale);
    resize();
  });

  // ---- build the world, yielding so the title screen can show progress
  hud.loading('正在隆起山丘…');
  await nextFrame();
  buildHeightmap(quality.terrainCell);
  const heightTex = createHeightTexture();
  groundUniforms.uSplat.value = buildSplat(quality.splatSize);
  groundUniforms.uBiome.value = buildBiome();
  groundUniforms.uDetail.value = groundDetailTexture();

  const sunDir = new THREE.Vector3(0.42, 0.72, 0.55).normalize();
  const sky = createSky(sunDir);
  scene.add(sky.object);
  const hemisphere = new THREE.HemisphereLight(0xcfe6ff, 0x7fa04a, 1.5);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff0cf, 3.0);
  sun.castShadow = quality.shadowSize > 0;
  sun.shadow.mapSize.setScalar(quality.shadowSize || 256);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -quality.shadowRange;
  sc.right = sc.top = quality.shadowRange;
  sc.near = 1;
  sc.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const abbeyLighting = createAbbeyLighting(sun, hemisphere, () => scene.fog instanceof THREE.Fog ? scene.fog : null);

  hud.loading('正在铺草、引水…');
  await nextFrame();
  scene.add(createTerrain());
  scene.add(createWater(heightTex, sunDir, HORIZON_COLOR));
  scene.add(createGrass(quality.grassNear, quality.grassFar, quality.flowers, heightTex));

  hud.loading('正在砌墙盖瓦…');
  await nextFrame();
  const detail = quality.tier === 'high' ? 2 : quality.tier === 'medium' ? 1 : 0;
  const village = buildVillage(detail);
  const landmarks = buildLandmarks();
  scene.add(village.object, landmarks.object);
  await nextFrame();
  const city = buildCity(detail);
  scene.add(city.object, createFlags(city.flags), buildAbbey());
  scene.add(buildCrops(detail === 0 ? 0.4 : 1, toon(0xffffff, { vertexColors: true, leafTint: true, sway: 0.05, doubleSided: true })));

  hud.loading('正在种树…');
  await nextFrame();
  const scatter = createScatter(quality, sunDir);
  scene.add(scatter.object);

  hud.loading('正在藏起光点…');
  await nextFrame();
  const life = createLife(village.info, city.info, detail === 0 ? 3 : 7);
  scene.add(life.object);
  const orbs = createOrbs(new Set(shot ? [] : save.orbs));
  scene.add(orbs.object);
  hud.setOrbs(orbs.found, orbs.total);
  const sound = new Sound();
  sound.muted = save.muted;

  const wind = new Wind();
  scene.add(createWindFx(quality.particles, wind, shot ? seededRandom(553) : Math.random));

  const player = new Player(quality.outline);
  if (params.get('hero') !== 'classic') {
    hud.loading('正在整理旅人的行装…');
    await nextFrame();
    await player.character.loadModel();
    player.character.rig.setMaskVisible?.(params.get('mask') !== 'off');
  }
  scene.add(player.character.root, player.character.cloth);
  if (!shot && save.pos && !params.has('x')) {
    player.pos.set(save.pos[0], save.pos[1], save.pos[2]);
    player.yaw = save.yaw;
    player.mode = 'air';
  } else {
    player.teleport(num('x', START.x), num('z', START.z), num('yaw', Math.PI), num('up', 0));
  }
  const follow = new FollowCamera(camera, input.touch);
  follow.yaw = num('camyaw', shot ? -0.16 : player.yaw + Math.PI);
  follow.pitch = num('campitch', shot ? 0.12 : 0.16);
  follow.distance = num('dist', shot ? 8.5 : 6);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    hud.showTouch();
    follow.autoFollow = true;
  });

  // ---- events
  wind.onState = (state) => {
    if (state === 'warning') hud.toast('阵风将至');
    else if (state === 'gust') hud.toast(`阵风起了，吹向${wind.heading()}。从高处顺风跳下`);
  };
  hud.onJump = () => input.pressJump();
  hud.onRun = () => input.toggleRun();
  hud.onSound = () => {
    const on = sound.toggle();
    save.muted = !on;
    writeSave(save);
    return on;
  };
  player.onJump = () => sound.jump();
  player.onLand = (impact) => sound.land(impact);
  player.onSplash = () => sound.splash();
  let glides = 0;
  player.onGlide = (begun) => {
    if (!begun) return;
    sound.whoosh();
    if (glides++ === 0) hud.toast('乘上风了。A / D 或摇杆左右转向，顺着风飞得最远', 5);
  };

  let started = false;
  let zone = '';
  let saveTimer = 0;
  hud.onStart = () => {
    started = true;
    sound.start();
    canvas.focus();
  };
  let stride = 0;
  if (shot || params.has('autostart')) {
    hud.skipTitle();
    started = true;
  }
  if (!shot && params.has('gust')) wind.force(num('gust', 0));

  styles = createStyleController({ renderer, scene, camera, sun, hemisphere, sunDir, sky: sky.object,
    quality, heavy: params.get('effects') !== '0' }, (name) => hud.style(name));
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (event.code !== 'KeyV' || event.repeat || event.isComposing || event.keyCode === 229
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select')))) return;
    event.preventDefault();
    void styles!.next().then(() => hud.cinemaLabel(styles!.current === 'cinematic')).catch((error: unknown) => {
      console.error('Could not load render style', error);
      hud.toast('风格加载失败，请重试');
    });
  });
  // Cinematic is the default look; the 电影感 button toggles it and is remembered.
  const cinemaKey = 'galebound.cinematic';
  const cinemaStored = (): boolean => { try { return localStorage.getItem(cinemaKey) !== '0'; } catch { return true; } };
  hud.onCinema = async () => {
    const on = styles!.current !== 'cinematic';
    try { localStorage.setItem(cinemaKey, on ? '1' : '0'); } catch { /* private mode */ }
    await styles!.set(on ? 'cinematic' : 'default');
    return on;
  };
  const initialStyle = params.get('style') ?? (cinemaStored() ? 'cinematic' : 'default');
  try { await styles.set(initialStyle, false); } catch (error) {
    console.error('Could not load render style', error);
    await styles.set('default', false);
  }
  hud.cinemaLabel(styles.current === 'cinematic');

  // Handles for automated checks; not used by the game itself.
  (window as unknown as Record<string, unknown>).__gale = { player, wind, follow, input, scene, renderer, orbs, heightAt, style: styles };

  hud.ready();
  let last = performance.now() / 1000;
  window.addEventListener('focus', () => { last = performance.now() / 1000; });
  let titleAngle = 0;
  /** One step of the whole game, without drawing. */
  const tick = (dt: number, time: number): void => {
    shared.uTime.value = time;
    wind.update(dt);
    input.poll(dt);

    if (started) {
      const [lx, ly] = input.takeLook();
      follow.look(lx, ly);
      follow.zoom(input.takeZoom());
      player.update(dt, time, input, follow.yaw, wind);
    } else {
      // Title screen: a slow turn around the starting hill.
      input.takeLook();
      input.takeJump();
      input.takeZoom();
      titleAngle += dt * 0.05;
      follow.yaw = player.yaw + Math.PI + Math.sin(titleAngle) * 0.5;
      const idle = { moveX: 0, moveY: 0, run: false, takeJump: () => false } as unknown as Input;
      player.update(dt, time, idle, follow.yaw, wind);
    }
    follow.update(dt, player);
    shared.uPlayer.value.copy(player.pos);

    if (started) {
      // Light orbs: walk or fly through one to gather it.
      for (const id of orbs.update(dt, player.pos, player.gliding ? 2.6 : 1.7)) {
        save.orbs.push(id);
        writeSave(save);
        hud.setOrbs(orbs.found, orbs.total, true);
        sound.chime(orbs.found);
        if (orbs.found === orbs.total) hud.toast('所有的光都找到了。这片土地记住了你', 8);
        else if (orbs.found === 1) hud.toast('找到一点光。还有更多藏在高处和角落里');
        else if (orbs.found % 10 === 0) hud.toast(`已找到 ${orbs.found} 点光`);
      }
      if (player.mode === 'ground' && player.speed > 0.5) {
        stride += player.speed * dt;
        const length = player.speed > 4.3 ? 1.75 : 0.72;
        if (stride > length) {
          stride = 0;
          sound.step(player.speed > 4.3);
        }
      }
      sound.update(dt, wind.gust, player.gliding ? Math.min(1, player.speed / 16) : 0);
    }
    life.update(dt, time, player.pos);

    sun.target.position.copy(player.pos);
    sun.position.copy(sunDir).multiplyScalar(220).add(player.pos);
    sky.update(camera, dt);
    scatter.update(camera.position);
    for (const s of landmarks.spinners) s.wheel.rotation.z += s.speed * (0.1 + shared.uWindStrength.value) * dt;

    if (started) {
      hud.update(dt, wind, follow.yaw, player.yaw);
      // Announce the region when the player walks into a new one.
      let here = '';
      for (const z of ZONES) {
        if (Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r) {
          here = z.name;
          if (zone !== here) hud.zone(z.name, z.sub);
          break;
        }
      }
      if (here) zone = here;
      saveTimer += dt;
      if (saveTimer > 4 && player.mode === 'ground') {
        saveTimer = 0;
        save.pos = [player.pos.x, player.pos.y, player.pos.z];
        save.yaw = player.yaw;
        writeSave(save);
      }
    }

  };

  // Lets automated checks run the game faster than it can be drawn.
  let simulated = 0;
  ((window as unknown as Record<string, Record<string, unknown>>).__gale).sim = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      simulated += 1 / 60;
      tick(1 / 60, last + simulated);
    }
  };

  if (shot) {
    // Advance only a fixed preparation sequence, then freeze every simulation system.
    shared.uTime.value = 12;
    wind.update(0);
    const idle = { moveX: 0, moveY: 0, run: false, takeJump: () => false } as unknown as Input;
    for (let i = 0; i < 90; i++) {
      player.update(1 / 60, 12, idle, follow.yaw, wind);
      follow.update(1 / 60, player);
    }
    shared.uPlayer.value.copy(player.pos);
    life.update(0, 12, player.pos);
    sun.target.position.copy(player.pos);
    sun.position.copy(sunDir).multiplyScalar(220).add(player.pos);
    sky.update(camera, 0);
    scatter.update(camera.position);
    renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
      debugWindow.__galeShotError = 'Shader compilation failed';
      console.error('Shader compilation failed', renderer.getContext().getShaderInfoLog(vertex),
        renderer.getContext().getShaderInfoLog(fragment));
    };
  }

  type Measurement = { remaining: number; frames: number; total: number; calls: number; triangles: number;
    start: number; pixel: Uint8Array; resolve: (value: unknown) => void };
  let measurement: Measurement | undefined;
  const handles = debugWindow.__gale as Record<string, unknown>;
  handles.measure = (frames = 60): Promise<unknown> => {
    if (measurement) return Promise.reject(new Error('A measurement is already running'));
    const count = Math.min(600, Math.max(1, Math.round(frames) || 60));
    return new Promise((resolve) => {
      measurement = { remaining: count, frames: count, total: 0, calls: 0, triangles: 0, start: performance.now(), pixel: new Uint8Array(4), resolve };
    });
  };
  let shotFrames = 0;
  renderer.setAnimationLoop((ms: number) => {
    const time = ms / 1000;
    const dt = Math.min(Math.max(time - last, 0), 0.05);
    last = time;
    if (document.hidden) return;
    if (!shot) tick(dt, time + simulated);
    else {
      // A runtime style switch may move the sun, while the simulation stays frozen.
      sun.position.copy(sunDir).multiplyScalar(220).add(player.pos);
    }
    const sample = measurement;
    const autoReset = renderer.info.autoReset;
    if (sample) {
      renderer.info.autoReset = false;
      renderer.info.reset();
    }
    const begin = sample ? performance.now() : 0;
    const pipeline = styles!.pipeline;
    abbeyLighting.update(shot ? 1 : dt, player.pos);
    try {
      if (pipeline) pipeline.render();
      else renderer.render(scene, camera);
    } finally {
      abbeyLighting.restore();
    }
    if (sample) {
      // A synchronous default-framebuffer readback also waits on SwiftShader's deferred work.
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample.pixel);
      sample.total += performance.now() - begin;
      sample.calls += renderer.info.render.calls;
      sample.triangles += renderer.info.render.triangles;
      renderer.info.autoReset = autoReset;
      if (--sample.remaining === 0) {
        measurement = undefined;
        sample.resolve({ frames: sample.frames, renderMs: sample.total / sample.frames,
          rafMs: (performance.now() - sample.start) / sample.frames,
          calls: sample.calls / sample.frames, triangles: sample.triangles / sample.frames,
          pixelRatio: renderer.getPixelRatio(), style: styles!.current, extraPasses: pipeline?.extraPasses ?? 0 });
      }
    }
    if (shot && ++shotFrames === 24 && !debugWindow.__galeShotError) {
      renderer.getContext().finish();
      debugWindow.__galeShotReady = true;
    }
    if (!shot) resolution.tick(dt);
  });
}

void boot();
