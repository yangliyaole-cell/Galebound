import * as THREE from 'three';
import { place, type Builder } from '../build';
import { addBox, addRound } from '../colliders';
import { GLASS } from '../abbey-glass';
import { PLAN } from '../abbey-plan';
import { plant } from '../flora/garden';
import { lawn } from '../lawns';
import { TINT, gableRoof, type Ctx, type Win } from './abbey';
import { EQ, balustrade, candlestick, flowerUrn, lantern, lathe, pier, pinnacle, starShape, statue, tracery, wall } from './gothic';

/** A sloping slab given the four corners of its upper face. */
function roofQuad(b: Builder, p: [number, number, number][], thick: number, color: number): void {
  const v = p.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0]));
  if (n.y < 0) v.reverse();
  const low = v.map((q) => q.clone().setY(q.y - thick)), tri: number[] = [];
  const quad = (a: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, e: THREE.Vector3): void => { for (const q of [a, c, d, a, d, e]) tri.push(q.x, q.y, q.z); };
  quad(v[0], v[1], v[2], v[3]); quad(low[3], low[2], low[1], low[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(v[j], v[i], low[i], low[j]); }
  b.emit('slate', tri, color, null, 0);
}

/** The cloister: four roofed walks round a garden with a fountain. */
function cloister(c: Ctx): void {
  const { ext, inside, y } = c, C = PLAN.cloister, floor = y + 0.04;
  const gx0 = C.x0 + C.walk, gx1 = C.x1 - C.walk, gz0 = C.z0 + C.walk, gz1 = C.z1 - C.walk;
  const [mx, mz] = c.W((C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2);
  // Walks paved in stone, the garth in turf with gravel paths in a cross.
  ext.box('paving', mx, y - 0.3, mz, C.x1 - C.x0, 0.34, C.z1 - C.z0, 0, 0xe8dcc4, 0);
  ext.box('plain', mx, y - 0.2, mz, gx1 - gx0 - 0.8, 0.3, gz1 - gz0 - 0.8, 0, 0x4f6f34, 0);
  // Turf between the paths, the beds and the fountain.
  lawn(mx, mz, gx1 - gx0 - 0.8, gz1 - gz0 - 0.8, y + 0.1, 0, { keep: (x, z) =>
    Math.abs(x - mx) > 1.2 && Math.abs(z - mz) > 1.2 && Math.hypot(x - mx, z - mz) > 3.0 &&
    !(Math.abs(Math.abs(x - mx) - 7.1) < 3.8 && Math.abs(Math.abs(z - mz) - 7.1) < 3.8) });
  ext.box('paving', mx, y - 0.18, mz, gx1 - gx0 - 0.8, 0.3, 2.2, 0, 0xe2d6bc, 0);
  ext.box('paving', mx, y - 0.18, mz, 2.2, 0.3, gz1 - gz0 - 0.8, 0, 0xe2d6bc, 0);
  addBox(mx, mz, (C.x1 - C.x0) / 2, (C.z1 - C.z0) / 2, 0, floor);
  // Outer walls where the church does not already close the square.
  c.shell([C.x1, C.z1], [C.x1, C.z0], -6, 7.4, 1.0, [{ p: PLAN.chapter.z, w: 2.4, sill: 0, spring: 3.0, door: true }]);
  c.shell([C.x0 - 0.7, C.z1], [C.x1 + 0.5, C.z1], -6, 7.4, 1.0, [{ p: 37, w: 2.8, sill: 0, spring: 3.2, door: true }]);
  // The arcade: six bays a side, the middle pair open to the garden, the rest with a dwarf wall and tracery.
  const sides: [[number, number], [number, number]][] = [[[gx0, gz0], [gx1, gz0]], [[gx1, gz0], [gx1, gz1]], [[gx1, gz1], [gx0, gz1]], [[gx0, gz1], [gx0, gz0]]];
  for (const [a, e] of sides) {
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]), bays = 6, bay = len / bays;
    const openings = Array.from({ length: bays }, (_, k) => {
      const u = -len / 2 + (k + 0.5) * bay, open = k === 2 || k === 3;
      return { u, w: 3.1, sill: open ? y : y + 0.9, spring: y + 2.7, rise: 3.1 * EQ * 0.82, door: open };
    });
    const A = c.W(...a), E = c.W(...e);
    wall(ext, 'ashlar', A, E, y - 1, y + 5.7, 0.62, TINT.trim, openings, true);
    const rot = Math.atan2(-(E[1] - A[1]), E[0] - A[0]), ux = (E[0] - A[0]) / len, uz = (E[1] - A[1]) / len;
    for (const o of openings) {
      const px = (A[0] + E[0]) / 2 + ux * o.u, pz = (A[1] + E[1]) / 2 + uz * o.u;
      if (!o.door) ext.detail(() => tracery(ext, 'ashlar', place(px, 0, pz, rot), 3.1, o.sill, o.spring - 0.25, 1, TINT.trim, 0.13, 0.26));
      // A colonnette with a gilded ring between every pair of bays.
      ext.cyl('marble', px + ux * bay / 2, y + 0.9, pz + uz * bay / 2, 0.16, 0.18, 1.8, TINT.white, 8, 0);
    }
    ext.box('ashlar', (A[0] + E[0]) / 2, y + 5.7, (A[1] + E[1]) / 2, len + 0.8, 0.3, 0.9, rot, TINT.trim, 0);
  }
  // Lean-to roofs over the walks, on oak rafters.
  const hi = y + 7.5, lo = y + 5.9, X = (lx: number): number => c.ax + lx, Z = (lz: number): number => c.az + lz;
  roofQuad(ext, [[X(C.x0 + 0.2), hi, Z(C.z0)], [X(gx0 + 0.6), lo, Z(gz0 + 0.6)], [X(gx0 + 0.6), lo, Z(gz1 - 0.6)], [X(C.x0 + 0.2), hi, Z(C.z1)]], 0.26, TINT.slate);
  roofQuad(ext, [[X(C.x1 - 0.2), hi, Z(C.z0)], [X(gx1 - 0.6), lo, Z(gz0 + 0.6)], [X(gx1 - 0.6), lo, Z(gz1 - 0.6)], [X(C.x1 - 0.2), hi, Z(C.z1)]], 0.26, TINT.slate);
  roofQuad(ext, [[X(C.x0), hi, Z(C.z0 + 0.2)], [X(gx0 + 0.6), lo, Z(gz0 + 0.6)], [X(gx1 - 0.6), lo, Z(gz0 + 0.6)], [X(C.x1), hi, Z(C.z0 + 0.2)]], 0.26, TINT.slate);
  roofQuad(ext, [[X(C.x0), hi, Z(C.z1 - 0.2)], [X(gx0 + 0.6), lo, Z(gz1 - 0.6)], [X(gx1 - 0.6), lo, Z(gz1 - 0.6)], [X(C.x1), hi, Z(C.z1 - 0.2)]], 0.26, TINT.slate);
  for (const [ax, az, hx, hz] of [[(C.x0 + gx0) / 2, (C.z0 + C.z1) / 2, C.walk / 2, (C.z1 - C.z0) / 2], [(C.x1 + gx1) / 2, (C.z0 + C.z1) / 2, C.walk / 2, (C.z1 - C.z0) / 2],
    [(C.x0 + C.x1) / 2, (C.z0 + gz0) / 2, (C.x1 - C.x0) / 2, C.walk / 2], [(C.x0 + C.x1) / 2, (C.z1 + gz1) / 2, (C.x1 - C.x0) / 2, C.walk / 2]]) {
    addBox(X(ax), Z(az), hx, hz, 0, y + 6.9, y + 5.6);
  }
  for (let k = 1; k < 24; k++) {
    const t = C.z0 + (C.z1 - C.z0) * k / 24, s = C.x0 + (C.x1 - C.x0) * k / 24;
    for (const [hx, lx2] of [[C.x0 + 0.5, gx0], [C.x1 - 0.5, gx1]]) {
      if (t < gz0 || t > gz1) continue;
      ext.slab('oak', Math.hypot(lx2 - hx, 1.6), 0.16, 0.14, new THREE.Matrix4().makeRotationZ(Math.atan2(-1.6, lx2 - hx)).setPosition(X((hx + lx2) / 2), y + 6.45, Z(t)), TINT.oakDark);
    }
    for (const [hz, lz2] of [[C.z0 + 0.5, gz0], [C.z1 - 0.5, gz1]]) {
      if (s < gx0 || s > gx1) continue;
      ext.slab('oak', 0.14, 0.16, Math.hypot(lz2 - hz, 1.6), new THREE.Matrix4().makeRotationX(Math.atan2(1.6, lz2 - hz) - (lz2 > hz ? 0 : Math.PI)).setPosition(X(s), y + 6.45, Z((hz + lz2) / 2)), TINT.oakDark);
    }
  }
  // Fountain at the crossing of the paths.
  ext.cyl('marble', mx, floor, mz, 2.7, 2.8, 0.5, TINT.white, 8, 0.1);
  lathe(ext, 'marble', mx, floor + 0.5, mz, [[2.5, 0], [2.6, 0.08], [2.6, 0.32], [2.3, 0.32], [2.25, 0.1]], TINT.white, 24, 0);
  ext.cyl('plain', mx, floor + 0.62, mz, 2.28, 2.28, 0.05, 0x8fcbe6, 24, 0);
  lathe(ext, 'marble', mx, floor + 0.5, mz, [[0.5, 0], [0.34, 0.3], [0.22, 1.5], [0.34, 1.7], [1.1, 1.95], [1.3, 2.1], [1.25, 2.16], [0.3, 2.0], [0.16, 2.9], [0.5, 3.1], [0.56, 3.2], [0.1, 3.14], [0.06, 3.7]], TINT.white, 16, 0);
  ext.cyl('plain', mx, floor + 2.58, mz, 1.18, 1.18, 0.04, 0x8fcbe6, 16, 0);
  ext.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 0.4, 0.15), { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03), TINT.gold, place(mx, floor + 4.6, mz), 0);
  addRound(mx, mz, 2.8, y + 1.0);
  // Four beds of flowers and clipped yews in the quarters.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const bx = mx + sx * 7.1, bz = mz + sz * 7.1;
    ext.box('ashlar', bx, y, bz, 7.4, 0.3, 7.4, 0, TINT.trim, 0);
    ext.box('plain', bx, y + 0.06, bz, 6.9, 0.3, 6.9, 0, 0x6a5238, 0);
    // Flowers in clumps round a clipped yew; each clump's place and size come from the draws the old bed made.
    for (let k = 0; k < 60; k++) {
      const jx = c.rand() - 0.5, jz = c.rand() - 0.5, size = c.rand(); c.rand(); c.rand();
      if (k % 4 === 2) c.rand();
      if (k >= 9 || k === 4) continue;
      const lx = (k % 3 - 1) * 2.3, lz = (Math.floor(k / 3) - 1) * 2.3;
      plant('bed', bx + lx + jx * 0.3, y + 0.34, bz + lz + jz * 0.3, 1.3 + size * 0.25);
    }
    plant('yew', bx, y + 0.34, bz, 1.0);
    addBox(bx, bz, 3.7, 3.7, 0, y + 0.36);
    addRound(bx, bz, 0.9, y + 3);
  }
  // Benches and lamps in the walks.
  for (const [lx, lz, rot] of [[C.x0 + 1.0, 9, Math.PI / 2], [C.x0 + 1.0, 27, Math.PI / 2], [C.x1 - 1.0, 9, -Math.PI / 2], [C.x1 - 1.0, 29, -Math.PI / 2], [37, C.z0 + 0.9, 0], [45, C.z1 - 0.9, Math.PI]] as [number, number, number][]) {
    const [bx, bz] = c.W(lx, lz);
    inside.box('marble', bx, floor, bz, 2.6, 0.45, 0.6, rot, TINT.white, 0.1);
    inside.box('marble', bx, floor + 0.45, bz, 2.9, 0.1, 0.72, rot, TINT.white, 0);
  }
  for (const [lx, lz] of [[C.x0 + C.walk / 2, 10], [C.x0 + C.walk / 2, 28], [C.x1 - C.walk / 2, 10], [C.x1 - C.walk / 2, 28], [30, C.z0 + C.walk / 2], [46, C.z0 + C.walk / 2], [30, C.z1 - C.walk / 2], [46, C.z1 - C.walk / 2]]) {
    const [lx2, lz2] = c.W(lx, lz);
    c.lamps.push(lantern(inside, lx2, y + 6.4, lz2, 2.2, 0.7, TINT.bronze, TINT.gold, TINT.lamp));
  }
}

