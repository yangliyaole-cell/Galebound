import * as THREE from 'three';
import { Builder, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import { heightAt } from '../heightmap';
import { BLOSSOM, FOREST, ISLAND, LIGHTHOUSE, START, STONES, WATCHTOWER, WINDMILL } from '../layout';
import { seededRandom } from '../noise';
import { beam, fence, wrapStairs } from './common';
import { ROOFS, SHUTTERS, WALLS, addHouse } from './house';

const STONE = 0xd2cbbb;
const OLD = 0xbdb7a8;
const MOSS = 0xa9b48a;

/** Tumbled blocks of an old wall beside the starting point, as in the concept art. */
function startRuins(b: Builder, rand: () => number): void {
  const runs: [number, number, number, number, number[]][] = [
    // x, z, direction, block length, heights of each stack
    [START.x - 6.5, START.z + 4.5, -0.75, 1.7, [3, 3, 2, 3, 1, 2]],
    [START.x + 3.2, START.z - 3.8, 0.35, 1.7, [2, 1, 0, 1]],
  ];
  for (const [x0, z0, dirA, len, stacks] of runs) {
    stacks.forEach((n, i) => {
      const x = x0 + Math.cos(dirA) * i * (len + 0.06);
      const z = z0 - Math.sin(dirA) * i * (len + 0.06);
      const ground = heightAt(x, z) - 0.25;
      for (let k = 0; k < n; k++) {
        const jx = (rand() - 0.5) * 0.14;
        const top = k === n - 1;
        b.box('stone', x + jx, ground + k * 0.95, z + jx, len, 0.95, 1.15, dirA + (rand() - 0.5) * 0.1, top ? MOSS : OLD, 0.12);
      }
      if (n > 0) addBox(x, z, len / 2, 0.58, dirA, ground + n * 0.95);
    });
  }
  // A fallen block or two.
  for (let i = 0; i < 4; i++) {
    const x = START.x - 4 + rand() * 9;
    const z = START.z + 6 + rand() * 4;
    b.box('stone', x, heightAt(x, z) - 0.3, z, 1.5, 0.8, 1.0, rand() * 3, OLD, 0.2);
  }
  orbAt('start-wall', START.x - 6.5 + Math.cos(-0.75) * 1.76, START.z + 4.5 + Math.sin(0.75) * 1.76, 1.2);
  fence(b, [[START.x + 9, START.z - 2], [START.x + 20, START.z - 12], [START.x + 34, START.z - 26], [START.x + 44, START.z - 44]]);
}

export interface Spinner {
  /** The part that turns, about its own Z axis. */
  wheel: THREE.Object3D;
  /** Radians per second at full wind. */
  speed: number;
}

function windmill(b: Builder, rand: () => number): Spinner & { object: THREE.Object3D } {
  const { x, z } = WINDMILL;
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 2.5, z, 4.5, 4.7, 3.7, STONE, 18, 0.2);
  b.cyl('plaster', x, y + 1.2, z, 3.0, 4.2, 12, 0xf6f0e2, 18, 0.12);
  b.cone('roof', x, y + 13.2, z, 3.7, 3.6, 0x6b5a4e, 18);
  b.cyl('wood', x, y + 12.9, z, 3.25, 3.25, 0.35, 0x6a4c34, 18, 0);
  addRound(x, z, 4.3, y + 13.2);
  // Door and windows.
  const face = 2.4;
  b.box('wood', x + Math.sin(face) * 4.15, y + 1.1, z + Math.cos(face) * 4.15, 1.2, 2.2, 0.3, face, 0x6d4c33, 0);
  for (const [a, h] of [[2.4, 6.5], [0.6, 5], [4.2, 8.5], [3.4, 10.2]]) {
    const r = 4.2 - ((h - 1.2) / 12) * 1.2 + 0.03;
    b.box('plain', x + Math.sin(a) * r, y + h, z + Math.cos(a) * r, 0.7, 0.95, 0.2, a, 0x34526d, 0);
  }
  // A timber gallery partway up, reached by a ramp of steps.
  const gy = y + 4.6;
  b.cyl('wood', x, gy - 0.22, z, 6.0, 6.0, 0.22, 0x9a7a52, 20, 0);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    b.box('wood', x + Math.cos(a) * 5.8, gy, z + Math.sin(a) * 5.8, 0.12, 1.0, 0.12, 0, 0x6a4c34, 0);
    const a2 = ((k + 1) / 14) * Math.PI * 2;
    beam(b, 'wood', new THREE.Vector3(x + Math.cos(a) * 5.8, gy + 0.95, z + Math.sin(a) * 5.8), new THREE.Vector3(x + Math.cos(a2) * 5.8, gy + 0.95, z + Math.sin(a2) * 5.8), 0.1, 0x6a4c34);
    beam(b, 'wood', new THREE.Vector3(x + Math.cos(a) * 3.6, gy - 1.9, z + Math.sin(a) * 3.6), new THREE.Vector3(x + Math.cos(a) * 5.7, gy - 0.2, z + Math.sin(a) * 5.7), 0.14, 0x6a4c34);
  }
  addRound(x, z, 6.0, gy, gy - 0.3);
  {
    const rot = -0.9;
    const run = 11;
    const cx = x + Math.cos(rot) * (6.0 + run / 2 - 0.3);
    const cz = z - Math.sin(rot) * (6.0 + run / 2 - 0.3);
    const fx = x + Math.cos(rot) * (6.0 + run);
    const fz = z - Math.sin(rot) * (6.0 + run);
    const foot = heightAt(fx, fz);
    const shape = new THREE.Shape();
    shape.moveTo(-run / 2, gy - 0.4);
    shape.lineTo(run / 2, foot - 2);
    shape.lineTo(run / 2, foot);
    shape.lineTo(-run / 2, gy);
    shape.closePath();
    b.shape('wood', shape, 1.7, place(cx, 0, cz, rot), 0x9a7a52);
    addBox(cx, cz, run / 2, 0.85, rot, (lx) => gy + ((lx + run / 2) / run) * (foot - gy));
  }
  orbAt('windmill-gallery', x - 5.2, z + 0.5, 1.2);
  orbAt('windmill-cap', x, z, 1.4);

  // The sails are a separate object so they can turn.
  const sails = new Builder();
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Matrix4().makeRotationZ((k * Math.PI) / 2);
    sails.slab('wood', 0.26, 9.6, 0.2, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(0, 4.9, 0)), 0x6a4c34);
    sails.slab('cloth', 1.9, 7.2, 0.06, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(1.05, 5.7, 0.04)), 0xf2ead8);
    for (let r = 0; r < 6; r++) {
      sails.slab('wood', 2.0, 0.08, 0.1, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(1.05, 2.4 + r * 1.3, 0.1)), 0x6a4c34);
    }
  }
  sails.add('wood', new THREE.CylinderGeometry(0.5, 0.5, 1.6, 10).rotateX(Math.PI / 2), 0x5a4030);
  const wheel = sails.build();
  const hub = new THREE.Group();
  hub.add(wheel);
  for (const child of wheel.children) child.matrixAutoUpdate = false;
  // Face the valley to the south-west.
  hub.position.set(x + Math.sin(face) * 3.9, y + 11.2, z + Math.cos(face) * 3.9);
  hub.rotation.y = face;

  // Farmhouse and barn below the mill.
  const farm = addHouse(b, {
    x: x - 16, z: z + 15, rot: 0.9, w: 9, d: 7, floors: 2, roof: ROOFS[1], wall: WALLS[0],
    timber: true, ridgeAlongFront: true, shutters: SHUTTERS[1], chimney: true,
  }, rand);
  addHouse(b, {
    x: x + 14, z: z + 19, rot: -0.5, w: 11, d: 7.5, floors: 1, roof: ROOFS[2], wall: 0xb99872,
    timber: false, ridgeAlongFront: false, shutters: SHUTTERS[3], chimney: false,
  }, rand);
  orbAt('farm-roof', farm.spec.x, farm.spec.z, 1.2);
  return { object: hub, wheel, speed: 1.5 };
}

