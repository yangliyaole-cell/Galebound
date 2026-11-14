import * as THREE from 'three';
import { Builder, archedProfile, place } from '../build';
import { addBox, addRound } from '../colliders';
import type { FlagSpot } from '../flags';
import { heightAt } from '../heightmap';
import { CITY } from '../layout';
import { seededRandom } from '../noise';
import { PALACE, PALACE_TOWERS } from './palace';

const PALE = 0xe8dfca;
const STONE = 0xcfc5af;
const SLATE = 0x566c89;
const GOLD = 0xe0b84a;
const HEDGE = 0x3f6a32;
const LAWN = 0x587f3a;

/** A small round turret corbelled out from a wall top, with a pointed roof. */
function bartizan(b: Builder, x: number, y: number, z: number, r: number, h: number): void {
  // Corbel: an inverted cone of stepped masonry under the turret.
  b.add('stone', new THREE.ConeGeometry(r, 2.4, 14).rotateX(Math.PI).translate(0, -1.2, 0), STONE, place(x, y, z), 0.2);
  b.cyl('stone', x, y, z, r, r, h, PALE, 16, 0.1);
  b.cyl('stone', x, y + h - 0.35, z, r + 0.25, r + 0.25, 0.35, STONE, 16, 0);
  b.cone('roof', x, y + h, z, r + 0.45, r * 2.6, SLATE, 16);
  b.cyl('plain', x, y + h + r * 2.6 - 0.1, z, 0.05, 0.05, 0.9, GOLD, 5, 0);
  b.add('plain', new THREE.SphereGeometry(0.16, 8, 6), GOLD, place(x, y + h + r * 2.6 + 0.85, z));
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    b.box('plain', x + Math.sin(a) * (r + 0.01), y + h * 0.45, z + Math.cos(a) * (r + 0.01), 0.35, 1.0, 0.06, a, 0x3a4652, 0);
  }
  // Overhead only: it hangs out from the wall top, so stairs and walks pass beneath.
  addRound(x, z, r, y + h, y - 2.4);
}

/** Small gabled window on a conical or pyramidal roof. */
function lucarne(b: Builder, x: number, y: number, z: number, rot: number, scale: number): void {
  b.box('stone', x, y, z, 1.1 * scale, 1.5 * scale, 1.2 * scale, rot, PALE, 0.05);
  b.roof(x, y + 1.5 * scale, z, 1.2 * scale, 1.3 * scale, 0.75 * scale, rot, SLATE, 0.1);
  b.prism('stone', x, y + 1.5 * scale, z, 1.1 * scale, 1.2 * scale, 0.72 * scale, rot + Math.PI / 2, PALE);
  const fx = x + Math.sin(rot) * 0.61 * scale, fz = z + Math.cos(rot) * 0.61 * scale;
  b.box('plain', fx, y + 0.3 * scale, fz, 0.55 * scale, 0.95 * scale, 0.04, rot, 0x3a4652, 0);
}

/** Gilded ball and spike at the tip of a spire. */
function finial(b: Builder, x: number, y: number, z: number, size: number): void {
  b.add('plain', new THREE.SphereGeometry(0.32 * size, 10, 8), GOLD, place(x, y + 0.2 * size, z));
  b.cyl('plain', x, y + 0.45 * size, z, 0.03 * size, 0.07 * size, 1.6 * size, GOLD, 6, 0);
}

/**
 * Everything that turns the old castle block into a palace: bartizans and a
 * machicolated parapet on the keep, lucarnes and gilded finials on the spires,
 * dormers, a louvre and pinnacles on the great hall, a chapel, a walled garden
 * with a fountain in the inner ward, a stronger gatehouse, and bare rock round
 * the crown of the crag.
 */
