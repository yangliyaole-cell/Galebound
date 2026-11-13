import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from './glsl';
import { LOD_VERTEX, LOD_FRAGMENT, LOD_DISCARD } from './lod';
import { shared } from './uniforms';
import { pbrTier } from './pbr/config';
import { applyPbr, registerPbr } from './pbr/material';
import type { PbrKind } from './pbr/library';

// Four flat tones give the hand-painted, cel-shaded look.
const ramp = new THREE.DataTexture(new Uint8Array([105, 175, 230, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

export interface ToonOptions {
  /** Cinematic alternative; all other styles keep the original Toon material. */
  pbr?: PbrKind;
  vertexColors?: boolean;
  lod?: boolean;
  relief?: number;
  detailRange?: number;
  doubleSided?: boolean;
  /** Bend with the wind, more the higher a vertex is above the object's origin. */
  sway?: number;
  /** Per-instance tint applies only where the `aLeaf` attribute is 1. */
  leafTint?: boolean;
  /** Tiling texture projected from world position, so no UVs are needed. */
  texture?: THREE.Texture;
  /** Metres covered by one repeat of the texture. */
  textureSize?: number;
  /** Skip the world shading (cloud shadows); for things that move with the player. */
  plain?: boolean;
  /** Sky-coloured light on edges facing away from the camera, 0..1. Needs `plain`. */
  rim?: number;
}

/** Plain cel-shaded material, e.g. for characters. */
export function toon(color: number, options: ToonOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: ramp,
    vertexColors: options.vertexColors ?? false,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (!options.plain) patch(mat, options);
  else if (options.rim) {
    const rim = options.rim;
    mat.customProgramCacheKey = () => `rim-${rim}`;
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <opaque_fragment>',
        `float rimLight = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += vec3(0.6, 0.75, 0.95) * rimLight * ${rim.toFixed(3)};
        #include <opaque_fragment>`,
      );
    };
  }
  if (options.pbr && pbrTier() !== 'low') {
    const standard = new THREE.MeshStandardMaterial({ color, vertexColors: options.vertexColors ?? false, side: mat.side });
    patch(standard, { ...options, texture: undefined, relief: 0 });
    applyPbr(standard, options.pbr);
    registerPbr(mat, standard);
  }
  return mat;
}

function patch(mat: THREE.MeshToonMaterial | THREE.MeshStandardMaterial, o: ToonOptions): void {
  const sway = o.sway ?? 0;
  const size = o.textureSize ?? 2;
  mat.customProgramCacheKey = () =>
    `world-${sway}-${o.leafTint ? 1 : 0}-${o.texture ? size : 0}-${o.lod}-${o.relief ?? 0}-${o.detailRange ?? 0}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uCloudDrift: shared.uCloudDrift,
      uWindDir: shared.uWindDir,
      uWindStrength: shared.uWindStrength,
      uWindTravel: shared.uWindTravel,
      uTime: shared.uTime,
      uTex: { value: o.texture ?? null },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldP;
        varying vec3 vWorldN;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform vec2 uWindTravel;
        uniform float uTime;
        ${o.leafTint ? 'attribute float aLeaf;' : ''}
        ${o.lod ? LOD_VERTEX : ''}
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_vertex>',
        o.leafTint
          ? `vColor = vec4(color, 1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aLeaf);
        #endif`
          : '#include <color_vertex>',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${o.lod ? 'vLodBand = aLodBand;' : ''}
        mat4 worldMat = modelMatrix;
        #ifdef USE_INSTANCING
          worldMat = modelMatrix * instanceMatrix;
        #endif
        vec4 worldP = worldMat * vec4(transformed, 1.0);
        vWorldP = worldP.xyz;
        vWorldN = normalize(mat3(worldMat) * normal);
        ${
          sway > 0
            ? `vec3 origin = worldMat[3].xyz;
        float lift = max(worldP.y - origin.y, 0.0);
        float roll = gNoise((origin.xz - uWindTravel) * 0.03);
        float flutter = sin(uTime * 2.6 + worldP.x * 0.9 + worldP.z * 1.1 + worldP.y * 0.7);
        vec2 push = uWindDir * uWindStrength * lift * ${sway.toFixed(3)} * (0.35 + roll + 0.16 * flutter);
        mat3 basis = mat3(worldMat);
        transformed += (vec3(push.x, 0.0, push.y) * basis) / dot(basis[0], basis[0]);`
            : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${o.relief && o.texture ? `
        vec3 reliefN = normalize(vWorldN);
        vec2 reliefAlong = normalize(vec2(-reliefN.z, reliefN.x) + vec2(1e-5, 0.0));
        vec2 reliefUV = abs(reliefN.y) > 0.8 ? vWorldP.xz : vec2(dot(vWorldP.xz, reliefAlong), vWorldP.y * (abs(reliefN.y) > 0.25 ? 1.45 : 1.0));
        float reliefH = texture2D(uTex, reliefUV / ${size.toFixed(2)}).r * ${o.relief.toFixed(3)} * (1.0 - smoothstep(70.0, 200.0, distance(cameraPosition, vWorldP)));
        vec3 reliefDx = dFdx(-vViewPosition), reliefDy = dFdy(-vViewPosition);
        vec3 reliefR1 = cross(reliefDy, normal), reliefR2 = cross(normal, reliefDx);
        float reliefDet = dot(reliefDx, reliefR1);
        normal = normalize(abs(reliefDet) * normal - sign(reliefDet) * (dFdx(reliefH) * reliefR1 + dFdy(reliefH) * reliefR2));` : ''}
      `)
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldP;
        varying vec3 vWorldN;
        uniform sampler2D uTex;
        ${o.lod ? LOD_FRAGMENT : ''}
        ${NOISE_GLSL}
        ${CLOUD_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${o.lod ? LOD_DISCARD : ''}
        ${o.detailRange ? `float detailCoverage = 1.0 - smoothstep(${(o.detailRange - 30).toFixed(1)}, ${o.detailRange.toFixed(1)}, distance(cameraPosition, vWorldP));
        if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= detailCoverage) discard;` : ''}
        ${
          o.texture
            ? `vec3 wn = normalize(vWorldN);
        vec2 along = normalize(vec2(-wn.z, wn.x) + vec2(1e-5, 0.0));
        vec2 suv = abs(wn.y) > 0.8
          ? vWorldP.xz
          : vec2(dot(vWorldP.xz, along), vWorldP.y * (abs(wn.y) > 0.25 ? 1.45 : 1.0));
        diffuseColor.rgb *= texture2D(uTex, suv / ${size.toFixed(2)}).rgb;`
            : ''
        }
        diffuseColor.rgb *= cloudShadow(vWorldP.xz);`,
      );
  };
}

/** Dark hull drawn behind a mesh to give it an inked outline. */
export function outlineMaterial(width: number, color = 0x1b1722): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.customProgramCacheKey = () => `outline-${width}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`,
    );
  };
  return mat;
}
