import * as THREE from 'three';
import { ABBEY } from './layout';
import { ABBEY_RECTS, PLAN, planDistance } from './abbey-plan';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t);
};
/** Distance inside the roofed rooms of the abbey, positive indoors. */
export function abbeyInteriorDistance(x: number, z: number): number {
  return -planDistance(x - ABBEY.x, z - ABBEY.z, true);
}
/** Paving and floors: no grass, flowers or scattered props. A small apron surrounds the walls. */
const APRON = 2.6;
const paved = (lx: number, lz: number): boolean => planDistance(lx, lz) < APRON
  || (lx > PLAN.forecourt.x0 && lx < PLAN.forecourt.x1 && lz > PLAN.forecourt.z0 - 4 && lz < PLAN.forecourt.z1);
export function abbeyGroundMask(x: number, z: number): number {
  return +!paved(x - ABBEY.x, z - ABBEY.z);
}
/** Used verbatim by grass blades and flowers; the same rectangles as the plan. */
export const ABBEY_GROUND_MASK_GLSL = `
  float abbeyGroundMask(vec2 p) {
    vec2 q=p-vec2(${ABBEY.x.toFixed(1)},${ABBEY.z.toFixed(1)});
    float m=-1e4;
${[...ABBEY_RECTS.map((r) => [r.x0 - APRON, r.x1 + APRON, r.z0 - APRON, r.z1 + APRON]),
    [PLAN.forecourt.x0, PLAN.forecourt.x1, PLAN.forecourt.z0 - 4, PLAN.forecourt.z1]].map(([x0, x1, z0, z1]) =>
    `    m=max(m,min(${((x1 - x0) / 2).toFixed(2)}-abs(q.x-(${((x0 + x1) / 2).toFixed(2)})),${((z1 - z0) / 2).toFixed(2)}-abs(q.y-(${((z0 + z1) / 2).toFixed(2)}))));`).join('\n')}
    return 1.-step(0.,m);
  }`;
/**
 * How far a point is inside the abbey's rooms: 1 in the church and its chambers, less in the
 * roofed cloister walks, 0 in the open. The weather faces of the walls lie outside every volume.
 * Shaders must declare uAbbeyFloor.
 */
const C = PLAN.cloister, CH = PLAN.chapter;
const VOLUMES: [number, number, number, number, number, number][] = [
  [-PLAN.nave - 0.5, PLAN.nave + 0.5, -PLAN.end + 0.8, PLAN.end - 0.8, PLAN.wallTop, 1],
  [-PLAN.wall - 0.6, PLAN.wall + 0.6, -PLAN.end + 0.8, 28.8, PLAN.aisleTop - 0.2, 1],
  [-PLAN.reach - 0.65, PLAN.reach + 0.65, PLAN.transept[0] - 0.55, PLAN.transept[1] + 0.55, PLAN.wallTop, 1],
  [PLAN.sacristy.x0 + 0.1, PLAN.sacristy.x1, PLAN.sacristy.z0 + 0.1, PLAN.sacristy.z1, 8.6, 1],
  [PLAN.library.x0 + 0.1, PLAN.library.x1 - 0.1, PLAN.library.z0 + 0.1, PLAN.library.z1 + 0.4, 14, 1],
  [C.x1 - 0.4, CH.x - CH.r + 0.6, CH.z - 1.75, CH.z + 1.75, 4.4, 1],
  [C.x0 - 0.1, C.x0 + C.walk + 0.3, C.z0, C.z1 - 0.1, 7.4, 0.75], [C.x1 - C.walk - 0.3, C.x1 - 0.1, C.z0, C.z1 - 0.1, 7.4, 0.75],
  [C.x0, C.x1 - 0.1, C.z0 - 0.1, C.z0 + C.walk + 0.3, 7.4, 0.75], [C.x0, C.x1 - 0.1, C.z1 - C.walk - 0.3, C.z1 - 0.1, 7.4, 0.75],
];
export const ABBEY_INDOORS_GLSL = `
  float abbeyIndoors(vec3 p) {
    vec3 q=p-vec3(${ABBEY.x.toFixed(1)},uAbbeyFloor,${ABBEY.z.toFixed(1)});
    float w=0.0;
${VOLUMES.map(([x0, x1, z0, z1, top, k]) =>
    `    w=max(w,${k.toFixed(2)}*step(abs(q.x-(${((x0 + x1) / 2).toFixed(2)})),${((x1 - x0) / 2).toFixed(2)})*step(abs(q.z-(${((z0 + z1) / 2).toFixed(2)})),${((z1 - z0) / 2).toFixed(2)})*step(q.y,${top.toFixed(1)}));`).join('\n')}
    w=max(w,step(length(q.xz-vec2(${CH.x.toFixed(2)},${CH.z.toFixed(2)})),${(CH.r * 1.04).toFixed(2)})*step(q.y,10.9));
    return w*step(-1.0,q.y);
  }`;
export function abbeyInteriorWeight(p: { x: number; y: number; z: number }): number {
  return smooth(0, 4, abbeyInteriorDistance(p.x, p.z)) *
    smooth(ABBEY.floor - 4, ABBEY.floor - 1, p.y) * (1 - smooth(ABBEY.floor + 28, ABBEY.floor + 36, p.y));
}
/** Inside, the sun is only what the windows admit and the sky is a fraction of the open air's. */
export const ABBEY_LIGHTING = { sun: 0.6, ambient: 0.5 } as const;

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
