import * as THREE from 'three';
import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { detailCounters, structureDetail } from '../structure-detail';
import { CITY } from '../layout';
import { keepWindowDetail, palaceTowerMasonry } from './palace-detail';
import { wallRing, wrapStairs } from './common';

const PALE = 0xe8dfca;
const STONE = 0xcfc5af;
const SLATE = 0x566c89;
export const keepWindowRecesses: { x: number; y: number; z: number; normalX: number; normalZ: number; depth: number }[] = [];
/** Shared with the numerical skyline/stair checks. Heights are relative to the summit. */
export const PALACE = { x: CITY.x, z: CITY.z, half: 12, terrace: 38, spire: 101, radius: 79 };
export const PALACE_TOWERS = [
  [-53, -26, 43, 6], [-29, -47, 59, 6.5], [29, -47, 65, 7], [54, -24, 48, 6],
  [-52, 22, 39, 5], [51, 25, 52, 5.5], [-27, 40, 63, 5.8], [27, 40, 47, 5.4],
] as const;

/**
 * The castle's ranges, relative to the keep. `along` is the ridge direction; heights are walls to
 * the eaves (h) and roof rise (rh). Shared with the court dressing (dormers, turrets).
 */
export interface PalaceRange { id: string; x: number; z: number; len: number; depth: number; h: number; rh: number; along: 'x' | 'z' }
export const PALACE_RANGES: PalaceRange[] = [
  { id: 'hall', x: 0, z: -45, len: 65, depth: 20, h: 24, rh: 11, along: 'x' },
  { id: 'north-west', x: -41.25, z: -44, len: 17.5, depth: 18, h: 18, rh: 8, along: 'x' },
  { id: 'north-east', x: 41.25, z: -44, len: 17.5, depth: 18, h: 20, rh: 8, along: 'x' },
  { id: 'west-wing', x: -47, z: 2.5, len: 75, depth: 16, h: 18, rh: 8, along: 'z' },
  { id: 'east-wing', x: 47, z: 2.5, len: 75, depth: 16, h: 22, rh: 9, along: 'z' },
  { id: 'south-west', x: -38.5, z: 46, len: 23, depth: 12, h: 14, rh: 6, along: 'x' },
  { id: 'south-east', x: 38.5, z: 46, len: 23, depth: 12, h: 14, rh: 6, along: 'x' },
];

