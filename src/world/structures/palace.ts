import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { CITY } from '../layout';
import { wallRing, wrapStairs } from './common';

const PALE = 0xe8dfca;
const STONE = 0xcfc5af;
const SLATE = 0x566c89;
/** Shared with the numerical skyline/stair checks. Heights are relative to the summit. */
export const PALACE = { x: CITY.x, z: CITY.z, half: 12, terrace: 38, spire: 101, radius: 79 };
export const PALACE_TOWERS = [
  [-53, -26, 43, 6], [-29, -47, 59, 6.5], [29, -47, 65, 7], [54, -24, 48, 6],
  [-52, 22, 39, 5], [51, 25, 52, 5.5], [-27, 30, 63, 5.8], [27, 31, 47, 5.4],
] as const;

/** Broad palace silhouette: eight subsidiary spires and a 101m central crown. */
export function buildPalace(b: Builder, flags: FlagSpot[]): void {
  const { x, z, half } = PALACE;
  const y = heightAt(x, z);
  const ring = wallRing(b, {
    x, z, radius: PALACE.radius, segments: 12, phase: Math.PI / 12,
    height: 8, thickness: 3.6, towerRadius: 3.6,
    gates: [{ angle: Math.PI, width: 9, height: 7.2 }],
    roof: SLATE, color: STONE, stairs: [1, 4, 7],
  });
  // Main keep remains climbable; none of the subsidiary towers occupies its stair envelope.
  const terrace = y + PALACE.terrace;
  b.box('stone', x, y - 3, z, half * 2, PALACE.terrace + 3, half * 2, 0, PALE);
  addBox(x, z, half, half, 0, terrace);
  wrapStairs(b, x, z, half, 0, y, terrace, 4, 3.4, STONE);
  for (let side = 0; side < 4; side++) {
    for (let k = -4; k <= 4; k++) {
      // The final west flight arrives at the south-west corner.
      if (side === 0 && k < -2) continue;
      const u = k * 2.5;
      const a = side * Math.PI / 2;
      b.box('stone', x + u * Math.cos(a) + (half - 0.3) * Math.sin(a), terrace,
        z - u * Math.sin(a) + (half - 0.3) * Math.cos(a), 1.3, 1.4, 0.65, a, PALE, 0);
      for (const h of [9, 18, 27]) {
        if (k % 2) continue;
        b.box('plain', x + u * Math.cos(a) + (half + 0.02) * Math.sin(a), y + h,
          z - u * Math.sin(a) + (half + 0.02) * Math.cos(a), 1.0, 3.2, 0.1, a, 0x39516b, 0);
      }
    }
  }
  const spire = (tx: number, tz: number, base: number, h: number, r: number, roofH: number): void => {
    b.cyl('stone', tx, base - 2, tz, r, r * 1.12, h + 2, PALE, 14);
    b.cyl('stone', tx, base + h - 1.4, tz, r + 0.8, r, 1.4, STONE, 14);
    b.cone('roof', tx, base + h, tz, r + 1.3, roofH, SLATE, 14);
    addRound(tx, tz, r * 1.12, base + h);
    for (const a of [0, 1.57, 3.14, 4.71]) {
      b.box('plain', tx + Math.sin(a) * (r + 0.02), base + h - 10, tz + Math.cos(a) * (r + 0.02), 1.2, 5.3, 0.12, a, 0x354f6a, 0);
      b.box('stone', tx + Math.sin(a) * (r + 0.6), base, tz + Math.cos(a) * (r + 0.6), 1.1, h * 0.64, 1.4, a, STONE);
    }
    const top = base + h + roofH;
    b.cyl('wood', tx, top - 0.3, tz, 0.09, 0.09, 4.8, 0x514536, 5, 0);
    flags.push({ x: tx, y: top + 3.8, z: tz, color: 0xb94836, size: 2.1 });
  };
  spire(x, z, terrace, 35, 6.5, 28);
  for (const [dx, dz, h, r] of PALACE_TOWERS) spire(x + dx, z + dz, y, h, r, 16 + r);

  // Great hall and two lower wings. Their stone foundations follow the summit shelf.
  for (const [dx, dz, w, d, h, rh] of [[0, -45, 65, 20, 24, 12], [-48, -2, 18, 41, 18, 9], [48, -1, 18, 42, 22, 10]]) {
    b.box('stone', x + dx, y - 4, z + dz, w, h + 4, d, 0, PALE);
    b.prism('stone', x + dx, y + h, z + dz, w, d, rh, 0, PALE);
    b.roof(x + dx, y + h, z + dz, w, d, rh, 0, SLATE, 1);
    addBox(x + dx, z + dz, w / 2, d / 2, 0, (lx) => y + h + Math.max(0, 1 - Math.abs(lx) / (w / 2)) * rh);
    for (let u = -w / 2 + 5; u < w / 2 - 2; u += 7) {
      b.box('plain', x + dx + u, y + 10, z + dz + d / 2 + 0.03, 1.8, 6.5, 0.12, 0, 0x39516b, 0);
      b.box('stone', x + dx + u + 2.5, y, z + dz + d / 2 + 1, 1.4, h * 0.8, 2.4, 0, STONE);
    }
  }
  // Open arcade behind the forecourt: real openings, with overhead-only collision.
  const arcadeZ = z + 48;
  b.shape('stone', archedProfile(-27, 27, y - 1, () => y + 10,
    [-21, -10.5, 0, 10.5, 21].map((u) => ({ x: u, w: 7.5, crown: y + 8 }))), 3, place(x, 0, arcadeZ), PALE);
  for (let u = -26.25; u <= 27; u += 10.5) addBox(x + u, arcadeZ, 1.5, 1.5, 0, y + 10);
  addBox(x, arcadeZ, 27, 1.5, 0, y + 10, y + 7.5);
  // An imposing western gatehouse keeps the courtyard route open.
  for (const dz of [-9, 9]) {
    b.box('stone', x - 76, y - 4, z + dz, 10, 24, 7, 0, PALE);
    b.pyramid('roof', x - 76, y + 20, z + dz, 12, 9, 13, 0, SLATE);
    addBox(x - 76, z + dz, 5, 3.5, 0, y + 20);
  }
  b.box('stone', x - 76, y + 9, z, 10, 9, 11, 0, PALE);
  addBox(x - 76, z, 5, 5.5, 0, y + 18, y + 9);
  orbAt('keep-terrace', x + 9, z - 9, 1.2);
  orbAt('keep-air', x + 19, z + 17, 22);
  orbAt('hall-roof', x, z - 45, 1.2);
  orbAt('castle-wall', ring.towers[5].x, ring.towers[5].z, 1.3);
}
