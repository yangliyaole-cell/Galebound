import { fbm, seededRandom } from '../noise';
import { GLACIER_SPINE } from './plan';

export const ease = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t);
};

/** Piecewise planar buttresses and asymmetric aretes, never a radial cosine pattern. */
export function hornMetric(x: number, z: number, px: number, pz: number, radius: number): number {
  const u = (x - px + (fbm(x/43+px*.01,z/51,3)-.5)*9) / radius;
  const v = (z - pz + (fbm(x/57,z/39+pz*.01,3)-.5)*8) / radius;
  const a = u + v * 0.24, b = v * 1.03 - u * 0.19;
  const au=Math.sqrt(a*a+.0002),bv=Math.sqrt(b*b+.0002);
  const left=au+bv*.37,right=bv*.94+au*.18;
  return .5*(left+right+Math.sqrt((left-right)**2+.0007));
}

/** An irregular dipping bed sequence. Slope changes are geometric, not painted bands. */
export function rockRelief(x: number, y: number, z: number): number {
  const warp = (fbm(x / 37 + 8, z / 31 + y / 53, 3) - 0.5) * 5;
  const bed = (y + x * 0.16 - z * 0.09 + warp) / 11.7;
  const t = bed - Math.floor(bed);
  const ledge = ease(0.01, 0.12, t) - ease(0.72, 0.98, t);
  const joint = Math.abs(fbm(x / 18 + y / 200, z / 21, 3) - 0.5);
  return ledge * 1.9 - (1 - ease(0.008, 0.041, joint)) * 2.8 + (fbm(x / 8, z / 9 + y / 17, 2) - 0.5) * 0.8;
}

export function glacierSurvey(x: number, z: number): { distance: number; width: number; level: number; t: number } {
  let best = Infinity, width = 0, level = 0, progress = 0;
  for (let i = 0; i < GLACIER_SPINE.length - 1; i++) {
    const a = GLACIER_SPINE[i], b = GLACIER_SPINE[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) { best = d; width = a[2] + (b[2] - a[2]) * t; level = a[3] + (b[3] - a[3]) * t; progress = (i + t) / 5; }
  }
  return { distance: best, width, level, t: progress };
}

/** Independent fracture polylines: unequal spacing, length, skew and branching. */
const rand = seededRandom(93248);
export const ICE_FRACTURES = Array.from({ length: 19 }, (_, i) => {
  const t = (i + 0.22 + rand() * 0.55) / 19 * 5, k = Math.min(4, Math.floor(t));
  const a = GLACIER_SPINE[k], b = GLACIER_SPINE[k + 1], f = t - k;
  const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), w = a[2] * (0.4 + rand() * 0.8);
  const skew = (rand() - 0.5) * 0.9, shift = (rand() - 0.5) * 12;
  return { ax: x + dz / len * w * 0.52 + shift, az: z - dx / len * w * 0.52,
    bx: x - dz / len * w * 0.48 + shift + dx / len * w * skew, bz: z + dx / len * w * 0.48 + dz / len * w * skew,
    width: 0.55 + rand() * 0.8, depth: 1.2 + rand() * 2.4 };
});

export function iceFracture(x: number, z: number): { depth: number; blue: number } {
  let depth = 0, blue = 0;
  for (const f of ICE_FRACTURES) {
    const dx = f.bx - f.ax, dz = f.bz - f.az;
    const t = Math.max(0, Math.min(1, ((x - f.ax) * dx + (z - f.az) * dz) / (dx * dx + dz * dz)));
    const bend = (fbm(x / 6 + 19, z / 7, 2) - 0.5) * 1.5;
    const d = Math.max(0, Math.hypot(x - f.ax - dx * t, z - f.az - dz * t) + bend);
    const amount = 1 - ease(0, f.width, d);
    depth = Math.max(depth, amount * f.depth); blue = Math.max(blue, 1 - ease(f.width * 0.3, f.width * 2, d));
  }
  return { depth, blue };
}

export function snowRetention(x: number, y: number, z: number, normalY: number, normalZ=0, concavity=0): number {
  const sheltered=Math.max(-1,Math.min(1,concavity))*.17-normalZ*.11;
  const drift=(fbm(x/37+4,z/43,3)-.5)*.13;
  const line=264+(fbm(x/91+4,z/77,3)-.5)*68-sheltered*75;
  return ease(line-42,line+46,y)*ease(.23,.9,normalY+sheltered+drift)*ease(.16,.43,normalY);
}
