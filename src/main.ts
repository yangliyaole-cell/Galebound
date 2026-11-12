import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HORIZON_COLOR, createSky } from './world/sky';
import { createTerrain, heightAt } from './world/terrain';
import {
  createFlowers,
  createGrass,
  createPlaceholderPlayer,
  createRocks,
  createTrees,
  windUniforms,
} from './world/vegetation';

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

const player = createPlaceholderPlayer();
const groundY = heightAt(0, 0);
player.position.set(0, groundY, 0);
scene.add(player);

sun.target.position.set(0, groundY, 0);
sun.position.add(sun.target.position);

camera.position.set(9, groundY + 3.4, 15);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, groundY + 1.6, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
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

renderer.setAnimationLoop((ms: number) => {
  const time = ms / 1000;
  windUniforms.uTime.value = time;
  sky.update(time);
  controls.update();
  renderer.render(scene, camera);
});