/** A broken tower on a hill; stairs wind round the outside to the top. */
function watchtower(b: Builder, rand: () => number): void {
  const { x, z } = WATCHTOWER;
  const rot = 0.4;
  const y = heightAt(x, z);
  const half = 3.6;
  const top = y + 15;
  b.box('stone', x, y - 3, z, half * 2, top - y + 3, half * 2, rot, OLD, 0.18);
  addBox(x, z, half, half, rot, top);
  // What is left of the battlements.
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let k = 0; k < 12; k++) {
    if (rand() < 0.4) continue;
    const side = Math.floor(k / 3);
    const u = (k % 3 - 1) * 2.3;
    const [lx, lz] = side === 0 ? [u, half - 0.3] : side === 1 ? [half - 0.3, u] : side === 2 ? [u, -half + 0.3] : [-half + 0.3, u];
    b.box('stone', x + lx * c + lz * s, top, z - lx * s + lz * c, 1.3, 0.6 + rand() * 1.1, 0.6, rot + (side % 2 ? Math.PI / 2 : 0), OLD, 0);
  }
  for (const [u, h] of [[0, 5], [0, 10]]) {
    b.box('plain', x + u * c + (half + 0.02) * s, y + h, z - u * s + (half + 0.02) * c, 0.5, 1.4, 0.1, rot, 0x2a3440, 0);
  }
  wrapStairs(b, x, z, half, rot, y - 0.2, top, 4, 2.4, OLD);
  orbAt('watchtower-top', x, z, 1.3);
  // Fallen masonry round the foot.
  for (let i = 0; i < 9; i++) {
    const a = rand() * 6.28;
    const r = 8 + rand() * 9;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    b.box('stone', px, heightAt(px, pz) - 0.3, pz, 1 + rand(), 0.6 + rand() * 0.5, 0.9, rand() * 3, i % 3 ? OLD : MOSS, 0.2);
  }
}