/** A castle range: stone walls on a plinth, a slate roof along its length, rows of dressed windows. */
function range(b: Builder, cx: number, y: number, cz: number, r: PalaceRange): void {
  const alongX = r.along === 'x', { len, depth, h, rh } = r;
  const w = alongX ? len : depth, d = alongX ? depth : len, rot = alongX ? 0 : Math.PI / 2;
  b.box('stone', cx, y - 4, cz, w, h + 4, d, 0, PALE);
  b.prism('stone', cx, y + h, cz, depth, len, rh, alongX ? Math.PI / 2 : 0, PALE);
  b.roof(cx, y + h, cz, depth, len, rh, alongX ? Math.PI / 2 : 0, SLATE, 1);
  addBox(cx, cz, w / 2, d / 2, 0, (lx, lz) => y + h + Math.max(0, 1 - Math.abs(alongX ? lz : lx) / (depth / 2)) * rh);
  // Position on a long face: u along the range, side -1/1, offset out from the wall.
  const at = (u: number, side: number, out: number): [number, number] => alongX
    ? [cx + u, cz + side * (depth / 2 + out)] : [cx + side * (depth / 2 + out), cz + u];
  const storeys = Math.max(2, Math.floor((h - 3) / 6.5));
  for (const side of [-1, 1]) {
    // Plinth, string courses and a cornice band along the whole face.
    const [px, pz] = at(0, side, 0.12);
    for (const [v, t] of [[-0.1, 0.5], [h - 0.6, 0.45]] as const) b.box('stone', px, y + v, pz, alongX ? len + 0.3 : 0.32, t, alongX ? 0.32 : len + 0.3, 0, STONE, 0);
    for (let u = -len / 2 + 4; u < len / 2 - 2.5; u += 5) {
      for (let k = 0; k < storeys; k++) {
        const wy = y + 3.2 + k * 6.5, tall = k === storeys - 1 ? 2.6 : 3.4;
        const [wx, wz] = at(u, side, 0.03);
        b.box('plain', wx, wy, wz, 1.5, tall, 0.1, rot, 0x3d5468, 0);
        b.detail(() => {
          const [fx, fz] = at(u, side, 0.09);
          for (const sign of [-1, 1]) {
            const ox = alongX ? sign * 0.92 : 0, oz = alongX ? 0 : -sign * 0.92;
            b.block(fx + ox, wy - 0.15, fz + oz, 0.32, tall + 0.3, 0.22, rot, STONE);
          }
          b.block(fx, wy + tall, fz, 2.3, 0.34, 0.3, rot, STONE);
          b.block(fx, wy - 0.32, fz, 2.0, 0.2, 0.36, rot, STONE);
          const [mx, mz] = at(u, side, 0.07);
          b.box('stone', mx, wy, mz, alongX ? 0.12 : 0.1, tall, alongX ? 0.1 : 0.12, 0, PALE, 0);
          detailCounters.palaceWindows++;
        });
      }
      for (let k = 1; k < storeys; k++) {
        const [sx, sz] = at(u + 2.5, side, 0.1);
        b.box('stone', sx, y + k * 6.5 - 0.2, sz, alongX ? 5 : 0.28, 0.3, alongX ? 0.28 : 5, 0, STONE, 0);
      }
    }
    // Shallow buttresses between bays, stepping in near the eaves.
    for (let u = -len / 2 + 6.5; u < len / 2 - 3; u += 10) {
      const [bx, bz] = at(u, side, 0.6);
      b.box('stone', bx, y - 0.5, bz, alongX ? 1.3 : 1.2, h * 0.7, alongX ? 1.2 : 1.3, 0, STONE, 0.05);
    }
  }
}