/** The octagonal chapter house: one central pier, an annular vault, a bench round the walls. */
function chapterHouse(c: Ctx): void {
  const { ext, inside, y } = c, { x: lx, z: lz, r } = PLAN.chapter, floor = y + 0.04;
  const [X, Z] = c.W(lx, lz), R = r / Math.cos(Math.PI / 8), top = 11;
  const corner = (k: number): [number, number] => [lx + Math.cos(Math.PI / 8 - k * Math.PI / 4) * R, lz + Math.sin(Math.PI / 8 - k * Math.PI / 4) * R];
  const kinds = [GLASS.castle, GLASS.river, GLASS.lattice];
  for (let k = 0; k < 8; k++) {
    const a = corner(k), e = corner(k + 1), mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    const dominant = Math.abs(e[0] - a[0]) > Math.abs(e[1] - a[1]) ? mid[0] : mid[1];
    const west = mid[0] < lx - r * 0.9;
    const wins: Win[] = west ? [{ p: dominant, w: 2.4, sill: 0, spring: 3.0, door: true }]
      : [{ p: dominant, w: 3.6, sill: 2.9, spring: 6.4, glass: kinds[k % 3], levels: 2, seed: k * 1.7 }];
    c.shell(a, e, -6, top, 1.0, wins);
    // Angle buttresses under pinnacles, and a stone bench inside.
    const [bx, bz] = c.W(lx + (a[0] - lx) * 1.07, lz + (a[1] - lz) * 1.07), turn = -Math.atan2(a[1] - lz, a[0] - lx);
    ext.box('ashlar', bx, y - 8, bz, 1.6, top + 8, 1.2, turn, TINT.lime, 0.06);
    pinnacle(ext, 'ashlar', bx, y + top, bz, 1.0, 5.6, TINT.trim, TINT.gold);
    if (!west) {
      const [sx, sz] = c.W(lx + (mid[0] - lx) * 0.9, lz + (mid[1] - lz) * 0.9);
      inside.box('marble', sx, floor, sz, 6.2, 0.5, 0.8, -Math.atan2(mid[1] - lz, mid[0] - lx) + Math.PI / 2, TINT.white, 0.1);
    }
  }
  inside.add('tile', new THREE.CylinderGeometry(R - 0.4, R - 0.4, 0.24, 8).translate(0, 0.12, 0), 0xffffff, place(X, y - 0.2, Z, Math.PI / 8), 0);
  ext.add('ashlar', new THREE.CylinderGeometry(R + 0.4, R + 0.4, 0.6, 8).translate(0, 0.3, 0), TINT.lime, place(X, y - 0.62, Z, Math.PI / 8), 0);
  addRound(X, Z, R, floor);
  // The vault springs from the middle pier like the ribs of a palm.
  pier(inside, X, floor, Z, 0.82, 6.2, TINT.white, TINT.gold);
  addRound(X, Z, 1.1, y + top);
  const profile = (t: number): number => y + 6.2 + 3.6 * Math.sin(Math.PI * Math.min(1, t * 1.02)) * (1 - 0.18 * t);
  const pos: number[] = [], segs = 32, rings = 7;
  const at = (i: number, j: number): [number, number, number] => {
    const a = i / segs * Math.PI * 2, t = j / rings, rad = 0.9 + (R - 1.2) * t * (0.924 / Math.max(0.924, Math.cos(((a + Math.PI / 8) % (Math.PI / 4)) - Math.PI / 8)));
    return [X + Math.cos(a) * rad, profile(t), Z + Math.sin(a) * rad];
  };
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) pos.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
  const web = new THREE.BufferGeometry();
  web.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); web.computeVertexNormals();
  inside.add('fresco', web, TINT.fresco, undefined, 0);
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2 + Math.PI / 8, reach = k % 2 ? R - 0.9 : r - 0.7;
    const pts = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(X + Math.cos(a) * (0.9 + (reach - 0.9) * i / 8), profile(i / 8) - 0.12, Z + Math.sin(a) * (0.9 + (reach - 0.9) * i / 8)));
    inside.add('marble', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, k % 2 ? 0.15 : 0.11, 6, false), TINT.white, undefined, 0);
  }
  lathe(inside, 'gilt', X, y + 6.25, Z, [[1.2, 0], [1.3, 0.06], [1.2, 0.12]], TINT.gold, 16, 0);
  c.lamps.push(lantern(inside, X + 4.2, y + 9.4, Z, 3.6, 0.9, TINT.bronze, TINT.gold, TINT.lamp), lantern(inside, X - 2.1, y + 9.4, Z + 3.6, 3.6, 0.9, TINT.bronze, TINT.gold, TINT.lamp),
    lantern(inside, X - 2.1, y + 9.4, Z - 3.6, 3.6, 0.9, TINT.bronze, TINT.gold, TINT.lamp));
  // The abbot's seat opposite the door, and a lectern.
  const [sx, sz] = c.W(lx + r - 1.5, lz);
  inside.box('oak', sx, floor + 0.5, sz, 0.9, 0.1, 1.3, 0, TINT.oak, 0);
  inside.box('oak', sx + 0.4, floor + 0.5, sz, 0.12, 2.3, 1.5, 0, TINT.oakDark, 0.1);
  inside.prism('oak', sx + 0.4, floor + 2.8, sz, 1.5, 0.14, 0.7, Math.PI / 2, TINT.oakDark);
  inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.26, 0.1)).rotateY(-Math.PI / 2), TINT.gold, place(sx + 0.33, floor + 2.3, sz), 0);
  const [px, pz] = c.W(lx + 2.6, lz);
  inside.cyl('oak', px, floor, pz, 0.08, 0.3, 1.2, TINT.oakDark, 8, 0.1);
  inside.slab('oak', 0.7, 0.05, 0.5, new THREE.Matrix4().makeRotationZ(0.5).setPosition(px, floor + 1.3, pz), TINT.oak);
  inside.slab('velvet', 0.5, 0.03, 0.4, new THREE.Matrix4().makeRotationZ(0.5).setPosition(px - 0.02, floor + 1.34, pz), 0xfff6e0);
  // Passage from the cloister.
  const C = PLAN.cloister, [vx, vz] = c.W((C.x1 + lx - r) / 2, lz);
  inside.box('tile', vx, y - 0.2, vz, lx - r - C.x1 + 0.6, 0.24, 3.6, 0, 0xffffff, 0);
  addBox(vx, vz, (lx - r - C.x1) / 2 + 0.3, 1.8, 0, floor);
  for (const side of [-1, 1]) {
    ext.box('ashlar', vx, y - 6, vz + side * 2.0, lx - r - C.x1 + 0.8, 10.4, 0.6, 0, TINT.lime, 0.05);
    inside.box('marble', vx, y, vz + side * 1.72, lx - r - C.x1 + 0.4, 4.3, 0.08, 0, TINT.white, 0.03);
    addBox(vx, vz + side * 2.0, (lx - r - C.x1) / 2 + 0.4, 0.3, 0, y + 4.4);
  }
  ext.prism('slate', vx, y + 4.4, vz, 4.9, lx - r - C.x1 + 1.2, 1.5, Math.PI / 2, TINT.slate);
  // An eight-sided spire of slate, with a gilded star.
  const cone = new THREE.ConeGeometry(R + 0.7, 10, 8, 1, true).rotateY(Math.PI / 8).translate(0, 5, 0).toNonIndexed();
  cone.computeVertexNormals();
  ext.add('slate', cone, TINT.slate, place(X, y + top, Z), 0.08);
  ext.add('ashlar', new THREE.CylinderGeometry(R + 0.75, R + 0.75, 0.45, 8).translate(0, 0.22, 0), TINT.trim, place(X, y + top - 0.3, Z, Math.PI / 8), 0);
  ext.cyl('gilt', X, y + top + 9.6, Z, 0.06, 0.16, 2.0, TINT.gold, 6, 0);
  ext.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 0.9, 0.32), { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05), TINT.gold, place(X, y + top + 12.3, Z), 0);
  addRound(X, Z, R + 0.6, (ax, az) => y + top + 10 * Math.max(0, 1 - Math.hypot(ax, az) / (R + 0.6)), y + top - 0.5);
}