function lighthouse(b: Builder, rand: () => number): void {
  const { x, z } = LIGHTHOUSE;
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 3, z, 4.2, 4.6, 4.4, STONE, 18, 0.2);
  // White tower with red bands.
  const bands = 5;
  const h = 4.4;
  for (let k = 0; k < bands; k++) {
    const r0 = 3.5 - (k * 0.9) / bands;
    const r1 = 3.5 - ((k + 1) * 0.9) / bands;
    b.cyl('plaster', x, y + 1.4 + k * h, z, r1, r0, h, k % 2 ? 0xc9482f : 0xf7f2e6, 18, k === 0 ? 0.15 : 0);
  }
  const gy = y + 1.4 + bands * h;
  b.cyl('wood', x, gy, z, 4.1, 3.6, 0.35, 0x4a4038, 18, 0);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const a2 = ((k + 1) / 12) * Math.PI * 2;
    b.box('wood', x + Math.cos(a) * 3.95, gy + 0.35, z + Math.sin(a) * 3.95, 0.1, 1.0, 0.1, 0, 0x4a4038, 0);
    beam(b, 'wood', new THREE.Vector3(x + Math.cos(a) * 3.95, gy + 1.3, z + Math.sin(a) * 3.95), new THREE.Vector3(x + Math.cos(a2) * 3.95, gy + 1.3, z + Math.sin(a2) * 3.95), 0.08, 0x4a4038);
  }
  b.cyl('plain', x, gy + 0.35, z, 2.1, 2.1, 2.6, 0xffe9a0, 12, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box('wood', x + Math.cos(a) * 2.15, gy + 0.35, z + Math.sin(a) * 2.15, 0.14, 2.6, 0.14, -a, 0x4a4038, 0);
  }
  b.cone('roof', x, gy + 2.95, z, 2.9, 2.8, 0xb9442f, 14);
  b.cyl('wood', x, gy + 5.7, z, 0.08, 0.08, 1.4, 0x4a4038, 6, 0);
  addRound(x, z, 3.6, gy + 0.35);
  addRound(x, z, 4.1, gy + 0.35, gy - 0.1);
  addRound(x, z, 2.2, gy + 3);
  orbAt('lighthouse-gallery', x + 3.1, z, 1.2);

  const cottage = addHouse(b, {
    x: x - 15, z: z - 9, rot: 2.2, w: 8, d: 6.5, floors: 1, roof: ROOFS[0], wall: WALLS[1],
    timber: false, ridgeAlongFront: true, shutters: SHUTTERS[2], chimney: true,
  }, rand);
  orbAt('keeper-roof', cottage.spec.x, cottage.spec.z, 1.2);
  fence(b, [[x - 26, z - 2], [x - 24, z - 20], [x - 8, z - 22], [x + 6, z - 12]]);
  orbAt('cape-point', x + 26, z + 30, 1.2);
}

