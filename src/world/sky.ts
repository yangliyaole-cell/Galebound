import * as THREE from 'three';
import { CLOUD_BASE, CLOUD_GLSL, CLOUD_TOP, NOISE_GLSL } from '../render/glsl';
import { shared } from '../render/uniforms';
import { seededRandom } from './noise';

export const HORIZON_COLOR = 0xbcd6ec;

/** Value noise in three dimensions from one 2D texture (two taps). */
function noiseTexture(): THREE.DataTexture {
  const size = 256, rand = seededRandom(9127);
  const base = new Uint8Array(size * size);
  for (let i = 0; i < base.length; i++) base[i] = rand() * 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    pixels[o] = base[y * size + x];
    // Green is the layer above: red shifted by the stride between layers.
    pixels[o + 1] = base[((y + 17) % size) * size + (x + 37) % size];
    pixels[o + 2] = base[((y + 59) % size) * size + (x + 101) % size];
    pixels[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Panorama layout: u is the bearing; v packs elevation so the horizon gets most of the rows. */
const PANORAMA_GLSL = /* glsl */ `
  const float SKY_LOW = -0.06;
  vec2 skyUv(vec3 d) {
    float e = asin(clamp(d.y, -1.0, 1.0));
    return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, pow(clamp((e - SKY_LOW) / (1.5707963 - SKY_LOW), 0.0, 1.0), 0.55));
  }
  vec3 skyDir(vec2 uv) {
    float e = SKY_LOW + pow(uv.y, 1.0 / 0.55) * (1.5707963 - SKY_LOW);
    float a = (uv.x - 0.5) * 6.2831853;
    return vec3(cos(a) * cos(e), sin(e), sin(a) * cos(e));
  }
`;

/** Clear-air colour along a direction: deep overhead, pale and warm toward the sun at the horizon. */
const AIR_GLSL = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  vec3 airColor(vec3 d) {
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.26, h));
    col = mix(col, uTop, smoothstep(0.16, 0.9, h));
    float toward = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.86, 0.62) * (pow(toward, 6.0) * 0.16 + pow(toward, 48.0) * 0.3) * (1.0 - 0.6 * h);
    // Below the horizon the air is simply haze.
    return mix(col, uHorizon * 0.96, smoothstep(0.0, -0.08, d.y));
  }