/** The library: presses of books, two long tables, a globe, and light from the north. */
function library(c: Ctx): void {
  const { ext, inside, y } = c, L = PLAN.library, floor = y + 0.04, h = 8.4;
  const [mx, mz] = c.W((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2), w = L.x1 - L.x0, d = L.z1 - L.z0;
  inside.box('oak', mx, y - 0.2, mz, w - 0.8, 0.24, d - 0.8, 0, 0xc49a66, 0);
  ext.box('ashlar', mx, y - 0.62, mz, w + 0.8, 0.6, d + 0.8, 0, TINT.lime, 0);
  addBox(mx, mz, w / 2, d / 2, 0, floor);
  const gable = (p: number): number => h + 0.5 + 5.6 * Math.max(0, 1 - Math.abs(p - (L.z0 + L.z1) / 2) / (d / 2 + 0.4));
  const win = (p: number): Win => ({ p, w: 2.6, sill: 2.7, spring: 5.2, glass: GLASS.quarry, levels: 1, seed: p });
  c.shell([L.x1, L.z0], [L.x0, L.z0], -6, h, 1.0, [35, 41.2, 47.4, 52.6].map(win));
  c.shell([L.x1, L.z1], [L.x1, L.z0], -6, gable, 1.0, [{ p: (L.z0 + L.z1) / 2, w: 4.6, sill: 2.7, spring: 5.6, glass: GLASS.castle, levels: 2, seed: 4.4 }]);
  c.shell([L.x0, L.z0], [L.x0, L.z1], -6, gable, 1.0);
  c.shell([L.x0, L.z1], [L.x1, L.z1], -6, h, 1.0, [{ p: 43, w: 2.2, sill: 0, spring: 2.9, door: true }]);
  gableRoof(ext, mx, mz, d / 2 + 0.5, w + 1.2, y + h, 5.6, true);
  addBox(mx, mz, w / 2 + 0.6, d / 2 + 0.5, 0, (_lx, lz) => y + h + 0.4 + 5.6 * (1 - Math.abs(lz) / (d / 2 + 0.5)), y + h - 0.4);
  // An open timber roof: tie beams, king posts and a boarded ceiling.
  inside.box('oak', mx, y + h - 0.12, mz, w - 1, 0.1, d - 1, 0, 0xb98e5e, 0);
  for (let lx = L.x0 + 2.4; lx < L.x1 - 1; lx += 3.2) {
    const [bx] = c.W(lx, 0);
    inside.box('oak', bx, y + h - 0.9, mz, 0.3, 0.4, d - 1, 0, TINT.oakDark, 0);
    for (const side of [-1, 1]) inside.slab('oak', 0.22, 0.26, 2.6, new THREE.Matrix4().makeRotationX(side * 0.62).setPosition(bx, y + h - 1.4, mz + side * (d / 2 - 1.5)), TINT.oakDark);
  }
  // Book presses along the north and west walls.
  const spines = [0x7a2f2a, 0x2c4a7e, 0x3f6b46, 0x8a6a2e, 0x5a3566, 0x8c4a2c, 0x30505c, 0xb89a5c];
  const press = (lx: number, lz: number, rot: number, width: number): void => {
    const [x, z] = c.W(lx, lz), m = place(x, 0, z, rot);
    const put = (g: THREE.BufferGeometry, color: number, px: number, py: number, pz: number, mat: 'oak' | 'velvet' | 'gilt' = 'oak'): void => {
      inside.add(mat, g, color, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(px, floor + py, pz)), 0.04);
    };
    put(new THREE.BoxGeometry(width, 4.6, 0.12), TINT.oakDark, 0, 2.3, -0.24);
    for (const side of [-1, 1]) put(new THREE.BoxGeometry(0.12, 4.6, 0.6), TINT.oakDark, side * width / 2, 2.3, 0);
    put(new THREE.BoxGeometry(width + 0.3, 0.2, 0.74), TINT.oakDark, 0, 4.7, 0);
    put(new THREE.BoxGeometry(width + 0.2, 0.3, 0.7), TINT.oakDark, 0, 0.15, 0);
    for (let shelf = 0; shelf < 6; shelf++) {
      const sy = 0.34 + shelf * 0.72;
      put(new THREE.BoxGeometry(width - 0.1, 0.05, 0.56), TINT.oak, 0, sy, 0);
      let u = -width / 2 + 0.12;
      while (u < width / 2 - 0.2) {
        const t = 0.05 + c.rand() * 0.07, bh = 0.4 + c.rand() * 0.22;
        if (c.rand() > 0.07) put(new THREE.BoxGeometry(t, bh, 0.36 + c.rand() * 0.08), spines[Math.floor(c.rand() * spines.length)], u + t / 2, sy + 0.03 + bh / 2, 0.02, 'velvet');
        u += t + 0.006;
      }
    }
    addBox(x, z, width / 2 + 0.1, 0.4, rot, y + 4.8);
  };
  for (const lx of [38.1, 44.3, 50]) press(lx, L.z0 + 0.95, 0, 3.0);
  press(L.x0 + 0.95, -9.4, Math.PI / 2, 3.4); press(L.x0 + 0.95, -4.6, Math.PI / 2, 3.4);
  press(36, L.z1 - 0.95, Math.PI, 5.5); press(50.3, L.z1 - 0.95, Math.PI, 5.5);
  // Reading tables with benches, open books and candles; a globe by the east window.
  for (const lx of [39.5, 48]) {
    const [tx, tz] = c.W(lx, -6.6);
    inside.box('oak', tx, floor + 0.86, tz, 5.6, 0.1, 1.5, 0, TINT.oak, 0);
    for (const sx of [-2.4, 2.4]) inside.box('oak', tx + sx, floor, tz, 0.2, 0.86, 1.2, 0, TINT.oakDark, 0.1);
    inside.box('oak', tx, floor + 0.3, tz, 4.8, 0.1, 0.14, 0, TINT.oakDark, 0);
    for (const side of [-1, 1]) {
      inside.box('oak', tx, floor + 0.46, tz + side * 1.25, 5.0, 0.07, 0.42, 0, TINT.oak, 0);
      for (const sx of [-2.1, 2.1]) inside.box('oak', tx + sx, floor, tz + side * 1.25, 0.1, 0.46, 0.36, 0, TINT.oakDark, 0.1);
    }
    for (const [bx, turn] of [[-1.7, 0.2], [0.4, -0.3], [1.9, 0.1]]) {
      for (const leaf of [-1, 1]) inside.slab('velvet', 0.34, 0.03, 0.46, new THREE.Matrix4().makeRotationY(turn).multiply(new THREE.Matrix4().makeRotationZ(leaf * 0.12)).setPosition(tx + bx + leaf * 0.17 * Math.cos(turn), floor + 0.99, tz + (bx > 0 ? 0.2 : -0.2) - leaf * 0.17 * Math.sin(turn)), 0xfff6e0);
    }
    candlestick(inside, tx - 0.6, floor + 0.96, tz, 0.5, TINT.gold); c.lamps.push(new THREE.Vector3(tx - 0.6, floor + 1.8, tz));
    addBox(tx, tz, 2.8, 0.75, 0, y + 1.0);
  }
  const [gx, gz] = c.W(L.x1 - 2.6, -10.8);
  lathe(inside, 'oak', gx, floor, gz, [[0.5, 0], [0.5, 0.06], [0.1, 0.16], [0.07, 0.8]], TINT.oakDark, 10, 0.1);
  inside.add('velvet', new THREE.SphereGeometry(0.55, 20, 14), 0x4a78b4, place(gx, floor + 1.35, gz), 0);
  inside.add('gilt', new THREE.TorusGeometry(0.62, 0.025, 6, 28), TINT.gold, new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.4).setPosition(gx, floor + 1.35, gz), 0);
  addRound(gx, gz, 0.6, y + 1.9);
  inside.box('velvet', mx, floor, mz + 0.9, w - 6, 0.03, 2.4, 0, 0x7a2f3a, 0);
  for (const lx of [37, 43.6, 50.2]) { const [x, z] = c.W(lx, -6.6); c.lamps.push(lantern(inside, x, y + h - 1.0, z, 3.4, 0.8, TINT.bronze, TINT.gold, TINT.lamp)); }
}

