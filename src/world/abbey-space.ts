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
  return +!(Math.min(21 - dx, 40 - Math.abs(dz)) >= 0 ||
    Math.min(35 - dx, 12 - Math.abs(dz + 9)) >= 0 ||
    (dx <= 6.5 && dz >= 35 && dz <= 44));
}
/** Used verbatim by grass blades and flowers; covers nave, transepts and porch. */
export const ABBEY_GROUND_MASK_GLSL = `
  float abbeyGroundMask(vec2 p) {
    vec2 q=p-vec2(${ABBEY.x.toFixed(1)},${ABBEY.z.toFixed(1)});
    float nave=min(21.-abs(q.x),40.-abs(q.y));
    float wings=min(35.-abs(q.x),12.-abs(q.y+9.));
    float porch=min(6.5-abs(q.x),min(q.y-35.,44.-q.y));
    return 1.-step(0.,max(nave,max(wings,porch)));
  }`;
export function abbeyInteriorWeight(p: { x: number; y: number; z: number }): number {
  return smooth(0, 5, abbeyInteriorDistance(p.x, p.z)) *
    smooth(ABBEY.floor - 4, ABBEY.floor - 1, p.y) * (1 - smooth(ABBEY.floor + 26, ABBEY.floor + 34, p.y));
}
export const ABBEY_LIGHTING = { sun: 0.22, ambient: 0.38 } as const;

/** Scope attenuation to one render. Capture the active style, never a boot-time
 * preset; restore in finally so style switches and outdoor frames stay intact. */
export function createAbbeyLighting(sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight,
  fog: THREE.Fog | (() => THREE.Fog | null)): {
  update: (dt: number, player: THREE.Vector3) => void;
  restore: () => void;
  readonly weight: number;
} {
  const warmSky = new THREE.Color(0xffd9b3), warmGround = new THREE.Color(0x796556);
  let weight = 0, undo: (() => void) | undefined;
  const restore = (): void => { undo?.(); undo = undefined; };
  return {
    get weight() { return weight; }, restore,
    update(dt, player) {
      restore();
      const target = abbeyInteriorWeight(player);
      weight += (target - weight) * (1 - Math.exp(-Math.max(0, dt) * 3));
      if (target === 0 && weight < 0.0001) weight = 0;
      if (weight === 0) return;
      const sunIntensity = sun.intensity, ambientIntensity = hemisphere.intensity;
      const sky = hemisphere.color.clone(), ground = hemisphere.groundColor.clone();
      const activeFog = typeof fog === 'function' ? fog() : fog, haze = activeFog?.color.clone();
      undo = () => {
        sun.intensity = sunIntensity; hemisphere.intensity = ambientIntensity;
        hemisphere.color.copy(sky); hemisphere.groundColor.copy(ground);
        if (activeFog && haze) activeFog.color.copy(haze);
      };
      sun.intensity *= 1 - weight * (1 - ABBEY_LIGHTING.sun);
      hemisphere.intensity *= 1 - weight * (1 - ABBEY_LIGHTING.ambient);
      hemisphere.color.lerp(warmSky, weight * 0.3);
      hemisphere.groundColor.lerp(warmGround, weight * 0.5);
      activeFog?.color.multiplyScalar(1 - weight * 0.14);
    },
  };
}
