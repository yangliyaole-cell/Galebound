import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from './glsl';
import { shared } from './uniforms';

// Four flat tones give the hand-painted, cel-shaded look.
const ramp = new THREE.DataTexture(new Uint8Array([105, 175, 230, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

export interface ToonOptions {
  vertexColors?: boolean;
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
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float rimLight = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += vec3(0.6, 0.75, 0.95) * rimLight * ${rim.toFixed(3)};
        #include <opaque_fragment>`,
      );
    };
  }
  return mat;
}

function patch(mat: THREE.MeshToonMaterial, o: ToonOptions): void {
  const sway = o.sway ?? 0;
  const size = o.textureSize ?? 2;
  mat.customProgramCacheKey = () =>
    `world-${sway}-${o.leafTint ? 1 : 0}-${o.texture ? size : 0}`;
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
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldP;
        varying vec3 vWorldN;
        uniform sampler2D uTex;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
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
