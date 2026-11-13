import * as THREE from 'three';
import { Builder, archedProfile, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';
import { roadClearance, ROADS } from '../layout';
import { type FlagSpot } from '../flags';
import { seededRandom } from '../noise';
import { landscapeRock, ribbon, sceneSolids } from './geometry';
import { MEADOW_ROCKS, WAYGATE } from './plan';

/** A roadside ruin frames the northern view without occupying the takeoff corridor. */
export function addWaygate(b: Builder, detail: number): FlagSpot[] {
  const g = WAYGATE, y = heightAt(g.x, g.z), rand = seededRandom(7821), half = g.width / 2;
  const shape = archedProfile(-half - 1.6, half + 1.6, -1.7, (x) => g.height - Math.abs(x) * 0.12,
    [{ x: 0, w: g.width, crown: 8.4 }]);
  b.shape('stone', shape, 1.6, place(g.x, y, g.z), 0xb8ba9f);
  for (const side of [-1, 1]) {
    const x = g.x + side * (half + 0.8), base = Math.min(y - 1.7, heightAt(x, g.z) - 0.8);
    b.box('stone', x, base, g.z, 2.1, y - base + g.height - 0.9, 2.05, 0, 0xa5ad94);
    addBox(x, g.z, 1.1, 1.05, 0, y + g.height - 0.8);
    sceneSolids.push({ kind: 'gate-pier', x, z: g.z, radius: 1.6 });
    b.box('stone', x, y + g.height - 0.8, g.z, 2.4, 0.4, 2.4, 0, 0xc7c8af);
  }
  for (let i = 0; i < 16; i++) {
    const left = -half + g.width * i / 16, right = -half + g.width * (i + 1) / 16;
    const outer = Math.max(Math.abs(left), Math.abs(right));
    const underside = y + 8.4 - half + Math.sqrt(Math.max(0, half * half - outer * outer));
    addBox(g.x + (left + right) / 2, g.z, g.width / 32, 0.8, 0, y + g.height, underside);
  }
  // Wedge-shaped voussoirs and irregular rubble courses, each merged into stone.
  for (let k = 0; k < (detail === 2 ? 25 : 15); k++) {
    const angle = (k + 0.5) / (detail === 2 ? 25 : 15) * Math.PI, r = half + 0.36;
    const matrix = place(g.x + Math.cos(angle) * r, y + 8.4 - half + Math.sin(angle) * r, g.z + 0.87)
      .multiply(new THREE.Matrix4().makeRotationZ(angle - Math.PI / 2));
    b.slab('stone', detail === 2 ? 0.49 : 0.8, 0.84, 0.23, matrix, k % 4 ? 0xc6c6a9 : 0x9fa88f);
  }
  if (detail > 0) for (const side of [-1, 1]) {
    for (let k = 0; k < 38; k++) {
      const t = k / 37, x = g.x + side * (half + 0.75) + Math.sin(t * 14 + side) * 0.65, py = y + 1 + t * 9;
      const geo = new THREE.SphereGeometry(0.22 + rand() * 0.13, 6, 4).scale(1.3, 0.65, 0.32);
      b.add('plain', geo, k % 3 ? 0x617548 : 0x839354, place(x, py, g.z + 0.99));
      if (k % 3 === 0) b.box('wood', x, py - 0.3, g.z + 0.89, 0.04, 0.55, 0.04, 0, 0x5c6841);
    }
  }
  const bx = g.x - half - 0.8;
  b.box('wood', bx, y + 9.7, g.z + 1.2, 2.7, 0.13, 0.13, 0, 0x6c634a);
  for (const [x, z, r] of MEADOW_ROCKS) {
    if (roadClearance(x, z) < r + 1.3) continue;
    landscapeRock(b, x, heightAt(x, z) - r * 0.24, z, r, detail);
  }
  // Dry-stacked, rounded fieldstone wall, with explicit gaps wherever roads pass.
  for (let k = 0; k < 32; k++) {
    const x = 28 + k * 1.7, z = 43 - k * 0.19;
    if (roadClearance(x, z) < 4) continue;
    for (let row = 0; row < (detail === 0 ? 1 : 3); row++) {
      const px = x + (row % 2) * 0.55, pz = z + (rand() - 0.5) * 0.2;
      landscapeRock(b, px, heightAt(px, pz) + row * 0.42 - 0.18, pz, 0.68 + rand() * 0.15, detail === 2 ? 1 : 0, false);
    }
    addBox(x, z, 0.85, 0.65, 0.11, heightAt(x, z) + (detail === 0 ? 0.5 : 1.4));
    sceneSolids.push({ kind: 'rubble-wall', x, z, radius: 1.1 });
  }
  // Each rail follows the hillside in three dimensions, rather than hovering horizontally.
  for (let k = 0; k < 14; k++) {
    const x = 39 + k * 3.2, z = 20 - k * 0.5, x1 = x + 3.2, z1 = z - 0.5;
    if (Math.min(roadClearance(x, z), roadClearance(x1, z1)) < 4) continue;
    const y0 = heightAt(x, z), y1 = heightAt(x1, z1);
    b.box('wood', x, y0 - 0.2, z, 0.18, 1.7, 0.21, 0.1, 0x887955);
    for (const up of [0.55, 1.15]) {
      const a = new THREE.Vector3(x, y0 + up, z), end = new THREE.Vector3(x1, y1 + up, z1);
      const geo = new THREE.CylinderGeometry(0.07, 0.09, a.distanceTo(end), 6);
      const matrix = new THREE.Matrix4().compose(a.clone().add(end).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(a).normalize()), new THREE.Vector3(1, 1, 1));
      b.add('wood', geo, 0x95835d, matrix);
    }
    addBox(x + 1.6, z - 0.25, 1.65, 0.13, 0.155, Math.max(y0, y1) + 1.4);
    sceneSolids.push({ kind: 'fence', x: x + 1.6, z: z - 0.25, radius: 1.8 });
  }
  if (detail > 0) {
    // Subtle raised berms define the wheel tracks; road colour remains owned by line A.
    const road = ROADS.find((r) => r.id === 'start-village')!;
    for (const side of [-1, 1]) {
      const path = road.pts.map(([x, z], i) => {
        const a = road.pts[Math.max(0, i - 1)], c = road.pts[Math.min(road.pts.length - 1, i + 1)];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        return new THREE.Vector3(x - (c[1] - a[1]) / len * side * 0.83, 0, z + (c[0] - a[0]) / len * side * 0.83);
      });
      b.add('plain', ribbon(path, path.map(() => 0.1), 2, (x, z, _t, u) => heightAt(x, z) + 0.026 + (1 - u * u) * 0.025), 0xb5a174);
    }
  }
  return [{ x: bx, y: y + 9.6, z: g.z + 1.26, size: 2.6, color: 0x9b3032, hanging: true }];
}