/** An old ring of standing stones on the eastern highland. */
function standingStones(b: Builder, rand: () => number): void {
  const { x, z } = STONES;
  const n = 11;
  const r = 13;
  const tops: { x: number; z: number; top: number; a: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const y = heightAt(px, pz);
    const h = k === 3 ? 2.2 : 4.6 + rand() * 1.6;
    const lean = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rand() - 0.5) * 0.14, -a, (rand() - 0.5) * 0.14));
    lean.setPosition(px, y + h / 2 - 0.8, pz);
    b.slab('stone', 1.1, h + 1.6, 2.1, lean, k % 4 === 0 ? MOSS : OLD);
    addBox(px, pz, 0.6, 1.1, -a, y + h);
    tops.push({ x: px, z: pz, top: y + h, a });
  }
  // Two lintels still in place.
  for (const k of [0, 6]) {
    const p = tops[k];
    const q = tops[k + 1];
    const top = Math.max(p.top, q.top);
    const mx = (p.x + q.x) / 2;
    const mz = (p.z + q.z) / 2;
    const rot = Math.atan2(-(q.z - p.z), q.x - p.x);
    b.box('stone', mx, top, mz, Math.hypot(q.x - p.x, q.z - p.z) + 1.6, 1.0, 1.5, rot, OLD, 0);
    addBox(mx, mz, Math.hypot(q.x - p.x, q.z - p.z) / 2 + 0.8, 0.75, rot, top + 1.0, top);
    orbAt(`stones-lintel-${k}`, mx, mz, 1.2);
  }
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 0.6, z, 2.3, 2.5, 1.3, OLD, 9, 0.2);
  addRound(x, z, 2.3, y + 0.7);
  orbAt('stones-altar', x, z, 1.4);
}

/** A ruined pavilion on the island in the lake. */
function islandPavilion(b: Builder): void {
  const { x, z } = ISLAND;
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 1.2, z, 5.2, 5.6, 1.6, STONE, 14, 0.2);
  addRound(x, z, 5.2, y + 0.4);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const h = k === 2 ? 1.6 : k === 5 ? 2.6 : 4.2;
    b.cyl('stone', x + Math.cos(a) * 4.2, y + 0.4, z + Math.sin(a) * 4.2, 0.36, 0.42, h, 0xe6e0d2, 10, 0.1);
    addRound(x + Math.cos(a) * 4.2, z + Math.sin(a) * 4.2, 0.42, y + 0.4 + h);
    if (h > 4) {
      const a2 = ((k + 1) / 8) * Math.PI * 2;
      if (k !== 1 && k !== 4) {
        beam(b, 'stone', new THREE.Vector3(x + Math.cos(a) * 4.2, y + 4.85, z + Math.sin(a) * 4.2), new THREE.Vector3(x + Math.cos(a2) * 4.2, y + 4.85, z + Math.sin(a2) * 4.2), 0.7, 0xe6e0d2, 0.5);
      }
    }
  }
  orbAt('island-pavilion', x, z, 1.4);
  orbAt('island-column', x + Math.cos(Math.PI * 1.5) * 4.2, z + Math.sin(Math.PI * 1.5) * 4.2, 1.2);
}

