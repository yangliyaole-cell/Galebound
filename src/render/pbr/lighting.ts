import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { Quality } from '../../core/quality';
import { PBR_TIERS } from './config';
import { createContactTexture } from './contact';
import { pbrAlternative, pbrUniforms, registerSceneRocks, usePbr } from './material';

export function createPbrLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, sunDir: THREE.Vector3,
  sky: THREE.Group, quality: Quality, height: THREE.Texture) {
  const profile = PBR_TIERS[quality.tier];
  if (!profile.cascades) return { update(_style: string): void {} };
  pbrUniforms.uPbrGround.value = height;
  pbrUniforms.uPbrContact.value = createContactTexture(profile.contactSize);
  registerSceneRocks(scene);
  const materials = new Set<THREE.Material>();
  const collect = (material: THREE.Material): void => {
    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshToonMaterial || material instanceof THREE.MeshLambertMaterial) materials.add(material);
    const alternative = pbrAlternative(material);
    if (alternative) materials.add(alternative);
  };
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(collect);
    if (object.userData.pbrRock) collect(object.userData.pbrRock.pbr);
  });
  const splits = (_count: number, _near: number, far: number, breaks: number[]): void => {
    const distances = quality.tier === 'high' ? [48, 200, profile.shadowFar] : [55, profile.shadowFar];
    distances.forEach((distance) => breaks.push(Math.min(distance / far, 1)));
  };
  const csm = new CSM({ camera, parent: scene, cascades: profile.cascades,
    mode: 'custom', customSplitsCallback: splits, maxFar: profile.shadowFar, shadowMapSize: profile.shadowSize,
    shadowBias: quality.tier === 'high' ? -.000012 : -.00002, lightDirection: sunDir.clone().negate(), lightIntensity: sun.intensity,
    lightNear: .5, lightFar: 2200, lightMargin: 280 });
  csm.fade = true;
  csm.updateFrustums();
  for (const light of csm.lights) {
    light.visible = false;
    light.shadow.normalBias = quality.tier === 'high' ? .025 : .04;
    light.shadow.radius = 1.6;
  }
  for (const material of materials) {
    const compile = material.onBeforeCompile;
    csm.setupMaterial(material);
    const csmCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, webgl) => {
      compile.call(material, shader, webgl);
      csmCompile.call(material, shader, webgl);
    };
    // The default style starts with the unchanged original single sun.
    delete material.defines?.USE_CSM;
    delete material.defines?.CSM_CASCADES;
    delete material.defines?.CSM_FADE;
  }
  let active = false, environment: THREE.WebGLRenderTarget | undefined;
  let capturedDirection = new THREE.Vector3(Infinity, 0, 0);
  const projection = new THREE.Matrix4().copy(camera.projectionMatrix);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const baselineEnvironment = scene.environment, baselineIntensity = scene.environmentIntensity;
  const captureSky = (): void => {
    environment?.dispose();
    // Capture the actual palette/cloud shader, with a dark ground hemisphere.
    // Ridges/billboards intentionally stay out of the infinitely distant lighting probe.
    const dome = sky.children[0].clone() as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    dome.material = dome.material.clone();
    dome.material.uniforms.uSunDir.value.copy(sunDir);
    dome.material.fragmentShader = dome.material.fragmentShader.replace('gl_FragColor = vec4(col, 1.0);',
      'col = mix(vec3(.055,.065,.042), col, smoothstep(-.22,.06,d.y));\ngl_FragColor = vec4(col, 1.0);');
    const probe = new THREE.Scene(); probe.add(dome);
    environment = pmrem.fromScene(probe, .025, .1, 6000, { size: profile.environmentSize });
    dome.material.dispose();
    capturedDirection = sunDir.clone();
    scene.environment = environment.texture;
  };
  scene.userData.pbr = { tier: quality.tier, ...profile, csm, materials };
  return {
    update(style: string): void {
      const enabled = style === 'cinematic';
      if (active !== enabled) {
        active = enabled;
        usePbr(scene, enabled);
        pbrUniforms.uPbrActive.value = enabled ? 1 : 0;
        // Use exactly one sun's radiance. Never change the preset sun/hemisphere values.
        if (enabled) scene.remove(sun); else scene.add(sun);
        csm.lights.forEach((light) => { light.visible = enabled; });
        for (const material of materials) {
          material.defines ??= {};
          if (enabled) Object.assign(material.defines, { USE_CSM: 1, CSM_CASCADES: profile.cascades, CSM_FADE: '' });
          else { delete material.defines.USE_CSM; delete material.defines.CSM_CASCADES; delete material.defines.CSM_FADE; }
          material.needsUpdate = true;
        }
        scene.environment = enabled && environment ? environment.texture : baselineEnvironment;
        scene.environmentIntensity = enabled ? profile.environmentIntensity : baselineIntensity;
      }
      if (!enabled) return;
      if (!environment || capturedDirection.distanceToSquared(sunDir) > .0001) captureSky();
      if (!projection.equals(camera.projectionMatrix)) {
        projection.copy(camera.projectionMatrix); csm.updateFrustums();
      }
      csm.lightDirection.copy(sunDir).negate();
      csm.lights.forEach((light) => { light.color.copy(sun.color); light.intensity = sun.intensity; });
      camera.updateMatrixWorld(); csm.update();
    },
  };
}
