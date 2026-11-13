import * as THREE from 'three';
import { GREAT_FALL, SHOWCASE_FALL, PLUNGE_POOL } from './scenes/plan';

/** Separate local levels keep the alpine basins above sea level. */
export const ALPINE_LAKES = [
  { x: -744, z: -722, rx: 45, rz: 31, level: 94 },
  { x: -710, z: -639, rx: 38, rz: 28, level: 62 },
  { x: -674, z: -561, rx: 34, rz: 26, level: 32 },
  { x: -662, z: -434, rx: 32, rz: 23, level: 13 },
];
export const MOUNTAIN_HAMLETS = [
  { x: -626, z: -713, n: 5 }, { x: -561, z: -641, n: 6 },
  { x: -770, z: -400, n: 5 }, { x: -478, z: -432, n: 4 },
];
export const alpineLakeMetric = (x: number, z: number, l: typeof ALPINE_LAKES[number]): number => {
  const a = Math.atan2((z - l.z) / l.rz, (x - l.x) / l.rx);
  return Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz) / (1 + 0.09 * Math.sin(3 * a + l.x) + 0.05 * Math.cos(5 * a));
};
// Slow reaches spill over three rock steps, then curve round the abbey cliff into Mirror Lake.
const controls = [
  [GREAT_FALL.x, GREAT_FALL.y, GREAT_FALL.z - 18], [GREAT_FALL.x, GREAT_FALL.y, GREAT_FALL.z],
  [-750, 116, -792], [-745, 94, -745], [-744, 94, -722], [-731, 94, -694],
  [-730, 63, -670], [-710, 62, -639], [-699, 62, -615], [-694, 33, -594],
  [-674, 32, -561], [-692, 31, -521], [-696, 26, -487], [-683, 14, -469],
  [-662, 13, -434], [-639, 13, -412], [-621, 4, -395], [-577, 1, -367], [-520, 0, -346],
];
export const ALPINE_STREAM = new THREE.CatmullRomCurve3(controls.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal').getPoints(130);
export const SHOWCASE_STREAM = new THREE.CatmullRomCurve3([
  [-860,270,-800],[-850,220,-773],[-838,173,-754],
  [SHOWCASE_FALL.x,SHOWCASE_FALL.y,SHOWCASE_FALL.z],
  [SHOWCASE_FALL.bx,SHOWCASE_FALL.bottom,SHOWCASE_FALL.bz],[-753,62,-662],[-731,62,-653],
].map(([x,y,z])=>new THREE.Vector3(x,y,z)),false,'centripetal').getPoints(70);

export function showcaseChannel(x:number,z:number): { distance:number; level:number } {
  let distance=Infinity,level=0;
  if(x < -885 || x > -715 || z < -820 || z > -635)return {distance,level};
  for(let i=0;i<SHOWCASE_STREAM.length-1;i++){
    const a=SHOWCASE_STREAM[i],b=SHOWCASE_STREAM[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
    const d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
    if(d<distance){distance=d;level=a.y+(b.y-a.y)*t;}
  }
  return {distance,level};
}
export function alpineChannel(x: number, z: number): { distance: number; level: number } {
  let best = Infinity, level = 0;
  if (x < -835 || x > -480 || z < -870 || z > -310) return { distance: best, level };
  for (let i = 0; i < ALPINE_STREAM.length - 1; i++) {
    const a = ALPINE_STREAM[i], b = ALPINE_STREAM[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best) { best = d; level = a.y + (b.y - a.y) * t; }
  }
  return { distance: best, level };
}
/** Local water level is also consumed by the player; alpine swimming works normally. */
export function waterLevelAt(x: number, z: number): number {
  if (x > -480 || x < -885 || z > -310 || z < -870) return 0;
  for (const l of ALPINE_LAKES) if (alpineLakeMetric(x, z, l) < 1.12) return l.level;
  if(Math.hypot((x-PLUNGE_POOL.x)/PLUNGE_POOL.rx,(z-PLUNGE_POOL.z)/PLUNGE_POOL.rz)<1.05)return PLUNGE_POOL.level;
  const branch=showcaseChannel(x,z);if(branch.distance<7)return branch.level;
  const channel = alpineChannel(x, z);
  return channel.distance < 7 ? channel.level : 0;
}
export const WATERFALLS = [
  GREAT_FALL,
  SHOWCASE_FALL,
  { x: -731, z: -684, y: 94, bx: -729, bz: -667, bottom: 63, width: 12 },
  { x: -699, z: -609, y: 62, bx: -691, bz: -587, bottom: 33, width: 10 },
  { x: -696, z: -493, y: 27, bx: -683, bz: -466, bottom: 14, width: 8 },
  // The abbey's own cascade falls down the exposed western rock shelf.
  { x: -638, z: -493, y: 64, bx: -657, bz: -469, bottom: 14, width: 8 },
];
