import * as THREE from 'three';
import { fbm } from './noise';
import { NOISE_GLSL } from './terrain';

export const HORIZON_COLOR = 0xcfe4f2;

function createDome(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x1f6fd0) },
      uMid: { value: new THREE.Color(0x5aa6e8) },
      uHorizon: { value: new THREE.Color(HORIZON_COLOR) },
      uCloudShade: { value: new THREE.Color(0xa9c2e0) },
      uSunDir: { value: sunDir },
      uTime: { value: 0 },
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
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        col = mix(col, uTop, smoothstep(0.18, 0.85, h));

        float sun = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(sun, 700.0) * 2.0 + pow(sun, 10.0) * 0.1);

        // Cumulus: thresholded noise on a flat layer, lit from the sun side.
        vec2 uv = d.xz / (d.y + 0.2) * 1.25 + uTime * vec2(0.006, 0.003);
        float n = gFbm(uv) + 0.25 * gNoise(uv * 7.0) * 0.25;
        float cover = smoothstep(0.52, 0.57, n);
        float towardSun = gFbm(uv + normalize(uSunDir.xz) * 0.14);
        float lit = smoothstep(-0.05, 0.1, n - towardSun + 0.03);
        lit = max(lit, smoothstep(0.6, 0.72, n));
        vec3 cloud = mix(uCloudShade, vec3(1.0), lit);
        float fade = smoothstep(0.015, 0.14, d.y);
        col = mix(col, cloud, cover * fade);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), mat);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  return dome;
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
  const n = 260;
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
    const ridge = Math.pow(fbm(cx * 3.2 + seed, sz * 3.2 + seed, 5), 1.6);
    const jag = fbm(cx * 21 + seed, sz * 21, 2) - 0.5;
    const h = minH + (maxH - minH) * THREE.MathUtils.clamp(ridge * 1.25 + jag * 0.16, 0, 1);

    positions.push(cx * radius, -30, sz * radius);
    colors.push(haze.r, haze.g, haze.b);

    positions.push(cx * (radius + 25), h * 0.55, sz * (radius + 25));
    c.copy(haze).lerp(rockColor, 0.75);
    colors.push(c.r, c.g, c.b);

    positions.push(cx * (radius + 50), h, sz * (radius + 50));
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
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = -1;
  return mesh;
}

export function createSky(sunDir: THREE.Vector3): {
  object: THREE.Group;
  update: (time: number) => void;
} {
  const group = new THREE.Group();
  const dome = createDome(sunDir);
  group.add(dome);
  group.add(createRidge(1150, 60, 320, 3.7, 0x6f8fc4, 195));
  group.add(createRidge(720, 25, 95, 11.2, 0x6f9aa6, 9999));
  return {
    object: group,
    update: (time) => {
      (dome.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    },
  };
}