`;

export interface Sky {
  object: THREE.Group;
  update: (camera: THREE.Camera, dt: number) => void;
  /** Clouds as seen from the ground: rgb light, a how much sky shows through. */
  panorama: { value: THREE.Texture };
  /** Repaints the whole panorama at once, after the palette or the sun changes. */
  repaint: () => void;
}

export function createSky(sunDir: THREE.Vector3, renderer: THREE.WebGLRenderer, detail: number): Sky {
  const width = detail === 2 ? 4096 : detail === 1 ? 2048 : 1024, height = width / 4;
  const steps = detail === 2 ? 150 : detail === 1 ? 80 : 40;
  const targets = [0, 1].map(() => new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  }));
  const panorama = { value: targets[0].texture as THREE.Texture };
  const eye = new THREE.Vector3(0, 60, 0);
  const sunColor = new THREE.Color(1.0, 0.93, 0.8);
  const noise = noiseTexture();

  const marcher = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      uNoise: { value: noise }, uEye: { value: eye }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor },
      uCloudDrift: shared.uCloudDrift, uCloudShade: { value: new THREE.Color(0x8fa9cf) },
      uTop: { value: new THREE.Color(0x1859c2) }, uMid: { value: new THREE.Color(0x4a97e6) }, uHorizon: { value: new THREE.Color(HORIZON_COLOR) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uNoise;
      uniform vec3 uEye;
      uniform vec3 uSunColor;
      uniform vec3 uCloudShade;
      varying vec2 vUv;
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      ${PANORAMA_GLSL}
      ${AIR_GLSL}
      float n3(vec3 x) {
        vec3 p = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        vec2 t = textureLod(uNoise, (p.xy + vec2(37.0, 17.0) * p.z + f.xy + 0.5) / 256.0, 0.0).rg;
        return mix(t.x, t.y, f.z);
      }
      float fbm3(vec3 p) {
        float s = 0.5 * n3(p); p = p * 2.03 + 11.3;
        s += 0.25 * n3(p); p = p * 2.02 + 5.1;
        s += 0.125 * n3(p); p = p * 2.01 + 3.7;
        s += 0.0625 * n3(p);
        return s / 0.9375;
      }
      // The world is treated as flat nearby, but far cloud sinks toward the horizon as on a globe.
      float altitude(vec3 p) { return p.y - dot(p.xz - uEye.xz, p.xz - uEye.xz) / 1.1e6; }
      // Billows: folded noise has rounded tops and creased valleys, like cumulus.
      float billow3(vec3 p) {
        float s = 0.5 * (1.0 - abs(2.0 * n3(p) - 1.0)); p = p * 2.07 + 9.1;
        s += 0.25 * (1.0 - abs(2.0 * n3(p) - 1.0)); p = p * 2.03 + 4.3;
        s += 0.125 * (1.0 - abs(2.0 * n3(p) - 1.0));
        return s / 0.875;
      }
      float density(vec3 p, bool fine) {
        float h = (altitude(p) - ${CLOUD_BASE.toFixed(1)}) / ${(CLOUD_TOP - CLOUD_BASE).toFixed(1)};
        if (h < 0.0 || h > 1.0) return 0.0;
        float cover = cloudCover(p.xz);
        if (cover < 0.01) return 0.0;
        // Flat bases; towers rise highest where the cover is deepest.
        float top = mix(0.2, 1.0, cover * cover);
        float profile = smoothstep(0.0, 0.045, h) * smoothstep(top, top * 0.3, h);
        vec3 q = p * 0.00105 + vec3(uCloudDrift.x, 0.0, uCloudDrift.y) * 3.0;
        float shape = mix(fbm3(q), billow3(q * 1.6 + 2.0), 0.55);
        float d = (shape + cover * profile - 1.0) * 2.2;
        if (d <= 0.0) return 0.0;
        if (fine) {
          // Finer billows bite into the edges and leave the core solid.
          float curl = billow3(q * 6.1 + 4.0);
          d -= (1.0 - smoothstep(0.0, 0.42, d)) * (1.0 - curl) * 0.34;
        }
        return clamp(d, 0.0, 1.0) * 0.016;
      }
      void main() {
        vec3 rd = skyDir(vUv);
        vec3 ro = uEye;
        vec4 result = vec4(0.0, 0.0, 0.0, 1.0);
        float mu = dot(rd, uSunDir);
        // Forward and back scattering lobes: silver linings toward the sun.
        float g1 = 0.72, g2 = -0.2;
        float phase = mix((1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5),
                          (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5), 0.55) * 0.25;
        float t = 300.0;
        // Interleaved gradient noise: an even dither that the panorama's filtering smooths away.
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (rd.y > -0.02) {
          for (int i = 0; i < ${steps}; i++) {
            float stride = ${detail === 2 ? '42.0 + t * 0.019' : detail === 1 ? '60.0 + t * 0.03' : '90.0 + t * 0.05'};
            vec3 p = ro + rd * (t + stride * jitter);
            float d = density(p, true);
            if (d > 0.0) {
              // March toward the sun to see how much light survives to this point.
              float shade = 0.0;
              for (int k = 1; k <= 5; k++) shade += density(p + uSunDir * (float(k) * float(k) * 46.0), false) * float(k) * 92.0;
              float beer = exp(-shade);
              float powder = 1.0 - exp(-shade * 2.0 - d * 420.0);
              float h = clamp((altitude(p) - ${CLOUD_BASE.toFixed(1)}) / ${(CLOUD_TOP - CLOUD_BASE).toFixed(1)}, 0.0, 1.0);
              vec3 ambient = mix(uCloudShade * 0.5, mix(uMid, vec3(1.0), 0.6), smoothstep(0.0, 0.75, h));
              vec3 lit = uSunColor * (beer * mix(0.55, 1.0, powder) * (0.72 + phase * 2.2) + exp(-shade * 0.18) * 0.16) * 3.1 + ambient * 0.86;
              // Far cloud dissolves into the same haze as far land.
              float haze = 1.0 - exp(-t * 0.000028);
              lit = mix(lit, airColor(vec3(rd.x, 0.02, rd.z)) * 1.04, haze);
              float a = 1.0 - exp(-d * stride);
              result.rgb += lit * a * result.a;
              result.a *= 1.0 - a;
              if (result.a < 0.01) break;
            }
            t += stride;
            if (t > 70000.0) break;
          }
        }
        gl_FragColor = result;
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), marcher);
  quad.frustumCulled = false;
  const panoScene = new THREE.Scene();
  panoScene.add(quad);
  const panoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Renders rows [from, to) of a panorama. */
  const paint = (target: THREE.WebGLRenderTarget, from: number, to: number): void => {
    const previous = renderer.getRenderTarget(), auto = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    target.scissorTest = true;
    target.scissor.set(0, from, width, to - from);
    target.viewport.set(0, 0, width, height);
    renderer.render(panoScene, panoCamera);
    renderer.setRenderTarget(previous);
    renderer.autoClear = auto;
  };
  paint(targets[0], 0, height);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uTop: marcher.uniforms.uTop, uMid: marcher.uniforms.uMid, uHorizon: marcher.uniforms.uHorizon,
      uCloudShade: marcher.uniforms.uCloudShade, uSunDir: { value: sunDir }, uClouds: panorama,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uClouds;
      varying vec3 vDir;
      ${PANORAMA_GLSL}
      ${AIR_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = airColor(d);
        float sun = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.93, 0.78) * (smoothstep(0.99990, 0.99996, sun) * 9.0 + pow(sun, 900.0) * 0.7);
        vec4 cloud = texture2D(uClouds, skyUv(d));
        col = col * cloud.a + cloud.rgb;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  dome.renderOrder = -4;
  dome.frustumCulled = false;
  const group = new THREE.Group();
  group.add(dome);

  // The panorama is repainted a band at a time into the spare target, then swapped in.
  let current = 0, row = 0;
  const band = Math.ceil(height / 24);
  return {
    object: group, panorama,
    repaint() { row = 0; paint(targets[current], 0, height); },
    update(camera, dt) {
      group.position.copy(camera.position);
      if (dt <= 0) return;
      if (row === 0) eye.set(camera.position.x, Math.max(20, camera.position.y), camera.position.z);
      const spare = targets[1 - current];
      paint(spare, row, Math.min(height, row + band));
      row += band;
      if (row >= height) {
        row = 0;
        current = 1 - current;
        panorama.value = spare.texture;
      }
    },
  };
}