/** The sacristy: vestment presses, plate on the shelves, robes on their pegs. */
function sacristy(c: Ctx): void {
  const { ext, inside, y } = c, S = PLAN.sacristy, floor = y + 0.04, h = 6.6;
  const [mx, mz] = c.W((S.x0 + S.x1) / 2, (S.z0 + S.z1) / 2), w = S.x1 - S.x0, d = S.z1 - S.z0;
  inside.box('tile', mx, y - 0.2, mz, w - 0.6, 0.24, d - 0.4, 0, 0xfff4e2, 0);
  ext.box('ashlar', mx, y - 0.62, mz, w + 0.8, 0.6, d + 0.8, 0, TINT.lime, 0);
  addBox(mx, mz, w / 2, d / 2, 0, floor);
  const win = (p: number): Win => ({ p, w: 2.2, sill: 2.4, spring: 4.2, glass: GLASS.quarry, levels: 1, seed: p });
  c.shell([S.x0, S.z0], [S.x0, S.z1], -6, h, 0.9, [win(-32.2), win(-24)]);
  c.shell([S.x1 + 0.2, S.z0], [S.x0 - 0.45, S.z0], -6, (p) => h + 2.0 * Math.max(0, Math.min(1, (p - S.x0) / w)), 0.9, [win(-24.6)]);
  const X = (lx: number): number => c.ax + lx, Z = (lz: number): number => c.az + lz;
  roofQuad(ext, [[X(S.x1 + 0.3), y + h + 2.2, Z(S.z0 - 0.5)], [X(S.x0 - 0.6), y + h + 0.1, Z(S.z0 - 0.5)], [X(S.x0 - 0.6), y + h + 0.1, Z(S.z1)], [X(S.x1 + 0.3), y + h + 2.2, Z(S.z1)]], 0.28, TINT.slate);
  addBox(mx, mz, w / 2 + 0.4, d / 2 + 0.3, 0, (lx) => y + h + 1.2 + lx * 0.18, y + h - 0.4);
  inside.box('oak', mx, y + h - 0.15, mz, w - 0.9, 0.1, d - 0.5, 0, 0xb98e5e, 0);
  // A long press of drawers under the windows, with plate set out on it.
  const [px, pz] = c.W(S.x0 + 1.15, -28);
  inside.box('oak', px, floor, pz, 1.2, 1.05, 12, 0, TINT.oak, 0.1);
  inside.box('oak', px, floor + 1.05, pz, 1.34, 0.08, 12.2, 0, TINT.oakDark, 0);
  for (let k = 0; k < 8; k++) for (const row of [0.28, 0.72]) {
    inside.box('oak', px + 0.61, floor + row - 0.16, pz - 5.25 + k * 1.5, 0.03, 0.34, 1.34, 0, TINT.oakDark, 0);
    inside.add('bronze', new THREE.SphereGeometry(0.04, 6, 5), TINT.bronze, place(px + 0.65, floor + row, pz - 5.25 + k * 1.5), 0);
  }
  addBox(px, pz, 0.7, 6.1, 0, y + 1.2);
  for (let k = 0; k < 7; k++) {
    const z = pz - 4.6 + k * 1.5 + c.rand() * 0.4;
    if (k % 3 === 0) lathe(inside, 'gilt', px, floor + 1.13, z, [[0.1, 0], [0.1, 0.02], [0.025, 0.05], [0.02, 0.16], [0.045, 0.19], [0.02, 0.22], [0.09, 0.3], [0.1, 0.36]], TINT.gold, 10, 0);
    else if (k % 3 === 1) { inside.box('gilt', px, floor + 1.13, z, 0.34, 0.26, 0.24, 0.3, TINT.gold, 0); inside.pyramid('gilt', px, floor + 1.39, z, 0.38, 0.28, 0.16, 0.3, TINT.gold); }
    else { candlestick(inside, px, floor + 1.13, z, 0.5, TINT.gold); c.lamps.push(new THREE.Vector3(px, floor + 1.95, z)); }
  }
  // Robes of blue, white and gold on a rail by the north wall.
  const [rx, rz] = c.W(-24.6, S.z0 + 1.0);
  inside.box('oak', rx, floor + 2.0, rz, 6.4, 0.08, 0.08, 0, TINT.oakDark, 0);
  for (const sx of [-3.2, 3.2]) inside.box('oak', rx + sx, floor, rz, 0.1, 2.05, 0.1, 0, TINT.oakDark, 0.1);
  [TINT.banner, 0xffffff, 0xd9b45a, TINT.banner, 0x7a2f3a, 0xffffff, 0x2f6a4f].forEach((color, k) => {
    const robe = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.4, -0.3), new THREE.Vector2(0.34, -1.6), new THREE.Vector2(-0.34, -1.6), new THREE.Vector2(-0.4, -0.3)]);
    inside.add('velvet', new THREE.ExtrudeGeometry(robe, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06), color, place(rx - 2.7 + k * 0.9, floor + 1.96, rz + 0.1, 0.1 * (k % 2 ? 1 : -1)), 0.1);
    inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.12, 0.045)), TINT.gold, place(rx - 2.7 + k * 0.9, floor + 1.3, rz + 0.19), 0);
  });
  // A table with the open book of the house, and a lamp.
  const [tx, tz] = c.W(-22, -24);
  inside.box('oak', tx, floor + 0.82, tz, 2.4, 0.09, 1.3, 0, TINT.oak, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) inside.box('oak', tx + sx * 1.05, floor, tz + sz * 0.5, 0.12, 0.82, 0.12, 0, TINT.oakDark, 0.1);
  for (const leaf of [-1, 1]) inside.slab('velvet', 0.4, 0.04, 0.54, new THREE.Matrix4().makeRotationZ(leaf * 0.12).setPosition(tx + leaf * 0.2, floor + 0.95, tz), 0xfff6e0);
  addBox(tx, tz, 1.2, 0.65, 0, y + 1.0);
  c.lamps.push(lantern(inside, mx, y + h - 0.3, mz, 2.3, 0.8, TINT.bronze, TINT.gold, TINT.lamp));
}

