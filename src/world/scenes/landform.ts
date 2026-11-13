import { CITY, ABBEY, cityRadiusAt } from '../layout';
import { fbm } from '../noise';
import { GLACIAL_HORNS, GLACIER_SPINE, GREAT_FALL, VIADUCT } from './plan';
import { hornMetric, rockRelief, glacierSurvey } from './geology';

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
      const r = hornMetric(x, z, horn.x, horn.z, horn.radius);
      if (r < 1) {
        h += horn.rise * Math.pow(1 - r, 0.92);
      }
    }
    // Glacial hanging shelf: its end is the continuous head of the 100m cascade.
    const r = Math.hypot((x - GREAT_FALL.x) / 55, (z - (GREAT_FALL.z - 24)) / 61);
    if (r < 1.35) h = Math.max(h, GREAT_FALL.y * (1 - ease(0.65, 1.35, r)));
    if (x < -730) {
      const flow = glacierSurvey(x, z);
      const first = GLACIER_SPINE[0], second = GLACIER_SPINE[1], dx = second[0] - first[0], dz = second[1] - first[1];
      const head = ((x - first[0]) * dx + (z - first[1]) * dz) / Math.hypot(dx, dz);
      const blend = (1 - ease(flow.width * 0.9, flow.width * 1.6, flow.distance)) * ease(-8, 0, head);
      const bed = flow.level - 5 + 14 * Math.min(1, (flow.distance / flow.width) ** 2);
      h += (bed - h) * blend;
    }
  }
  // Angular joints and ledges are below the grid's collision surface too.
  if (x < -340 && z < -745 && h > 160) h += rockRelief(x, h, z) * 1.6;
  return h;
}