/** Broad palace silhouette: eight subsidiary spires and a 101m central crown. */
export function buildPalace(b: Builder, flags: FlagSpot[]): void {
  const { x, z, half } = PALACE;
  const y = heightAt(x, z);
  const ring = wallRing(b, {
    x, z, radius: PALACE.radius, segments: 12, phase: Math.PI / 12,
    height: 8, thickness: 3.6, towerRadius: 3.6,
    // The castle gate faces south, down the grand avenue.
    gates: [{ angle: Math.PI / 2, width: 12, height: 9 }],
    roof: SLATE, color: STONE, stairs: [1, 4, 7],
  });
  // Main keep remains climbable; none of the subsidiary towers occupies its stair envelope.
  const terrace = y + PALACE.terrace;
  const recess = structureDetail() > 1 ? 0.78 : structureDetail() ? 0.6 : 0;
  b.box('stone', x, y - 3, z, half * 2 - recess * 2, PALACE.terrace + 3, half * 2 - recess * 2, 0, PALE);
  if (recess) for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2;
    const face = new THREE.Shape();
    face.moveTo(-half, y - 3); face.lineTo(half, y - 3); face.lineTo(half, terrace); face.lineTo(-half, terrace); face.closePath();
    for (let k = -4; k <= 4; k += 2) {
      if (side === 0 && k < -2) continue;
      const u = k * 2.5;
      for (const h of [9,18,27]) {
        const hole = new THREE.Path();
        hole.moveTo(u - 0.675, y + h); hole.lineTo(u - 0.675, y + h + 3.6);
        hole.lineTo(u + 0.675, y + h + 3.6); hole.lineTo(u + 0.675, y + h); hole.closePath();
        face.holes.push(hole);
        keepWindowRecesses.push({ x: x + (u + 0.22) * Math.cos(a) + half * Math.sin(a), y: y + h + 2.1,
          z: z - (u + 0.22) * Math.sin(a) + half * Math.cos(a), normalX: Math.sin(a), normalZ: Math.cos(a), depth: recess });
      }
    }
    b.shape('stone', face, recess, place(x + (half - recess / 2) * Math.sin(a), 0, z + (half - recess / 2) * Math.cos(a), a), PALE);
  }
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
        b.box('plain', x + u * Math.cos(a) + (half - recess + 0.015) * Math.sin(a), y + h,
          z - u * Math.sin(a) + (half - recess + 0.015) * Math.cos(a), 1.0, 3.6, 0.04, a, 0x587184, 0);
        b.detail(() => {
          keepWindowDetail(b,x+u*Math.cos(a)+half*Math.sin(a),y+h,z-u*Math.sin(a)+half*Math.cos(a),a,recess);
          detailCounters.palaceWindows++;
        });
      }
    }
  }
  b.detail(()=>{
    for(let side=0;side<4;side++) {
      const a=side*Math.PI/2;
      const face=(u:number,v:number,w:number,h:number,color:number):void=>b.box('stone',x+u*Math.cos(a)+(half-.035)*Math.sin(a),y+v,z-u*Math.sin(a)+(half-.035)*Math.cos(a),w,h,.18,a,color,.16);
      for(const h of [6.6,15.7,24.7,35.5]) face(0,h,half*2,.28,0xd7c9ae);
      for(const sign of [-1,1]) for(let row=0;row<38;row++) face(sign*(half-.38),row,.72,.87,row%3?0xddd1b9:0xc3bba7);
    }
  });
  const spire = (tx: number, tz: number, base: number, h: number, r: number, roofH: number): void => {
    const crownGap = structureDetail() ? 0.9 : 0;
    b.cyl('stone', tx, base - 2, tz, r, r * 1.12, h + 2 - crownGap, PALE, structureDetail()>1?56:structureDetail()?28:14);
    b.cyl('stone', tx, base + h - 1.4, tz, r + 0.8, r, 1.4 - crownGap, STONE, structureDetail()>1?56:structureDetail()?28:14);
    b.cone('roof', tx, base + h, tz, r + 1.3, roofH, SLATE, structureDetail()>1?56:structureDetail()?28:14);
    addRound(tx, tz, r * 1.12, base + h);
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const wr = r * (1 + 0.12 * 10 / (h + 2)) + 0.05;
      b.box('plain', tx + Math.sin(a) * wr, base + h - 10, tz + Math.cos(a) * wr, 1.2, 5.3, 0.12, a, 0x5f7a8d, 0);
      b.detail(() => {
        for (const sign of [-1, 1]) b.block(tx + Math.sin(a) * wr + Math.cos(a) * sign * 0.73, base + h - 10.2,
          tz + Math.cos(a) * wr - Math.sin(a) * sign * 0.73, 0.32, 5.7, 0.38, a, 0xe5d8bd);
        for (const dy of [-0.25, 5.35]) b.block(tx + Math.sin(a) * wr, base + h - 10 + dy, tz + Math.cos(a) * wr, 1.95, 0.29, 0.44, a, 0xe5d8bd);
        b.box('stone', tx + Math.sin(a) * (wr + 0.04), base + h - 9.95, tz + Math.cos(a) * (wr + 0.04), 0.12, 5.2, 0.14, a, 0xd7c9a8, 0);
        detailCounters.palaceWindows++;
      });
      b.box('stone', tx + Math.sin(a) * (r + 0.6), base, tz + Math.cos(a) * (r + 0.6), 1.1, h * 0.64, 1.4, a, STONE);
    }
    b.detail(() => {
      palaceTowerMasonry(b,tx,tz,base,h,r);
      const crown=structureDetail()>1?20:12;
      for(let k=0;k<crown;k++){const a=k/crown*Math.PI*2;b.block(tx+Math.sin(a)*(r+.2),base+h-1.05,tz+Math.cos(a)*(r+.2),.78,1.18,.5,a,0xd8ccb2,.065);detailCounters.palaceMerlons++;}
      for (const t of (structureDetail()>1?[0.04,.23,.48,.72,.94]:[0.04, 0.48, 0.92])) {
        const radius = Math.min(r*1.12,r * (1.12 - 0.12 * t) + (structureDetail()>1?.27:.19));
        b.cyl('stone', tx, base + h * t, tz, radius, radius, structureDetail()>1?.42:.32, 0xd7cab1, structureDetail()>1?56:28);
        detailCounters.towerBands++;
      }
      // Thin rings break up each conical slate roof into overlapping courses.
      const rows = Math.ceil(roofH / 1.2);
      for (let row = 1; row < rows; row++) {
        const t = row / rows, radius = (r + 1.3) * (1 - t) + 0.045;
        b.cyl('roof', tx, base + h + roofH * t, tz, radius * 0.97, radius, 0.09, SLATE, 14, 0.08);
        detailCounters.roofCourses++;
      }
    });
    const top = base + h + roofH;
    b.cyl('wood', tx, top - 0.3, tz, 0.09, 0.09, 4.8, 0x514536, 5, 0);
    flags.push({ x: tx, y: top + 3.8, z: tz, color: 0xb94836, size: 2.1 });
  };
  spire(x, z, terrace, 35, 6.5, 28);
  for (const [dx, dz, h, r] of PALACE_TOWERS) spire(x + dx, z + dz, y, h, r, 16 + r);

  // One continuous castle round the keep's court: the great hall to the north, linking blocks
  // to two long wings, and lower south ranges either side of the loggia. Towers rise out of them.
  for (const r of PALACE_RANGES) range(b, x + r.x, y, z + r.z, r);
  // Open arcade behind the forecourt: real openings, with overhead-only collision.
  const arcadeZ = z + 48;
  b.shape('stone', archedProfile(-27, 27, y - 1, () => y + 10,
    [-21, -10.5, 0, 10.5, 21].map((u) => ({ x: u, w: 7.5, crown: y + 8 }))), 3, place(x, 0, arcadeZ), PALE);
  for (let u = -26.25; u <= 27; u += 10.5) addBox(x + u, arcadeZ, 1.5, 1.5, 0, y + 10);
  addBox(x, arcadeZ, 27, 1.5, 0, y + 10, y + 7.5);
  // A gallery storey over the loggia joins the two south ranges into one front.
  b.box('stone', x, y + 10, arcadeZ, 54, 4, 3.4, 0, PALE);
  b.prism('stone', x, y + 14, arcadeZ, 3.4, 54, 1.8, Math.PI / 2, PALE);
  b.roof(x, y + 14, arcadeZ, 3.4, 54, 1.8, Math.PI / 2, SLATE, 0.4);
  for (let u = -24; u <= 24; u += 4) b.box('plain', x + u, y + 11.2, arcadeZ + 1.73, 1.1, 1.8, 0.08, 0, 0x39516b, 0);
  addBox(x, arcadeZ, 27, 1.7, 0, y + 15.8, y + 7.5);
  // An imposing southern gatehouse at the head of the grand stair keeps the courtyard route open.
  for (const dx of [-10.5, 10.5]) {
    b.box('stone', x + dx, y - 4, z + 76, 8, 26, 10, 0, PALE);
    b.pyramid('roof', x + dx, y + 22, z + 76, 10, 12, 13, 0, SLATE);
    addBox(x + dx, z + 76, 4, 5, 0, y + 22);
  }
  b.box('stone', x, y + 11, z + 76, 13, 9, 10, 0, PALE);
  addBox(x, z + 76, 6.5, 5, 0, y + 20, y + 11);
  orbAt('keep-terrace', x + 9, z - 9, 1.2);
  orbAt('keep-air', x + 19, z + 17, 22);
  orbAt('hall-roof', x, z - 45, 1.2);
  orbAt('castle-wall', ring.towers[5].x, ring.towers[5].z, 1.3);
}