/** The forecourt: a paved terrace above the gorge, where the viaduct and the pilgrims' path arrive. */
function forecourt(c: Ctx): void {
  const { ext, y } = c, F = PLAN.forecourt;
  const [mx, mz] = c.W((F.x0 + F.x1) / 2, (F.z0 + F.z1) / 2);
  ext.box('paving', mx, y - 0.4, mz, F.x1 - F.x0, 0.45, F.z1 - F.z0, 0, 0xeadfc8, 0);
  addBox(mx, mz, (F.x1 - F.x0) / 2, (F.z1 - F.z0) / 2, 0, y + 0.05);
  // A wide band of darker setts leads from the gap in the balustrade to the portal.
  ext.box('paving', c.ax, y - 0.38, mz, 6.4, 0.45, F.z1 - F.z0, 0, 0xd4c4a4, 0);
  ext.add('gilt', new THREE.ShapeGeometry(starShape(8, 2.6, 0.95)).rotateX(-Math.PI / 2), TINT.gold, place(c.ax, y + 0.085, c.az + 56), 0);
  // The viaduct leaves through a gap in the western balustrade.
  balustrade(ext, 'ashlar', c.W(F.x0, F.z0 + 3), c.W(F.x0, 55), y + 0.05, 1.05, TINT.trim);
  balustrade(ext, 'ashlar', c.W(F.x0, 65), c.W(F.x0, F.z1), y + 0.05, 1.05, TINT.trim);
  balustrade(ext, 'ashlar', c.W(F.x0, F.z1), c.W(-7, F.z1), y + 0.05, 1.05, TINT.trim);
  balustrade(ext, 'ashlar', c.W(7, F.z1), c.W(F.x1 - 9, F.z1), y + 0.05, 1.05, TINT.trim);
  // Lamp pillars at the gap, urns along the edge, two flower parterres and two figures.
  for (const [lx, lz] of [[-7, F.z1], [7, F.z1], [F.x0, 55], [F.x0, 65]]) {
    const [x, z] = c.W(lx, lz);
    ext.box('ashlar', x, y, z, 1.1, 3.2, 1.1, 0, TINT.trim, 0.08);
    pinnacle(ext, 'ashlar', x, y + 3.2, z, 0.9, 2.6, TINT.trim, TINT.gold);
    addBox(x, z, 0.55, 0.55, 0, y + 3.2);
  }
  for (const [lx, lz] of [[F.x0 + 0.2, 46], [F.x0 + 0.2, 71], [-14.5, F.z1 - 0.2], [15, F.z1 - 0.2]]) {
    const [x, z] = c.W(lx, lz);
    flowerUrn(ext, x, y + 1.1, z, 0.85, TINT.trim, c.rand);
  }
  for (const side of [-1, 1]) {
    const [bx, bz] = c.W(side * 13, 64);
    ext.box('ashlar', bx, y, bz, 7.6, 0.42, 10.6, 0, TINT.trim, 0);
    ext.box('plain', bx, y + 0.1, bz, 7.0, 0.4, 10, 0, 0x6a5238, 0);
    addBox(bx, bz, 3.8, 5.3, 0, y + 0.5);
    // A parterre of flower clumps round the figure's pedestal.
    for (let k = 0; k < 80; k++) {
      const jx = c.rand() - 0.5, jz = c.rand() - 0.5, size = c.rand(); c.rand(); c.rand();
      if (k % 4 === 2) c.rand();
      if (k >= 12) continue;
      const i = k % 3, j = Math.floor(k / 3), lx = (i - 1) * 2.15, lz = (j - 1.5) * 2.4;
      if (i === 1 && (j === 1 || j === 2)) continue;
      plant('bed', bx + lx + jx * 0.3, y + 0.48, bz + lz + jz * 0.3, 1.3 + size * 0.2);
    }
    ext.box('ashlar', bx, y + 0.4, bz, 1.5, 1.6, 1.5, 0, TINT.trim, 0.08);
    statue(ext, bx, y + 2.0, bz, 3.0, 0, TINT.trim);
    addBox(bx, bz, 0.8, 0.8, 0, y + 4.6);
  }
}

export function buildPrecinct(c: Ctx): void {
  cloister(c); chapterHouse(c); library(c); sacristy(c); forecourt(c);
}
