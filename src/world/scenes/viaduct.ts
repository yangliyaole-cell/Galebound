import * as THREE from 'three';
import { Builder, archedProfile, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';
import { VIADUCT } from './plan';
import { sceneSolids } from './geometry';

/** Fifteen actual openings, tapered buttresses and a continuous parapet silhouette. */
export function addViaduct(b: Builder, detail: number): number {
  const v = VIADUCT, len = Math.hypot(v.bx - v.ax, v.bz - v.az), bay = len / v.bays;
  let openings = 0;
  const dx = (v.bx - v.ax) / len, dz = (v.bz - v.az) / len, rot = Math.atan2(-dz, dx);
  for (let i = 0; i < v.bays; i++) {
    const x = v.ax + dx * (i + 0.5) * bay, z = v.az + dz * (i + 0.5) * bay;
    const foot = Math.min(heightAt(x - dx * bay / 2, z - dz * bay / 2), heightAt(x, z), heightAt(x + dx * bay / 2, z + dz * bay / 2)) - 3;
    const width = bay - 4.5;
    const open = foot < v.deck - 4.4 - width / 2 - 1;
    const profile = archedProfile(-bay / 2, bay / 2, foot, () => v.deck,
      open ? [{ x: 0, w: width, crown: v.deck - 4.4 }] : []);
    if (open) openings++;
    b.shape('stone', profile, v.width, place(x, 0, z, rot), i % 3 ? 0xc5c2af : 0xb8bcaa);
    if (open) for (let k = 0; k < 20; k++) {
      const left = -width / 2 + k * width / 20, right = left + width / 20;
      const outside = Math.max(Math.abs(left), Math.abs(right));
      const underside = v.deck - 4.4 - width / 2 + Math.sqrt(Math.max(0, width * width / 4 - outside * outside));
      const lx = (left + right) / 2;
      addBox(x + dx * lx, z + dz * lx, width / 40, v.width / 2, rot, v.deck, underside);
    }
    else addBox(x, z, bay / 2, v.width / 2, rot, v.deck);
    if (open && detail > 0) for (const side of [-1, 1]) {
      for (let k = 0; k < 15; k++) {
        const angle = (k + 0.5) / 15 * Math.PI, radius = width / 2 + 0.42;
        const lx = Math.cos(angle) * radius, y = v.deck - 4.4 - width / 2 + Math.sin(angle) * radius;
        const matrix = place(x, 0, z, rot).multiply(new THREE.Matrix4().makeRotationZ(angle - Math.PI / 2)
          .setPosition(lx, y, side * (v.width / 2 + 0.12)));
        b.slab('stone', 0.8, 1.1, 0.3, matrix, 0xd9d1b8);
      }
    }
  }
  for (let i = 0; i <= v.bays; i++) {
    const x = v.ax + dx * i * bay, z = v.az + dz * i * bay, y = heightAt(x, z) - 2;
    b.box('stone', x, y, z, 5.4, Math.max(1, v.deck - 4 - y), v.width + 2.8, rot, 0xb6baab, 0.17);
    b.box('stone', x, v.deck - 4, z, 5.9, 0.6, v.width + 3.2, rot, 0xd1cbb5);
    addBox(x, z, 2.75, (v.width + 2.8) / 2, rot, v.deck);
    sceneSolids.push({ kind: 'viaduct-pier', x, z, radius: 5.3 });
  }
  const mx = (v.ax + v.bx) / 2, mz = (v.az + v.bz) / 2;
  for (const side of [-1, 1]) {
    b.box('stone', mx - dz * side * (v.width / 2 - 0.3), v.deck, mz + dx * side * (v.width / 2 - 0.3), len, 1.45, 0.65, rot, 0xcfc8b2);
    addBox(mx - dz * side * v.width / 2, mz + dx * side * v.width / 2, len / 2, 0.38, rot, v.deck + 1.45, v.deck);
  }
  addBox(mx, mz, len / 2, v.width / 2, rot, v.deck, v.deck - 4.4);
  return openings;
}
