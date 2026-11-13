import * as THREE from 'three';
import { shared } from '../render/uniforms';

export interface FlagSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  size?: number;
  /** A vertical heraldic banner pinned along its top bar. */
  hanging?: boolean;
  rotation?: number;
}

/** Pennants that stream downwind. All of them are one instanced mesh. */
export function createFlags(spots: FlagSpot[]): THREE.Mesh {
  const plane = new THREE.PlaneGeometry(1, 1, 8, 3).translate(0.5, 0, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  geo.setIndex(plane.index);
  const base = new Float32Array(spots.length * 4);
  const tint = new Float32Array(spots.length * 3);
  const hang = new Float32Array(spots.length * 2);
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    base.set([s.x, s.y, s.z, s.size ?? 1], i * 4);
    c.set(s.color);
    tint.set([c.r, c.g, c.b], i * 3);
    hang.set([s.hanging ? 1 : 0, s.rotation ?? 0], i * 2);
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.setAttribute('aHang', new THREE.InstancedBufferAttribute(hang, 2));
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
      attribute vec2 aHang;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      uniform float uTime;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vBanner;
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
        if (aHang.x > .5) {
          float fall = .5-position.y;
          float flap = sin(uTime*2.1 + fall*6. + aBase.x)*fall*fall*(.035+.065*uWindStrength)*size;
          vec3 local=vec3((position.x-.5)*size*.8, -fall*size*1.65, flap);
          world=aBase.xyz+vec3(local.x*cos(aHang.y)+local.z*sin(aHang.y),local.y,-local.x*sin(aHang.y)+local.z*cos(aHang.y));
        }
        vUv=uv; vBanner=aHang.x;
        vColor = aTint * (0.82 + 0.25 * sin(phase + 1.0) * along);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vBanner;
      void main() {
        vec3 color=vColor;
        if(vBanner>.5){
          vec2 p=(vUv-vec2(.5,.56))*vec2(1.,1.65);
          float stem=step(abs(p.x),.027)*step(abs(p.y),.23);
          float petals=1.-smoothstep(.07,.085,length(vec2(abs(p.x)-.09,p.y-.07)));
          float crown=(1.-smoothstep(.045,.06,length(vec2(p.x,p.y-.2))));
          float belt=step(abs(p.y+.04),.023)*step(abs(p.x),.16);
          float edge=step(min(vUv.x,1.-vUv.x),.023)+step(vUv.y,.018);
          color=mix(color,vec3(.85,.64,.24),clamp(max(max(stem,petals),max(crown,belt))+edge,0.,1.));
        }
        gl_FragColor = vec4(color, 1.0);
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
