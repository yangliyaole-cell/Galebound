import * as THREE from 'three';
import { groundUniforms } from '../../world/terrain';
import type { StyleContext, StyleName } from './index';
import type { StylePreset } from './types';

const colorGLSL = (hex: number): string => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`;
};

function surfaceGLSL(name: StyleName, preset: StylePreset): string {
  const s = preset.surface;
  const relativeBands = s.bandLevels && s.bandThresholds ? `
      float albedoY = max(styleLuma(albedo), 0.025);
      float illumination = y / albedoY;
      float band = mix(${s.bandLevels[0].toFixed(3)}, ${s.bandLevels[1].toFixed(3)}, step(${s.bandThresholds[0].toFixed(3)}, illumination));
      band = mix(band, ${s.bandLevels[2].toFixed(3)}, step(${s.bandThresholds[1].toFixed(3)}, illumination));
      vec3 block = mix(c, c * (albedoY * band / y), ${s.bandMix.toFixed(3)});
      block = mix(vec3(styleLuma(block)), block, ${(s.saturation ?? 1).toFixed(3)});` : `
      float level = floor(clamp(sqrt(y), 0.0, 0.9999) * ${s.bands.toFixed(1)}) / ${(s.bands - 1).toFixed(1)};
      float band = pow(mix(${s.bandFloor.toFixed(4)}, 1.0, level), 2.0);
      vec3 block = mix(c, c * (band / y), ${s.bandMix.toFixed(3)});`;
  return /* glsl */ `
    float styleLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    vec3 styleSurface(vec3 c, vec3 albedo) {
      c = max(c, vec3(0.0));
      float y = max(styleLuma(c), 0.00001);
      // Only illumination/luminance is quantized; RGB ratios stay intact.
      ${relativeBands}
      vec3 shade = ${colorGLSL(s.shadow)};
      vec3 light = ${colorGLSL(s.highlight)};
      ${name === 'lowpoly-dusk' ? `
        vec3 ambient = shade * (0.95 + min(albedo, vec3(1.0)) * 0.6);
        vec3 lit = block * mix(vec3(1.0), light, ${s.tint.toFixed(3)});
        return mix(ambient, lit, smoothstep(0.035, 0.26, y));` : `
        float lit = smoothstep(0.10, 0.65, y);
        vec3 tint = mix(shade / max(styleLuma(shade), 0.01), light / max(styleLuma(light), 0.01), lit);
        return block * mix(vec3(1.0), tint, ${s.tint.toFixed(3)}) + shade * 0.025 * (1.0 - lit);`}
    }
  `;
}

/** Capture live values once; no shader or uniform changes exist on an untouched default. */
export function createMaterialStyles(context: StyleContext) {
  const materials = new Set<THREE.Material>();
  context.scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((material) => materials.add(material));
    }
  });
  const cloudMaterials = new Set<THREE.Material>();
  context.sky.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial && object.material.map) {
      cloudMaterials.add(object.material);
    }
  });
  const snapshots = [...materials].map((material) => ({
    material,
    compile: material.onBeforeCompile,
    key: material.customProgramCacheKey,
    baseKey: material.customProgramCacheKey(),
    visible: material.visible,
    flat: 'flatShading' in material ? material.flatShading as boolean : undefined,
    ramp: material instanceof THREE.MeshToonMaterial ? material.gradientMap : undefined,
  }));
  const colors: { value: THREE.Color | THREE.Vector3; original: THREE.Color | THREE.Vector3; name: string }[] = [];
  const remember = (uniforms: Record<string, THREE.IUniform>): void => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      if (uniform.value instanceof THREE.Color || ['uDark', 'uLight'].includes(name)) {
        colors.push({ name, value: uniform.value, original: uniform.value.clone() });
      }
    }
  };
  remember(groundUniforms);
  context.sky.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      const value = object.material.color;
      colors.push({ name: object.material.map ? 'cloudTint' : 'ridgeTint', value, original: value.clone() });
    }
  });
  materials.forEach((mat) => { if (mat instanceof THREE.ShaderMaterial) remember(mat.uniforms); });
  const ramps = new Map<StyleName, THREE.DataTexture>();

  return (name: StyleName, preset?: StylePreset): void => {
    for (const saved of colors) {
      if (saved.value instanceof THREE.Color && saved.original instanceof THREE.Color) saved.value.copy(saved.original);
      else if (saved.value instanceof THREE.Vector3 && saved.original instanceof THREE.Vector3) saved.value.copy(saved.original);
    }
    for (const entry of snapshots) {
      const { material } = entry;
      material.visible = entry.visible;
      material.onBeforeCompile = entry.compile;
      material.customProgramCacheKey = entry.key;
      if (entry.flat !== undefined) (material as THREE.MeshStandardMaterial).flatShading = entry.flat;
      if (material instanceof THREE.MeshToonMaterial) material.gradientMap = entry.ramp!;
      if (preset) {
        if (entry.baseKey.startsWith('outline-')) material.visible = false;
        // Grass cards deliberately carry the ground normal, rather than their triangle normal.
        if (entry.flat !== undefined && !entry.baseKey.startsWith('grass-')) {
          (material as THREE.MeshStandardMaterial).flatShading = !!preset.flat;
        }
        if (material instanceof THREE.MeshToonMaterial) {
          let ramp = ramps.get(name);
          if (!ramp) {
            ramp = new THREE.DataTexture(new Uint8Array(preset.ramp), preset.ramp.length, 1, THREE.RedFormat);
            ramp.minFilter = ramp.magFilter = name === 'cinematic' ? THREE.LinearFilter : THREE.NearestFilter;
            ramp.needsUpdate = true;
            ramps.set(name, ramp);
          }
          material.gradientMap = ramp;
        }
        material.customProgramCacheKey = () => `${entry.baseKey}|style-${name === 'cinematic' ? 'v2' : 'v3'}-${name}`;
        material.onBeforeCompile = (shader, renderer) => {
          entry.compile.call(material, shader, renderer);
          const detail = preset.surface.detail;
          const simplifyDetail = (source: string): string => source
            .replace('col *= 1.0 + dab * 0.42;', `col *= 1.0 + dab * ${(0.42 * detail).toFixed(3)};`)
            .replace('vBlade * (0.42 + 1.0 * tuft.r)',
              `vBlade * (${(0.42 + 0.4 * (1 - detail)).toFixed(3)} + ${detail.toFixed(3)} * tuft.r)`);
          shader.vertexShader = simplifyDetail(shader.vertexShader);
          shader.fragmentShader = simplifyDetail(shader.fragmentShader);
          const litMaterial = material instanceof THREE.MeshToonMaterial
            || material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshStandardMaterial;
          if (litMaterial && name !== 'cinematic') {
            // MeshToonMaterial has no flatShading property in r187.
            if (preset.flat && material instanceof THREE.MeshToonMaterial) {
              shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
                #include <normal_fragment_begin>
                normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
                nonPerturbedNormal = normal;`);
            }
            const character = name === 'lowpoly-dusk' && material instanceof THREE.MeshStandardMaterial
              ? preset.surface.character : undefined;
            const fill = character ? `
              float styleFillShape = 0.7 + 0.3 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
              outgoingLight += ${colorGLSL(character.fill)} * ${character.strength.toFixed(3)} * styleFillShape
                * (0.55 + sqrt(max(diffuseColor.rgb, vec3(0.0))) * ${character.detail.toFixed(3)});` : '';
            const rim = material instanceof THREE.MeshLambertMaterial ? '' : `
              float styleRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
              outgoingLight += ${colorGLSL(preset.surface.highlight)} * styleRim * ${(character?.rim ?? preset.surface.rim).toFixed(4)};`;
            shader.fragmentShader = surfaceGLSL(name, preset) + shader.fragmentShader.replace(
              '#include <opaque_fragment>',
              `outgoingLight = styleSurface(outgoingLight, diffuseColor.rgb);
${fill}
${rim}
#include <opaque_fragment>`,
            );
          } else if (material instanceof THREE.ShaderMaterial) {
            if (material.fog && name !== 'cinematic') {
              const albedo = 'uLeaf' in material.uniforms ? 'vTint' : 'gl_FragColor.rgb';
              shader.fragmentShader = surfaceGLSL(name, preset) + shader.fragmentShader.replace(
                '#include <colorspace_fragment>',
                `gl_FragColor.rgb = styleSurface(gl_FragColor.rgb, ${albedo});
#include <colorspace_fragment>`,
              );
            }
            if (name === 'ghibli') {
              if ('uTop' in material.uniforms) {
                shader.fragmentShader = shader.fragmentShader.replace('gFbm(uv) + gNoise(uv * 6.0) * 0.06', 'gFbm(uv * 0.65)');
              }
              if ('uLeaf' in material.uniforms) {
                shader.fragmentShader = shader.fragmentShader
                  .replace('smoothstep(0.36, 0.5, l)', 'step(0.42, l)')
                  .replace('smoothstep(0.68, 0.82, l)', 'step(0.70, l)');
              }
            }
            if (name === 'watercolor' && 'uTop' in material.uniforms) {
              shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4(col, 1.0);', `
                col *= 0.88 + 0.24 * gFbm(d.xz * 5.0 + d.y * 2.0);
                gl_FragColor = vec4(col, 1.0);`);
            }
          } else if (cloudMaterials.has(material) && name === 'ghibli') {
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
              float styleCloud = smoothstep(0.50, 0.93, dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)));
              outgoingLight = mix(${colorGLSL(preset.sky[3])}, vec3(1.12), styleCloud);
              #include <opaque_fragment>`);
          }
          if (name === 'ghibli' && ('uTuft' in shader.uniforms
            || (material instanceof THREE.ShaderMaterial && 'uHeight' in shader.uniforms && 'uPlayer' in shader.uniforms))) {
            // Opaque grass stores a mask in alpha; RGB and the final canvas alpha are unchanged.
            shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>',
              'gl_FragColor.a = 0.0;\n#include <colorspace_fragment>');
          }
        };
      }
      material.needsUpdate = true;
    }
    if (!preset) return;
    const palette: Record<string, number> = {
      uTop: preset.sky[0], uMid: preset.sky[1], uHorizon: preset.sky[2], uCloudShade: preset.sky[3],
      uShallow: preset.water[0], uDeep: preset.water[1], uSky: preset.fog[0],
      uGrassDark: preset.grass[0], uGrassMid: preset.grass[1], uGrassLight: preset.grass[2],
      uGrassDry: preset.grass[3], uForestFloor: preset.grass[4],
      cloudTint: name === 'lowpoly-dusk' ? 0xffc3a9 : name === 'watercolor' ? 0xfffaef : 0xffffff,
      ridgeTint: name === 'lowpoly-dusk' ? 0xcf9bc4 : name === 'watercolor' ? 0xe8e3d6 : 0xffffff,
    };
    for (const saved of colors) {
      if (saved.value instanceof THREE.Color && palette[saved.name] !== undefined) saved.value.set(palette[saved.name]);
      if (saved.value instanceof THREE.Vector3) {
        if (saved.name === 'uDark') {
          saved.value.set(...preset.surface.foliageDark);
        }
        if (saved.name === 'uLight') {
          saved.value.set(...preset.surface.foliageLight);
        }
      }
    }
  };
}
