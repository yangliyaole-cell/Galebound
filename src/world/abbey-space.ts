import * as THREE from 'three';
import { ABBEY } from './layout';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t);
};
/** Signed distance to the union of the nave and both transepts, positive inside. */
export function abbeyInteriorDistance(x: number, z: number): number {
  const dx = Math.abs(x - ABBEY.x), dz = z - ABBEY.z;
  return Math.max(Math.min(18 - dx, 37 - Math.abs(dz)), Math.min(29 - dx, 9 - Math.abs(dz + 9)));
}
export function abbeyGroundMask(x: number, z: number): number {
  const dx = Math.abs(x - ABBEY.x), dz = z - ABBEY.z;
  return +!(Math.min(19.5 - dx, 38.5 - Math.abs(dz)) >= 0 ||
    Math.min(33.5 - dx, 10.5 - Math.abs(dz + 9)) >= 0 ||
    (dx <= 5 && dz >= 36 && dz <= 43));
}
/** Used verbatim by grass blades and flowers; covers nave, transepts and porch. */
export const ABBEY_GROUND_MASK_GLSL = `
  float abbeyGroundMask(vec2 p) {
    vec2 q=p-vec2(${ABBEY.x.toFixed(1)},${ABBEY.z.toFixed(1)});
    float nave=min(19.5-abs(q.x),38.5-abs(q.y));
    float wings=min(33.5-abs(q.x),10.5-abs(q.y+9.));
    float porch=min(5.-abs(q.x),min(q.y-36.,43.-q.y));
    return 1.-step(0.,max(nave,max(wings,porch)));
  }`;
export function abbeyInteriorWeight(p: { x: number; y: number; z: number }): number {
  return smooth(0, 5, abbeyInteriorDistance(p.x, p.z)) *
    smooth(ABBEY.floor - 4, ABBEY.floor - 1, p.y) * (1 - smooth(ABBEY.floor + 26, ABBEY.floor + 34, p.y));
}
/** Small opt-in hook: reuse the existing lights and restore exact outdoor settings. */
export function createAbbeyLighting(sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight, fog: THREE.Fog): {
  update: (dt: number, player: THREE.Vector3) => void;
  readonly weight: number;
} {
  const sunIntensity = sun.intensity, ambientIntensity = hemisphere.intensity;
  const sky = hemisphere.color.clone(), ground = hemisphere.groundColor.clone(), haze = fog.color.clone();
  const warmSky = new THREE.Color(0xffd9b3), warmGround = new THREE.Color(0x796556);
  let weight = 0;
  return {
    get weight() { return weight; },
    update(dt, player) {
      const target = abbeyInteriorWeight(player);
      weight += (target - weight) * (1 - Math.exp(-Math.max(0, dt) * 3));
      if (target === 0 && weight < 0.0001) weight = 0;
      const scale = 1 - weight * 0.55;
      sun.intensity = sunIntensity * scale; hemisphere.intensity = ambientIntensity * scale;
      hemisphere.color.copy(sky).lerp(warmSky, weight * 0.5);
      hemisphere.groundColor.copy(ground).lerp(warmGround, weight * 0.7);
      fog.color.copy(haze).multiplyScalar(1 - weight * 0.14);
    },
  };
}
