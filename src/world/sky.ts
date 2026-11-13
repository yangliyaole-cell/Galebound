import * as THREE from 'three';
import { NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { fbm, seededRandom } from './noise';

export const HORIZON_COLOR = 0xcfe4f2;

function createDome(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x1c69cc) },
      uMid: { value: new THREE.Color(0x58a4e8) },
      uHorizon: { value: new THREE.Color(HORIZON_COLOR) },
      uCloudShade: { value: new THREE.Color(0xa9c2e0) },
      uSunDir: { value: sunDir },
      uCloudDrift: shared.uCloudDrift,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uCloudShade;
      uniform vec3 uSunDir;
      uniform vec2 uCloudDrift;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        col = mix(col, uTop, smoothstep(0.18, 0.85, h));

        float sun = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(sun, 900.0) * 2.5 + pow(sun, 9.0) * 0.12);

        // High, thin cloud; the big cumulus are painted billboards.
        vec2 uv = d.xz / (d.y + 0.25) * 1.1 + uCloudDrift * 6.0;
        float n = gFbm(uv) + gNoise(uv * 6.0) * 0.06;
        float cover = smoothstep(0.56, 0.64, n);
        float towardSun = gFbm(uv + normalize(uSunDir.xz) * 0.14);
        float lit = max(smoothstep(-0.05, 0.1, n - towardSun + 0.03), smoothstep(0.64, 0.74, n));
        vec3 cloud = mix(uCloudShade, vec3(1.0), lit);
        col = mix(col, cloud, cover * smoothstep(0.1, 0.3, d.y) * 0.9);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  dome.renderOrder = -4;
  dome.frustumCulled = false;
  return dome;
}

/** Paints one towering cumulus cloud: bright, lumpy top and a flat blue-grey base. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  const w = 512;
  const h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(seed);
  const puffs: [number, number, number][] = [];
  const base = h * 0.8;
  for (let i = 0; i < 26; i++) {
    const t = rand();
    const x = w * (0.14 + 0.72 * t);
    const tower = Math.sin(t * Math.PI) * (0.55 + rand() * 0.45);
    const r = 26 + rand() * 46 * (0.4 + tower);
    puffs.push([x, base - r * 0.75 - rand() * h * 0.42 * tower, r]);
  }
  const draw = (dx: number, dy: number, grow: number, style: string): void => {
    ctx.fillStyle = style;
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, Math.max(2, r + grow), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(w * 0.16 + dx, base - 34 + dy, w * 0.68, 30);
  };
  draw(0, 0, 0, '#a7bfdc');
  ctx.globalCompositeOperation = 'source-atop';
  draw(-10, -12, -5, '#d5e3f3');
  draw(-18, -22, -14, '#ffffff');
  const shade = ctx.createLinearGradient(0, base - 70, 0, base);
  shade.addColorStop(0, 'rgba(150,176,212,0)');
  shade.addColorStop(1, 'rgba(150,176,212,0.95)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  // Fade the flat base into the haze.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, base - 26, 0, base + 4);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, base - 26, w, 60);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCumulus(): THREE.Group {
  const group = new THREE.Group();
  const rand = seededRandom(77);
  const textures = [11, 23, 37, 51, 68].map(cloudTexture);
  const count = 26;
  for (let i = 0; i < count; i++) {
    const tex = textures[i % textures.length];
    const mat = new THREE.MeshBasicMaterial({
      map: tex, depthWrite: false, depthTest: false, fog: false,
      // Blended, but drawn in the opaque pass so the land always covers it.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const width = 1300 + rand() * 1500;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.5625), mat);
    const a = (i / count) * Math.PI * 2 + rand() * 0.18;
    const r = 3900 + rand() * 500;
    const y = 180 + rand() * rand() * 1300;
    mesh.position.set(Math.cos(a) * r, y + width * 0.2, Math.sin(a) * r);
    mesh.lookAt(0, mesh.position.y * 0.6, 0);
    if (rand() < 0.5) mesh.scale.x = -1;
    mesh.renderOrder = -3 + i * 0.001;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

/** A ring of distant ridges whose base dissolves into the horizon haze. */
function createRidge(
  radius: number,
  minH: number,
  maxH: number,
  seed: number,
  rock: number,
  snowAbove: number,
): THREE.Mesh {
  const n = 300;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const haze = new THREE.Color(HORIZON_COLOR);
  const rockColor = new THREE.Color(rock);
  const snow = new THREE.Color(0xffffff);
  const c = new THREE.Color();

  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    // No mountains to the south, where the sea is.
    const south = THREE.MathUtils.smoothstep(sz, 0.25, 0.75);
    const ridge = Math.pow(fbm(cx * 3.2 + seed, sz * 3.2 + seed, 5), 1.6);
    const jag = fbm(cx * 21 + seed, sz * 21, 2) - 0.5;
    const h = (minH + (maxH - minH) * THREE.MathUtils.clamp(ridge * 1.25 + jag * 0.16, 0, 1)) * (1 - south);

    positions.push(cx * radius, -60, sz * radius);
    colors.push(haze.r, haze.g, haze.b);
    positions.push(cx * (radius + 40), h * 0.55, sz * (radius + 40));
    c.copy(haze).lerp(rockColor, 0.75);
    colors.push(c.r, c.g, c.b);
    positions.push(cx * (radius + 80), h, sz * (radius + 80));
    c.copy(rockColor).lerp(snow, THREE.MathUtils.smoothstep(h, snowAbove, snowAbove * 1.25));
    colors.push(c.r, c.g, c.b);

    if (i < n) {
      const b = i * 3;
      indices.push(b, b + 3, b + 1, b + 1, b + 3, b + 4);
      indices.push(b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

export function createSky(sunDir: THREE.Vector3): {
  object: THREE.Group;
  update: (camera: THREE.Camera, dt: number) => void;
} {
  const group = new THREE.Group();
  const dome = createDome(sunDir);
  const cumulus = createCumulus();
  const far = createRidge(3300, 120, 900, 3.7, 0x6f8fc4, 520);
  far.renderOrder = -2;
  const near = createRidge(2300, 60, 330, 11.2, 0x6f9aa6, 9999);
  near.renderOrder = -1;
  group.add(dome, cumulus, far, near);
  return {
    object: group,
    update: (camera, dt) => {
      // The sky is infinitely far away: it follows the camera.
      group.position.copy(camera.position);
      group.position.y = 0;
      cumulus.rotation.y += dt * 0.0016 * (0.4 + shared.uWindStrength.value);
    },
  };
}