export function embellishPalace(b: Builder, flags: FlagSpot[]): void {
  const { x, z, half } = PALACE;
  const y = heightAt(x, z);
  const rand = seededRandom(3301);
  const terrace = y + PALACE.terrace;

  // Keep: corbel table under the parapet, and three corner bartizans (the stair arrives at the fourth).
  b.detail(() => {
    for (let side = 0; side < 4; side++) {
      const a = side * Math.PI / 2;
      for (let u = -half + 0.6; u <= half - 0.6; u += 1.2) {
        b.block(x + u * Math.cos(a) + (half + 0.18) * Math.sin(a), terrace - 1.3, z - u * Math.sin(a) + (half + 0.18) * Math.cos(a), 0.42, 0.9, 0.5, a, STONE, 0.04);
      }
    }
  });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1]]) bartizan(b, x + sx * (half + 0.4), terrace - 0.2, z + sz * (half + 0.4), 1.7, 5.5);

  // Main spire: lucarnes on the cone and a gilded finial; the subsidiary towers too.
  const spireTop = terrace + 35;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const r = (6.5 + 1.3) * 0.72;
    lucarne(b, x + Math.sin(a) * r, spireTop + 28 * 0.24, z + Math.cos(a) * r, a, 1.3);
  }
  finial(b, x, spireTop + 28, z, 2.2);
  for (const [dx, dz, h, r] of PALACE_TOWERS) {
    const top = y + h, roofH = 16 + r;
    // A corbelled crown overhangs the shaft just under the roof: a machicolated gallery.
    b.cyl('stone', x + dx, top - 3.4, z + dz, r + 0.75, r + 0.75, 2.2, PALE, 28, 0.08);
    b.add('stone', new THREE.CylinderGeometry(r + 0.75, r, 1.4, 28, 1, true).translate(0, -0.7, 0), STONE, place(x + dx, top - 3.4, z + dz), 0.25);
    b.detail(() => {
      const n = Math.round((r + 0.4) * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        b.box('stone', x + dx + Math.sin(a) * (r + 0.35), top - 4.6, z + dz + Math.cos(a) * (r + 0.35), 0.4, 1.2, 0.8, a, STONE, 0.2);
        if (k % 3 === 0) b.box('plain', x + dx + Math.sin(a) * (r + 0.77), top - 2.9, z + dz + Math.cos(a) * (r + 0.77), 0.32, 0.9, 0.04, a, 0x3a4652, 0);
      }
    });
    finial(b, x + dx, top + roofH, z + dz, 1.2);
    const a = Math.atan2(dx, dz);
    lucarne(b, x + dx + Math.sin(a) * (r + 1.3) * 0.68, top + roofH * 0.28, z + dz + Math.cos(a) * (r + 1.3) * 0.68, a, 0.9);
  }

  // Great hall: dormers on both slopes, a louvre on the ridge, pinnacles on the buttresses, chimneys.
  {
    const hx = x, hz = z - 45, w = 65, d = 20, h = 24, rh = 12;
    for (const side of [-1, 1]) for (let u = -w / 2 + 7; u < w / 2 - 5; u += 9) {
      const dz = side * d * 0.22;
      const [lx, lz] = [hx + u, hz + dz];
      const roofY = y + h + rh * (1 - Math.abs(dz) / (d / 2)) - 1.2;
      lucarne(b, lx, roofY, lz + side * 0.2, side > 0 ? 0 : Math.PI, 1.45);
    }
    const lx0 = hx + 13;
    b.box('stone', lx0, y + h + rh - 0.4, hz, 4.2, 3.4, 4.2, 0, PALE, 0.05);
    b.pyramid('roof', lx0, y + h + rh + 3, hz, 5.2, 5.2, 6.5, 0, SLATE);
    finial(b, lx0, y + h + rh + 9.5, hz, 1.4);
    addBox(lx0, hz, 2.1, 2.1, 0, y + h + rh + 3);
    for (const side of [-1, 1]) for (let u = -w / 2 + 7.5; u < w / 2 - 2; u += 7) {
      const px = hx + u, pz = hz + side * (d / 2 + 1.2);
      b.box('stone', px, y + h * 0.8, pz, 1.1, h * 0.2 + 2.4, 1.1, 0, STONE, 0.05);
      b.pyramid('stone', px, y + h + 2.4, pz, 1.1, 1.1, 2.6, 0, PALE);
    }
    for (const u of [-w / 2 + 4, w / 2 - 4]) {
      b.box('stone', hx + u, y + h + rh * 0.4, hz - 3, 1.8, rh * 0.6 + 3.5, 1.4, 0, STONE, 0.1);
      b.box('stone', hx + u, y + h + rh + 3.5, hz - 3, 2.1, 0.3, 1.7, 0, PALE, 0);
    }
  }

  // Wings: a turret at each outer corner.
  for (const [dx, dz, w, d, h] of [[-48, -2, 18, 41, 18], [48, -1, 18, 42, 22]]) {
    for (const sz of [-1, 1]) {
      const sx = Math.sign(dx);
      bartizan(b, x + dx + sx * (w / 2 + 0.3), y + h - 3, z + dz + sz * (d / 2 + 0.3), 1.35, 4.5);
    }
  }

  // Chapel in the north-west of the ward: nave, apse to the east, a slender flèche.
  {
    const cx = x - 29, cz = z - 23, L = 15, W = 8.5, H = 11, roofH = 6.5;
    b.box('stone', cx, y - 2, cz, L, H + 2, W, 0, PALE, 0.12);
    b.prism('stone', cx, y + H, cz, L - 0.05, W - 0.05, roofH, Math.PI / 2, PALE);
    b.roof(cx, y + H, cz, W, L, roofH, Math.PI / 2, SLATE, 0.5);
    b.cyl('stone', cx + L / 2, y - 2, cz, W / 2, W / 2, H + 2, PALE, 14, 0.12);
    b.cone('roof', cx + L / 2, y + H, cz, W / 2 + 0.5, roofH * 0.9, SLATE, 14);
    for (const side of [-1, 1]) for (let u = -L / 2 + 2.5; u < L / 2 - 1; u += 3.5) {
      b.box('stone', cx + u, y - 1, cz + side * (W / 2 + 0.5), 0.9, H - 1, 1.0, 0, STONE, 0.1);
      b.box('plain', cx + u + 1.75, y + 3, cz + side * (W / 2 + 0.02), 1.1, 5.2, 0.08, 0, 0x5a7fc0, 0);
    }
    b.add('plain', new THREE.CylinderGeometry(1.7, 1.7, 0.15, 16).rotateZ(Math.PI / 2), 0x5a7fc0, place(cx - L / 2 - 0.05, y + H - 1.6, cz));
    b.add('stone', new THREE.TorusGeometry(1.75, 0.2, 6, 18).rotateY(Math.PI / 2), PALE, place(cx - L / 2 - 0.08, y + H - 1.6, cz));
    // The door opens on the south side, onto the ward.
    b.box('wood', cx - 2, y, cz + W / 2 + 0.05, 1.9, 3.4, 0.12, 0, 0x6a4c34, 0);
    b.box('stone', cx + 1, y + H + roofH - 1, cz, 1.4, 2.4, 1.4, 0, PALE, 0);
    b.cone('roof', cx + 1, y + H + roofH + 1.4, cz, 1.2, 7.5, SLATE, 8);
    finial(b, cx + 1, y + H + roofH + 8.9, cz, 1);
    addBox(cx, cz, L / 2, W / 2, 0, (_, lz) => y + H + Math.max(0, 1 - Math.abs(lz) / (W / 2)) * roofH);
    addRound(cx + L / 2, cz, W / 2, y + H + 2);
  }

  // Inner ward garden south of the keep: lawns in box hedges, gravel walks, a fountain, clipped yews.
  {
    const gx = x, gz = z + 31, gw = 34, gd = 22;
    b.box('paving', gx, y - 0.1, gz, gw + 2, 0.14, gd + 2, 0, 0xeee4d0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = gx + sx * gw / 4 + sx * 0.6, pz = gz + sz * gd / 4 + sz * 0.6;
      b.box('plain', px, y - 0.05, pz, gw / 2 - 3.2, 0.14, gd / 2 - 3.2, 0, LAWN, 0);
      for (const [ex, ez, ew, ed] of [[0, -(gd / 4 - 1.4), gw / 2 - 2.6, 0.6], [0, gd / 4 - 1.4, gw / 2 - 2.6, 0.6], [-(gw / 4 - 1.4), 0, 0.6, gd / 2 - 2.6], [gw / 4 - 1.4, 0, 0.6, gd / 2 - 2.6]]) {
        b.box('plain', px + ex, y, pz + ez, ew, 0.7, ed, 0, HEDGE, 0.25);
      }
      // A clipped yew at the inner corner of each bed, and roses along its edge.
      const yx = gx + sx * 3.2, yz = gz + sz * 3.2;
      b.add('plain', new THREE.ConeGeometry(0.9, 3.2, 10).translate(0, 1.9, 0), 0x2f5a2a, place(yx, y, yz), 0.3);
      b.cyl('wood', yx, y, yz, 0.12, 0.14, 0.4, 0x5a4030, 6, 0);
      addRound(yx, yz, 0.9, y + 3.5);
      b.detail(() => {
        for (let k = 0; k < 10; k++) {
          b.add('plain', new THREE.IcosahedronGeometry(0.16, 0), [0xe35b6a, 0xf08fb0, 0xfff6ea, 0xf2c94c][k % 4],
            place(px + (rand() - 0.5) * (gw / 2 - 5), y + 0.2, pz + sz * (gd / 4 - 2.1)), 0.1);
        }
      });
    }
    b.cyl('stone', gx, y - 0.2, gz, 3.1, 3.3, 0.85, PALE, 20, 0.15);
    b.cyl('plain', gx, y + 0.6, gz, 2.8, 2.8, 0.06, 0x4f9fd0, 20, 0);
    b.cyl('stone', gx, y + 0.6, gz, 0.35, 0.5, 1.8, PALE, 10, 0);
    b.cyl('stone', gx, y + 2.4, gz, 1.2, 0.45, 0.3, PALE, 14, 0);
    b.add('plain', new THREE.SphereGeometry(0.3, 10, 8), GOLD, place(gx, y + 2.9, gz));
    addRound(gx, gz, 3.3, y + 0.65);
  }

  // Gatehouse: round flanking towers with pointed roofs, a portcullis and banners.
  for (const dz of [-9, 9]) {
    const tx = x - 81, tz = z + dz;
    b.cyl('stone', tx, y - 4, tz, 4.2, 4.6, 26, PALE, 20, 0.15);
    b.cyl('stone', tx, y + 21, tz, 4.8, 4.2, 1.2, STONE, 20, 0);
    b.cone('roof', tx, y + 22.2, tz, 5.1, 11, SLATE, 20);
    finial(b, tx, y + 33.2, tz, 1.2);
    b.detail(() => {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        b.block(tx + Math.sin(a) * 4.55, y + 20.2, tz + Math.cos(a) * 4.55, 0.7, 0.9, 0.5, a, STONE, 0.04);
      }
      for (const h of [6, 12, 17]) b.box('plain', tx - 4.25, y + h, tz, 0.08, 1.8, 0.7, 0, 0x3a4652, 0);
    });
    addRound(tx, tz, 4.6, y + 22);
    flags.push({ x: tx, y: y + 36.5, z: tz, color: 0x3d5a9a, size: 1.6 });
  }
  // Portcullis half raised in the gate arch, and long banners either side of it.
  for (let k = -3; k <= 3; k++) b.box('wood', x - 81.3, y + 4.6, z + k * 0.75, 0.12, 2.6, 0.1, 0, 0x3a3430, 0);
  for (let k = 0; k < 4; k++) b.box('wood', x - 81.3, y + 4.8 + k * 0.6, z, 0.12, 0.1, 5.2, 0, 0x3a3430, 0);
  for (const dz of [-5.2, 5.2]) {
    b.box('cloth', x - 85.6, y + 7, z + dz, 0.05, 6.5, 1.6, 0, 0x3d5a9a, 0);
    b.box('cloth', x - 85.66, y + 10.5, z + dz, 0.05, 0.9, 0.7, 0, GOLD, 0);
  }

  // Bare rock breaking out of the crag face below the castle in outcrops of two or three
  // big, half-buried blocks, leaving the stair to the gate clear.
  for (let k = 0; k < 44; k++) {
    const a = (k / 44) * Math.PI * 2 + rand() * 0.06;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.2) continue;
    const n = 2 + Math.floor(rand() * 2);
    for (let j = 0; j < n; j++) {
      const r = CITY.plateau + 4 + rand() * 9, aj = a + (rand() - 0.5) * 0.06;
      const rx = CITY.x + Math.cos(aj) * r, rz = CITY.z + Math.sin(aj) * r;
      const g = heightAt(rx, rz);
      const w = 5 + rand() * 6, h = 4 + rand() * 4;
      b.rock(rx, g - h * 0.55, rz, w, h, 3.5 + rand() * 3, -aj + rand() * 0.5, rand() < 0.5 ? 0xd2cab4 : 0xbfb8a2, k * 13 + j * 5 + 7, 1, 'rubble');
    }
  }
  void archedProfile;
}
