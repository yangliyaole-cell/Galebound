import { CITY, ABBEY, cityRadiusAt } from '../layout';
import { fbm } from '../noise';
import { GLACIAL_HORNS, GREAT_FALL, VIADUCT } from './plan';

const ease = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t);
};

/** Applied before lake/stream incision and road earthworks. Occupied shelves stay intact. */
export function referenceLandform(x: number, z: number, h: number): number {
  for (const [px, pz] of [[VIADUCT.ax, VIADUCT.az], [VIADUCT.bx, VIADUCT.bz]]) {
    const d = Math.hypot((x - px) / 1.15, z - pz);
    if (d < 83) h = Math.max(h, VIADUCT.deck * (1 - ease(26, 83, d)));
  }
  const dx = x - CITY.x, dz = z - CITY.z, a = Math.atan2(dz, dx);
  const edge = Math.hypot(dx, dz) - cityRadiusAt(a);
  if (edge > 2 && edge < 145 && dz > -50) {
    const face = ease(-50, 35, dz);
    const cut = 56 * ease(3, 30, edge) * (1 - ease(65, 145, edge)) * face;
    h = Math.max(8 + fbm(x / 65, z / 65, 2) * 7, h - cut);
  }
  // A narrow western buttress leaves the abbey floor and south pilgrimage untouched.
  if (x < ABBEY.x - 33 && x > ABBEY.x - 92 && z > -548 && z < -449) {
    const shelf = 1 - ease(35, 53, ABBEY.x - x);
    const ends = ease(-548, -531, z) * (1 - ease(-466, -449, z));
    h = Math.max(h, (ABBEY.floor - 2) * shelf * ends);
  }
  if (z < -805 && x > -970 && x < -275) {
    for (const horn of GLACIAL_HORNS) {
      const r = Math.hypot(x - horn.x, (z - horn.z) * 1.12) / horn.radius;
      if (r < 1) {
        const rib = 0.93 + 0.07 * Math.cos(Math.atan2(z - horn.z, x - horn.x) * 7);
        h += horn.rise * Math.pow(1 - r, 1.3) * rib;
      }
    }
    // Glacial hanging shelf: its end is the continuous head of the 100m cascade.
    const r = Math.hypot((x - GREAT_FALL.x) / 55, (z - (GREAT_FALL.z - 24)) / 61);
    if (r < 1.35) h = Math.max(h, GREAT_FALL.y * (1 - ease(0.65, 1.35, r)));
  }
  return h;
}
