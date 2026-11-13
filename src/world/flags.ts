import * as THREE from 'three';
import { shared } from '../render/uniforms';

export interface FlagSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  size?: number;
}

/** Pennants that stream downwind. All of them are one instanced mesh. */
export function createFlags(spots: FlagSpot[]): THREE.Mesh {
  const plane = new THREE.PlaneGeometry(1, 1, 8, 3).translate(0.5, 0, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', plane.attributes.position);
  geo.setIndex(plane.index);
  const base = new Float32Array(spots.length * 4);
  const tint = new Float32Array(spots.length * 3);
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    base.set([s.x, s.y, s.z, s.size ?? 1], i * 4);
    c.set(s.color);
    tint.set([c.r, c.g, c.b], i * 3);
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.instanceCount = spots.length;

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aBase;
      attribute vec3 aTint;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      uniform float uTime;
      varying vec3 vColor;
      void main() {
        float along = position.x;
        float size = aBase.w;
        vec3 down = vec3(uWindDir.x, 0.0, uWindDir.y);
        vec3 side = vec3(-uWindDir.y, 0.0, uWindDir.x);
        float phase = uTime * (4.0 + 5.0 * uWindStrength) - along * 5.0 + aBase.x;
        float wave = sin(phase) * along * (0.1 + 0.16 * uWindStrength);
        // The fly end droops when the wind drops, and tapers to a point.
        float droop = along * along * (1.0 - uWindStrength) * 0.75;
        float taper = 1.0 - along * 0.55;
        vec3 world = aBase.xyz + (down * along * 2.4 + side * wave) * size
          + vec3(0.0, (position.y * 1.1 * taper - droop + cos(phase) * along * 0.06) * size, 0.0);
        vColor = aTint * (0.82 + 0.25 * sin(phase + 1.0) * along);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, {
    uWindDir: shared.uWindDir,
    uWindStrength: shared.uWindStrength,
    uTime: shared.uTime,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
