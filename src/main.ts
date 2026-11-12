import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd9ee, 120, 420);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(14, 9, 18);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 80;

// Sky: a gradient dome from horizon haze up to deep blue.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f7fd6) },
      horizon: { value: new THREE.Color(0xbcd9ee) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
      }`,
  }),
);
scene.add(sky);

// Lighting: warm sun plus sky/ground bounce.
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x6c8f3c, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
sun.position.set(40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 200;
scene.add(sun);

// Ground: rolling hills with grass colour varying by height.
function heightAt(x: number, z: number): number {
  return (
    Math.sin(x * 0.035) * Math.cos(z * 0.03) * 5 +
    Math.sin(x * 0.09 + 1.3) * Math.sin(z * 0.11) * 1.5
  );
}

const groundGeo = new THREE.PlaneGeometry(600, 600, 160, 160);
groundGeo.rotateX(-Math.PI / 2);
const pos = groundGeo.attributes.position;
const colors = new Float32Array(pos.count * 3);
const low = new THREE.Color(0x4f9a3a);
const high = new THREE.Color(0xa6d45a);
const tmp = new THREE.Color();
for (let i = 0; i < pos.count; i++) {
  const h = heightAt(pos.getX(i), pos.getZ(i));
  pos.setY(i, h);
  tmp.copy(low).lerp(high, THREE.MathUtils.clamp((h + 6) / 12, 0, 1));
  colors.set([tmp.r, tmp.g, tmp.b], i * 3);
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
groundGeo.computeVertexNormals();
const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshLambertMaterial({ vertexColors: true }),
);
ground.receiveShadow = true;
scene.add(ground);

// Placeholder for the player.
const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.0, 6, 12),
  new THREE.MeshLambertMaterial({ color: 0xe8e2d0 }),
);
player.position.set(0, heightAt(0, 0) + 0.9, 0);
player.castShadow = true;
scene.add(player);

// A few rocks for scale.
const rockMat = new THREE.MeshLambertMaterial({ color: 0x9a9a8f, flatShading: true });
for (const [x, z, s] of [[5, -3, 1.4], [-6, 4, 2.0], [9, 7, 1.0], [-3, -8, 1.6]]) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
  rock.position.set(x, heightAt(x, z) + s * 0.4, z);
  rock.rotation.set(x, z, s);
  rock.scale.y = 0.7;
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
