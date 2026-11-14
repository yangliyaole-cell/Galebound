import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read x/z of a few named places from src/world/layout.ts (falls back to the 394aeac values). */
export function layoutPlaces(repo) {
  const fallback = { START: [0, 1250], CITY: [560, -380], ABBEY: [-1535, -1477], WINDMILL: [940, 760], LAKE: [-600, -180], PLATEAU: [1660, -900], FOREST: [-1050, 1050] };
  let src = '';
  try { src = readFileSync(join(repo, 'src/world/layout.ts'), 'utf8'); } catch { return fallback; }
  const out = { ...fallback };
  for (const k of Object.keys(fallback)) {
    const m = src.match(new RegExp(`export const ${k}\\s*=\\s*\\{[^}]*?\\bx:\\s*(-?[\\d.]+)[^}]*?\\bz:\\s*(-?[\\d.]+)`));
    if (m) out[k] = [Number(m[1]), Number(m[2])];
  }
  return out;
}

/** A view is either { native: true } (the game's own shot camera, query params x,z,camyaw,campitch,dist)
 * or an eye/target pair in world metres; { orbit } places the eye relative to a point on the terrain. */
export function resolveView(name, repo, custom) {
  const P = layoutPlaces(repo);
  if (custom.eye && custom.target) return { name: 'custom', eye: custom.eye, target: custom.target, fov: custom.fov ?? 55 };
  switch (name) {
    case 'spawn': return { name, native: true };
    case 'aerial': return { name, eye: [560, 487, 50], target: [560, 157, -380], fov: 55 }; // same as the earlier smoke test
    case 'city': return { name, orbit: { at: P.CITY, back: [0, 1], dist: 380, up: 150, lookUp: 70 }, fov: 55 };
    case 'abbey': return { name, orbit: { at: P.ABBEY, back: [0.6, 0.8], dist: 150, up: 45, lookUp: 12 }, fov: 55 };
    case 'windmill': return { name, orbit: { at: P.WINDMILL, back: [0, 1], dist: 90, up: 22, lookUp: 12 }, fov: 55 };
    case 'lake': return { name, orbit: { at: P.LAKE, back: [0, 1], dist: 420, up: 120, lookUp: 0 }, fov: 55 };
    case 'plateau': return { name, orbit: { at: P.PLATEAU, back: [0, 1], dist: 260, up: 70, lookUp: 20 }, fov: 55 };
    default: throw new Error(`unknown view "${name}" (spawn|aerial|city|abbey|windmill|lake|plateau, or --eye x,y,z --target x,y,z)`);
  }
}
export const VIEW_NAMES = ['spawn', 'aerial', 'city', 'abbey', 'windmill', 'lake', 'plateau'];
