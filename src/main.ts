import * as THREE from 'three';
import { DynamicResolution, pickQuality } from './core/quality';
import { Input } from './core/input';
import { loadSave, writeSave } from './core/save';
import { shared } from './render/uniforms';
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
import { buildLandmarks } from './world/structures/landmarks';
import { buildCrops, buildVillage } from './world/structures/village';

const params = new URLSearchParams(location.search);
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

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
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
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x7fa04a, 1.5));
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
  scene.add(city.object, createFlags(city.flags));
  scene.add(buildCrops(detail === 0 ? 0.4 : 1, toon(0xffffff, { vertexColors: true, leafTint: true, sway: 0.05, doubleSided: true })));

  hud.loading('正在种树…');
  await nextFrame();
  const scatter = createScatter(quality, sunDir);
  scene.add(scatter.object);

  hud.loading('正在藏起光点…');
  await nextFrame();
  const life = createLife(village.info, city.info, detail === 0 ? 3 : 7);
  scene.add(life.object);
  const orbs = createOrbs(new Set(save.orbs));
  scene.add(orbs.object);
  hud.setOrbs(orbs.found, orbs.total);
  const sound = new Sound();
  sound.muted = save.muted;

  const wind = new Wind();
  scene.add(createWindFx(quality.particles, wind));

  const player = new Player(quality.outline);
  scene.add(player.character.root, player.character.cloth);
  if (save.pos && !params.has('x')) {
    player.pos.set(save.pos[0], save.pos[1], save.pos[2]);
    player.yaw = save.yaw;
    player.mode = 'air';
  } else {
    player.teleport(num('x', START.x), num('z', START.z), num('yaw', Math.PI), num('up', 0));
  }
  const follow = new FollowCamera(camera, input.touch);
  follow.yaw = num('camyaw', player.yaw + Math.PI);
  follow.pitch = num('campitch', 0.16);
  follow.distance = num('dist', 6);
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
  if (params.has('autostart')) {
    hud.skipTitle();
    started = true;
  }
  if (params.has('gust')) wind.force(num('gust', 0));

  // Handles for automated checks; not used by the game itself.
  (window as unknown as Record<string, unknown>).__gale = { player, wind, follow, input, scene, renderer, orbs, heightAt };

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

  renderer.setAnimationLoop((ms: number) => {
    const time = ms / 1000;
    const dt = Math.min(Math.max(time - last, 0), 0.05);
    last = time;
    if (document.hidden) return;
    tick(dt, time + simulated);
    renderer.render(scene, camera);
    resolution.tick(dt);
  });
}

void boot();
