import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { shared } from '../uniforms';
import { seededRandom } from '../../world/noise';
import type { StyleContext, StyleName, StylePipeline } from './index';
import { defaultStyle } from './default';
import { ghibli } from './ghibli';
import { cinematic } from './cinematic';
import { watercolor } from './watercolor';
import { lowpolyDusk } from './lowpoly-dusk';
import { createMaterialStyles } from './materials';
import { fragmentShader, vertexShader } from './effects';

const HERO_ENVIRONMENT_INTENSITY = 0.3;
/** Light-albedo hero parts (face, shirt, sash) would otherwise glow under the lifted fill. */
const HERO_ALBEDO = 0.75;
const presets = { ghibli, cinematic, watercolor, 'lowpoly-dusk': lowpolyDusk };

function paperTexture(): THREE.DataTexture {
  const size = 256;
  const bytes = new Uint8Array(size * size * 4);
  const random = seededRandom(1949);
  const grain = Float32Array.from({ length: 64 * 64 }, () => random());
  const coarse = Float32Array.from({ length: 16 * 16 }, () => random());
  const noise = (grid: Float32Array, n: number, x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const at = (dx: number, dy: number): number => grid[((iy + dy) % n) * n + (ix + dx) % n];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0, 0), at(1, 0), fx),
      THREE.MathUtils.lerp(at(0, 1), at(1, 1), fx), fy);
  };
  const byte = (value: number): number => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fiber = Math.sin(x * Math.PI / 8 + Math.sin(y * Math.PI / 32) * 1.8);
    const relief = 0.5 + (noise(grain, 64, x / 4, y / 4) - 0.5) * 1.1 + (random() - 0.5) * 0.4;
    const i = (y * size + x) * 4;
    bytes.set([byte(relief), byte(0.5 + fiber * 0.25 + (random() - 0.5) * 0.14),
      byte(noise(coarse, 16, x / 16, y / 16)), 255], i);
  }
  const tex = new THREE.DataTexture(bytes, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Soft sky / horizon / ground-bounce dome, prefiltered once. It supplies natural fill for PBR
 * materials (the hero) and carries no sun disc: the shadow-casting sun is the only key light. */
function skyEnvironment(renderer: THREE.WebGLRenderer, sky: [number, number, number], sunDir: THREE.Vector3): THREE.Texture {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(sky[0]) }, uHorizon: { value: new THREE.Color(sky[1]) },
      uGround: { value: new THREE.Color(sky[2]) },
      uSun: { value: sunDir.clone().normalize() }, uWarm: { value: new THREE.Color(0xffdcae) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uZenith, uHorizon, uGround, uSun, uWarm;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(uHorizon, uZenith, pow(h, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, 0.45, -h));
        // A broad warm lobe toward the sun gives the hero a lit side and a shaded side.
        c += uWarm * 1.1 * pow(max(dot(normalize(vDir), uSun), 0.0), 3.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const envScene = new THREE.Scene();
  envScene.add(dome);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(envScene, 0.02);
  generator.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  return target.texture;
}

/** This entire module, including Three's postprocessing, is loaded on first use. */
export function createPipeline(context: StyleContext): StylePipeline {
  const { renderer, scene, camera, sun, hemisphere, sunDir, quality } = context;
  const baseline = {
    fog: scene.fog,
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    shadowType: renderer.shadowMap.type,
    sun: sun.color.clone(), sunIntensity: sun.intensity,
    hemisphere: hemisphere.color.clone(), ground: hemisphere.groundColor.clone(), intensity: hemisphere.intensity,
    direction: sunDir.clone(), radius: sun.shadow.radius,
  };
  const applyMaterials = createMaterialStyles(context);
  let environment: THREE.Texture | undefined;
  const heroMaterials = new Set<THREE.MeshStandardMaterial>();
  const heroColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith('Traveler_')) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) { heroMaterials.add(material); heroColors.set(material, material.color.clone()); }
    }
  });
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    // MSAA resolves both colour and depth; the canvas's AA cannot cover an offscreen target.
    samples: Math.min(quality.tier === 'low' ? 2 : 4, renderer.capabilities.maxSamples),
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  const composer = new EffectComposer(renderer, target);
  // Two swaps per frame keep the scene in target2. Only that target needs MSAA/depth.
  composer.renderTarget1.depthTexture?.dispose();
  composer.renderTarget1.depthTexture = null;
  composer.renderTarget1.depthBuffer = false;
  composer.renderTarget1.samples = 0;
  const look = new ShaderPass({
    defines: { STYLE: 1 },
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null }, tPaper: { value: paperTexture() },
      uPixel: { value: new THREE.Vector2() }, uResolution: { value: new THREE.Vector2() },
      uClip: { value: new THREE.Vector2(camera.near, camera.far) },
      uGrade: { value: new THREE.Vector4() }, uTime: shared.uTime,
      uPixelRatio: { value: renderer.getPixelRatio() }, uContrast: { value: 1 }, uToe: { value: 0 },
      uInk: { value: new THREE.Color() }, uEdge: { value: new THREE.Vector2() },
      uLuminanceEdge: { value: new THREE.Vector2() }, uPaperQuiet: { value: new THREE.Vector3() },
      uPaper: { value: new THREE.Vector4() }, uBloom: { value: new THREE.Vector3() },
      uAtmosphere: { value: new THREE.Vector3() }, uSplitShadow: { value: new THREE.Color() },
      uSplitLight: { value: new THREE.Color() }, uSplitStrength: { value: 0 },
      uShadowFloor: { value: new THREE.Color() },
      uHeavy: { value: quality.tier !== 'low' && context.heavy ? 1 : 0 },
      uInverseProjection: { value: camera.projectionMatrixInverse },
      uCameraWorld: { value: camera.matrixWorld }, uFog: { value: new THREE.Color() },
    },
    vertexShader, fragmentShader,
  });
  // ShaderPass clones its uniforms; reconnect the values that change every frame.
  look.uniforms.uTime = shared.uTime;
  look.uniforms.uInverseProjection.value = camera.projectionMatrixInverse;
  look.uniforms.uCameraWorld.value = camera.matrixWorld;
  look.material.depthTest = look.material.depthWrite = false;
  look.material.toneMapped = false;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(look);
  const output = new OutputPass();
  output.needsSwap = true;
  composer.addPass(output);
  const size = new THREE.Vector2();
  const resize = (): void => {
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    renderer.getDrawingBufferSize(size);
    look.uniforms.uPixel.value.set(1 / size.x, 1 / size.y);
    look.uniforms.uResolution.value.copy(size);
    look.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  };
  resize();

  return {
    extraPasses: 2,
    resize,
    apply(name: StyleName): void {
      const preset = name === 'default' ? undefined : presets[name];
      scene.fog = baseline.fog;
      for (const material of heroMaterials) { material.envMap = null; material.color.copy(heroColors.get(material)!); }
      renderer.toneMapping = baseline.toneMapping;
      renderer.toneMappingExposure = baseline.exposure;
      renderer.shadowMap.type = baseline.shadowType;
      sun.color.copy(baseline.sun);
      sun.intensity = baseline.sunIntensity;
      hemisphere.color.copy(baseline.hemisphere);
      hemisphere.groundColor.copy(baseline.ground);
      hemisphere.intensity = baseline.intensity;
      sunDir.copy(baseline.direction);
      sun.shadow.radius = baseline.radius;
      applyMaterials(name, preset);
      // CSS defaults remain untouched until an alternate style is active.
      if (preset) document.documentElement.dataset.renderStyle = name;
      else delete document.documentElement.dataset.renderStyle;
      if (!preset) return;
      renderer.toneMapping = name === 'cinematic' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      if (name === 'cinematic') {
        // r187 folds soft PCF into PCFShadowMap; PCFSoftShadowMap is removed.
        renderer.shadowMap.type = THREE.PCFShadowMap;
        sun.shadow.radius = 2;
        // Image-based fill for the hero only: the world's toon/shader materials stay on the
        // hemisphere light, so distant terrain keeps its look.
        environment ??= skyEnvironment(renderer, [0x4f86c8, 0x9fb2bb, 0x4a5c44], new THREE.Vector3(...preset.direction));
        for (const material of heroMaterials) {
          material.envMap = environment;
          material.envMapIntensity = HERO_ENVIRONMENT_INTENSITY;
          material.color.copy(heroColors.get(material)!).multiplyScalar(HERO_ALBEDO);
        }
      }
      sun.color.set(preset.sun[0]);
      sun.intensity = preset.sun[1];
      hemisphere.color.set(preset.hemisphere[0]);
      hemisphere.groundColor.set(preset.hemisphere[1]);
      hemisphere.intensity = preset.hemisphere[2];
      sunDir.set(...preset.direction).normalize();
      scene.fog = new THREE.Fog(preset.fog[0], preset.fog[1], name === 'cinematic' ? preset.fog[2] : Math.min(quality.viewRange, preset.fog[2]));
      look.uniforms.uFog.value.set(preset.fog[0]);
      look.uniforms.uGrade.value.set(...preset.grade);
      const post = preset.post;
      look.uniforms.uContrast.value = post.contrast;
      look.uniforms.uToe.value = post.toe ?? 0;
      look.uniforms.uInk.value.set(post.ink);
      look.uniforms.uEdge.value.set(post.width, post.colorEdge);
      look.uniforms.uLuminanceEdge.value.set(...(post.luminanceEdge ?? [0.32, 0.55]));
      look.uniforms.uPaperQuiet.value.set(...(post.paperQuiet ?? [1, 0.04, 0.14]));
      look.uniforms.uPaper.value.set(post.paper ?? 0, post.warp ?? 0, post.bleed ?? 0, post.wash ?? 0);
      look.uniforms.uBloom.value.set(...(post.bloom ?? [0, 0, 0]));
      look.uniforms.uAtmosphere.value.set(...(post.atmosphere ?? [0, 0, 0]));
      look.uniforms.uSplitShadow.value.set(post.split?.[0] ?? 0xffffff);
      look.uniforms.uSplitLight.value.set(post.split?.[1] ?? 0xffffff);
      look.uniforms.uSplitStrength.value = post.split?.[2] ?? 0;
      look.uniforms.uShadowFloor.value.set(preset.surface.shadow);
      look.material.defines.STYLE = preset.id || defaultStyle.id;
      look.material.needsUpdate = true;
      resize();
    },
    render(): void {
      look.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      look.uniforms.uClip.value.set(camera.near, camera.far);
      composer.render(0);
    },
  };
}
