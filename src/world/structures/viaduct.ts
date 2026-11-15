import * as THREE from 'three';
import { Builder, orbAt, place } from '../build';
import { addBox } from '../colliders';
import { heightAt } from '../heightmap';
import { ABBEY, VIADUCT } from '../layout';
import { pinnacle, starShape } from './gothic';

const STONE = 0xdcd3be, PALE = 0xece4d2, DARK = 0xc4baa4;

/**
 * The Pilgrims' Viaduct: a level road carried on tall round arches from the
 * western tableland across the Cloudfall gorge to the abbey's forecourt. Where
 * the gorge is deep the piers are braced by a lower tier of arches, as the
 * Romans built them; the deck keeps one height from end to end.
 */
export function buildViaduct(): THREE.Group {
  const b = new Builder();
  const { ax, az, bx, bz, width: W } = VIADUCT;
  const deck = ABBEY.floor + 0.05;
  const length = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / length, uz = (bz - az) / length;
  const yaw = Math.atan2(-uz, ux), boxRot = Math.atan2(ux, uz);
  const at = (u: number, v = 0): [number, number] => [ax + ux * u + uz * v, az + uz * u - ux * v];
  const ground = (u: number): number => Math.min(...[-W / 2, 0, W / 2].flatMap((v) => [-1.5, 0, 1.5].map((du) => heightAt(...at(u + du, v)))));
  const bay = VIADUCT.bay, bays = Math.floor(length / bay), pierW = 3.1, body = W - 1.2;
  const frame = place(ax, 0, az, yaw);
  const spans = bays * bay;

  // The arcade, bay by bay: one profile per bay, extruded to the width of the road.
  for (let k = 0; k < bays; k++) {
    const u0 = k * bay, mid = u0 + bay / 2;
    const foot = Math.min(ground(u0), ground(u0 + bay), ground(mid)) - 3;
    const open = bay - pierW, r = open / 2, crown = deck - 2.0, spring = crown - r;
    const low = Math.max(ground(u0 + pierW / 2), ground(u0 + bay - pierW / 2), ground(mid));
    const tall = spring - low;
    const shape = new THREE.Shape();
    shape.moveTo(u0, foot);
    if (tall > 30) {
      // A lower arch between the piers, and solid masonry between the two tiers.
      const tie = low + tall * 0.52, lowCrown = tie - 2.6;
      shape.lineTo(mid - r, foot); shape.lineTo(mid - r, lowCrown - r);
      shape.absarc(mid, lowCrown - r, r, Math.PI, 0, true);
      shape.lineTo(mid + r, foot);
      const upper = new THREE.Path();
      upper.moveTo(mid - r, tie + 0.9); upper.lineTo(mid + r, tie + 0.9); upper.lineTo(mid + r, spring);
      upper.absarc(mid, spring, r, 0, Math.PI, false);
      upper.lineTo(mid - r, tie + 0.9);
      shape.holes.push(upper);
      // The walk along the lower tier, with its own parapet line.
      for (const side of [-1, 1]) b.slab('spanstone', bay, 0.5, 0.7, new THREE.Matrix4().multiplyMatrices(frame, new THREE.Matrix4().setPosition(mid, tie + 0.65, side * (body / 2 + 0.2))), PALE);
    } else if (tall > 1.2) {
      shape.lineTo(mid - r, foot); shape.lineTo(mid - r, Math.max(spring, foot));
      shape.absarc(mid, spring, r, Math.PI, 0, true);
      shape.lineTo(mid + r, foot);
    }
    shape.lineTo(u0 + bay, foot); shape.lineTo(u0 + bay, deck - 0.5); shape.lineTo(u0, deck - 0.5);
    shape.closePath();
    b.shape('spanstone', shape, body, frame, STONE);
    // Voussoirs proud of the face round each upper arch.
    if (tall > 1.2) for (const side of [-1, 1]) {
      const ring = new THREE.Shape();
      ring.absarc(mid, spring, r + 0.7, 0, Math.PI, false);
      ring.lineTo(mid - r, spring);
      ring.absarc(mid, spring, r, Math.PI, 0, true);
      ring.closePath();
      b.add('spanstone', new THREE.ExtrudeGeometry(ring, { depth: 0.22, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, side > 0 ? body / 2 : -body / 2 - 0.22), PALE, frame, 0);
    }
  }
  // Piers: a buttress on each face that steps in twice, pointed cutwaters where they stand in the stream.
  for (let k = 0; k <= bays; k++) {
    const u = k * bay, base = ground(u) - 3, height = deck - base;
    const [px, pz] = at(u);
    for (const side of [-1, 1]) {
      const [qx, qz] = at(u, side * (body / 2 + 0.55));
      b.box('spanstone', qx, base, qz, pierW + 0.5, height * 0.5, 1.5, yaw, STONE, 0.1);
      b.box('spanstone', qx - uz * side * 0.2, base + height * 0.5, qz + ux * side * 0.2, pierW, height * 0.3, 1.1, yaw, STONE, 0);
      b.box('spanstone', qx - uz * side * 0.35, base + height * 0.8, qz + ux * side * 0.35, pierW - 0.6, height * 0.2 - 0.5, 0.8, yaw, DARK, 0);
      // A refuge over each pier, corbelled out from the parapet, with a lamp on alternate ones.
      const [rx, rz] = at(u, side * (W / 2 + 0.35));
      b.box('spanstone', rx, deck - 0.9, rz, pierW, 0.9, 1.3, yaw, PALE, 0);
      b.box('spanstone', rx + uz * side * 0.5, deck, rz - ux * side * 0.5, pierW, 1.15, 0.36, yaw, PALE, 0);
      if (k % 2 === 0) {
        b.cyl('bronze', rx, deck, rz, 0.07, 0.1, 3.0, 0x6b5a44, 6, 0);
        b.box('glow', rx, deck + 3.0, rz, 0.42, 0.5, 0.42, yaw, 0xffe6ad, 0);
        b.pyramid('bronze', rx, deck + 3.5, rz, 0.62, 0.62, 0.36, yaw, 0x6b5a44);
      }
    }
    addBox(px, pz, body / 2 + 1.2, pierW / 2, boxRot, deck - 1.2);
  }
  // The solid abutment that carries the road on to the tableland.
  if (length - spans > 0.5) {
    const [mx, mz] = at((spans + length) / 2), run = length - spans;
    b.box('spanstone', mx, ground(length) - 3, mz, run + 0.4, deck - 0.5 - ground(length) + 3, body, yaw, STONE, 0.08);
  }
  // Deck, string course and parapets.
  const [cx, cz] = at(length / 2);
  b.box('paving', cx, deck - 0.5, cz, length, 0.5, W, yaw, 0xe6dcc4, 0);
  b.box('paving', cx, deck - 0.49, cz, length, 0.5, 2.2, yaw, 0xcfc0a2, 0);
  addBox(cx, cz, W / 2, length / 2, boxRot, deck, deck - 2.4);
  for (const side of [-1, 1]) {
    const [sx, sz] = at(length / 2, side * (W / 2 - 0.2));
    b.box('spanstone', sx, deck - 0.75, sz, length, 0.4, 0.75, yaw, PALE, 0);
    b.box('spanstone', sx, deck, sz, length, 1.0, 0.4, yaw, PALE, 0);
    b.box('spanstone', sx, deck + 1.0, sz, length, 0.14, 0.56, yaw, PALE, 0);
    addBox(sx, sz, 0.22, length / 2, boxRot, deck + 1.14, deck - 2.4);
  }
  // A gate of two crowned piers where the road leaves the tableland, and a star set in the paving.
  for (const side of [-1, 1]) {
    const [gx, gz] = at(length + 1.2, side * (W / 2 + 0.4));
    b.box('spanstone', gx, heightAt(gx, gz) - 1.5, gz, 1.5, deck - heightAt(gx, gz) + 5.5, 1.5, yaw, PALE, 0.08);
    pinnacle(b, 'spanstone', gx, deck + 4, gz, 1.2, 4.2, PALE, 0xe9b64a);
    addBox(gx, gz, 0.75, 0.75, boxRot, deck + 4);
  }
  b.add('gilt', new THREE.ShapeGeometry(starShape(8, 1.9, 0.7)).rotateX(-Math.PI / 2), 0xe9b64a, place(cx, deck + 0.03, cz), 0);
  orbAt('viaduct-mid', ...at(length * 0.4), 1.3);
  orbAt('viaduct-refuge', ...at(bay * 4, W / 2 + 0.4), 1.2);
  const group = b.build(true);
  group.name = 'Pilgrims Viaduct';
  return group;
}