/** A vermilion gate and a stone lantern among the blossom trees. */
function blossomShrine(b: Builder): void {
  const { x, z } = BLOSSOM;
  const y = heightAt(x, z);
  const red = 0xc8452f;
  for (const side of [1, -1]) {
    b.cyl('plain', x + 2.1 * side, y - 0.4, z, 0.2, 0.24, 5.0, red, 10, 0.1);
    addRound(x + 2.1 * side, z, 0.26, y + 4.6);
  }
  b.box('plain', x, y + 3.5, z, 5.2, 0.28, 0.28, 0, red, 0);
  b.box('plain', x, y + 4.3, z, 6.0, 0.3, 0.38, 0, red, 0);
  b.box('plain', x, y + 4.6, z, 6.6, 0.16, 0.5, 0, 0x2a2630, 0);
  addBox(x, z, 3.3, 0.25, 0, y + 4.76, y + 4.3);
  // Stone lantern and steps.
  const lx = x + 4.5;
  const lz = z - 6;
  const ly = heightAt(lx, lz);
  b.cyl('stone', lx, ly - 0.2, lz, 0.5, 0.6, 0.5, STONE, 8, 0.2);
  b.cyl('stone', lx, ly + 0.3, lz, 0.18, 0.2, 1.1, STONE, 8, 0);
  b.box('plain', lx, ly + 1.4, lz, 0.6, 0.55, 0.6, 0, 0xffe9a8, 0);
  b.pyramid('stone', lx, ly + 1.95, lz, 1.2, 1.2, 0.5, 0, OLD);
  for (let k = 0; k < 5; k++) {
    const sz = z + 3 + k * 1.6;
    b.box('stone', x, heightAt(x, sz) - 0.25, sz, 2.4, 0.35, 1.2, 0, OLD, 0.1);
  }
  orbAt('shrine-gate', x, z, 1.2);
  orbAt('blossom-grove', x - 22, z + 14, 1.6);
}

/** A woodcutter's cabin deep in the forest. */
function forestCabin(b: Builder, rand: () => number): void {
  const x = FOREST.x + 30;
  const z = FOREST.z - 20;
  addHouse(b, {
    x, z, rot: -1.2, w: 7.5, d: 6, floors: 1, roof: 0x7a5a44, wall: 0xa98862,
    timber: true, ridgeAlongFront: true, shutters: SHUTTERS[1], chimney: true,
  }, rand);
  // Stacked logs.
  for (let i = 0; i < 6; i++) {
    const lx = x + 6.5 + (i % 3) * 0.55;
    const lz = z + 2;
    const g = new THREE.CylinderGeometry(0.26, 0.26, 2.2, 8).rotateX(Math.PI / 2);
    b.add('wood', g, 0x9a7450, place(lx - (i > 2 ? 0.28 : 0), heightAt(lx, lz) + 0.26 + (i > 2 ? 0.46 : 0), lz));
  }
  orbAt('cabin-roof', x, z, 1.2);
  orbAt('forest-heart', FOREST.x - 40, FOREST.z + 30, 1.5);
}

export function buildLandmarks(): { object: THREE.Group; spinners: Spinner[] } {
  const b = new Builder();
  const rand = seededRandom(77);
  startRuins(b, rand);
  const mill = windmill(b, rand);
  watchtower(b, rand);
  lighthouse(b, rand);
  standingStones(b, rand);
  islandPavilion(b);
  blossomShrine(b);
  forestCabin(b, rand);
  const object = b.build();
  object.add(mill.object);
  return { object, spinners: [mill] };
}
