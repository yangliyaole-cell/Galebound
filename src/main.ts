import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HORIZON_COLOR, createSky } from './world/sky';
import { createTerrain, heightAt } from './world/terrain';
import { createFlowers, createGrass, createRocks, createTrees, windUniforms } from './world/vegetation';
import { Character } from './player/character';
import { createPreview } from './player/preview';

// Phones and tablets get lighter settings; proper quality tiers come in stage 7.
const lowEnd = window.matchMedia('(pointer: coarse)').matches;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowEnd ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON_COLOR, 90, 620);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);

const sunDir = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
const sky = createSky(sunDir);
scene.add(sky.object);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x7fa04a, 1.5));
const sun = new THREE.DirectionalLight(0xfff0cf, 3.0);
sun.position.copy(sunDir).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(lowEnd ? 1024 : 2048);
const shadowCam = sun.shadow.camera;
shadowCam.left = shadowCam.bottom = -65;
shadowCam.right = shadowCam.top = 65;
shadowCam.near = 1;
shadowCam.far = 300;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

scene.add(createTerrain());
scene.add(createGrass(lowEnd ? 45000 : 140000, 62));
scene.add(createFlowers(lowEnd ? 14 : 30, 55));
scene.add(createTrees(lowEnd ? 70 : 130));
scene.add(createRocks(lowEnd ? 30 : 55));

const character = new Character();
scene.add(character.root, character.cloth);

const windVelocity = new THREE.Vector3();
const preview = createPreview(character, heightAt, () => {
  const dir = windUniforms.uWindDir.value;
  const speed = windUniforms.uWindStrength.value * 3;
  return windVelocity.set(dir.x * speed, 0, dir.y * speed);
});

const focus = character.root.position;
camera.position.set(focus.x + 2.2, focus.y + 1.9, focus.z + 3.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(focus.x, focus.y + 1.05, focus.z);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.5;
controls.maxDistance = 70;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const lastFocus = focus.clone();
const moved = new THREE.Vector3();
let lastTime = 0;
renderer.setAnimationLoop((ms: number) => {
  const time = ms / 1000;
  const dt = Math.min(time - lastTime, 0.1);
  lastTime = time;
  windUniforms.uTime.value = time;
  sky.update(time);

  preview.update(dt, time);
  // Keep the camera and the sun's shadow area centred on the character.
  moved.copy(focus).sub(lastFocus);
  lastFocus.copy(focus);
  camera.position.add(moved);
  controls.target.add(moved);
  sun.target.position.copy(focus);
  sun.position.copy(sunDir).multiplyScalar(120).add(focus);

  controls.update();
  renderer.render(scene, camera);
});
