import * as THREE from 'three';
import { Builder, archedProfile, orbAt, place } from '../build';
import { addBox, addRound } from '../colliders';
import { heightAt } from '../heightmap';
import { BRIDGE, FIELDS, PIER, RIVER, ROADS, VILLAGE, WATER_LEVEL, distToPolyline } from '../layout';
import { cobbleAt, fieldAt, roadAt } from '../maps';
import { seededRandom } from '../noise';
import { beam, fence } from './common';
import { ROOFS, SHUTTERS, WALLS, addHouse, type BuiltHouse } from './house';

export interface VillageInfo {
  houses: BuiltHouse[];
  /** Houses whose doors open for villagers. */
  homes: BuiltHouse[];
  well: { x: number; z: number };
  stalls: { x: number; z: number; rot: number }[];
  benches: { x: number; z: number; rot: number }[];
}

const pick = <T>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

function well(b: Builder, x: number, z: number): void {
  const y = heightAt(x, z);
  b.cyl('stone', x, y - 0.5, z, 1.15, 1.2, 1.45, 0xcfc8b8, 14, 0.2);
  b.cyl('plain', x, y + 0.7, z, 0.9, 0.9, 0.2, 0x2f5a7a, 14, 0);
  for (const side of [1, -1]) b.box('wood', x + 1.0 * side, y + 0.9, z, 0.18, 2.1, 0.18, 0, 0x6a4c34, 0);
  b.box('wood', x, y + 2.75, z, 2.3, 0.14, 0.14, 0, 0x6a4c34, 0);
  b.roof(x, y + 2.95, z, 1.9, 2.6, 0.8, Math.PI / 2, 0xb9553a, 0.25);
  b.cyl('wood', x + 0.25, y + 1.5, z, 0.2, 0.17, 0.32, 0x7a5a3c, 8, 0);
  addRound(x, z, 1.25, y + 0.95);
}

export function stall(b: Builder, x: number, z: number, rot: number, awning: number, rand: () => number): void {
  const y = heightAt(x, z);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.box('wood', x, y, z, 2.6, 0.9, 1.2, rot, 0x8a6a48, 0.15);
  for (const [lx, lz] of [[-1.3, -0.7], [1.3, -0.7], [-1.3, 0.7], [1.3, 0.7]]) {
    b.box('wood', ...([at(lx, lz)[0], y, at(lx, lz)[1]] as [number, number, number]), 0.1, 2.4, 0.1, rot, 0x6a4c34, 0);
  }
  const world = place(x, y, z, rot);
  b.slab('cloth', 3.1, 0.06, 2.2, new THREE.Matrix4().multiplyMatrices(world, new THREE.Matrix4().makeRotationX(0.22).setPosition(0, 2.45, 0.1)), awning);
  b.slab('cloth', 3.1, 0.3, 0.05, new THREE.Matrix4().multiplyMatrices(world, new THREE.Matrix4().setPosition(0, 2.08, 1.15)), 0xf4ecda);
  // Goods on the counter.
  const goods = [0xd9452f, 0xe8b84a, 0x5fa34a, 0xd98a4a, 0x8a5fb0];
  for (let i = 0; i < 9; i++) {
    const [gx, gz] = at(-1.0 + (i % 5) * 0.5, -0.3 + Math.floor(i / 5) * 0.5);
    b.add('plain', new THREE.SphereGeometry(0.13 + rand() * 0.05, 7, 5), pick(goods, rand), place(gx, y + 1.03, gz));
  }
  addBox(x, z, 1.3, 0.6, rot, y + 0.9);
}

function bench(b: Builder, x: number, z: number, rot: number): void {
  const y = heightAt(x, z);
  b.box('wood', x, y + 0.4, z, 1.7, 0.08, 0.45, rot, 0x8a6a48, 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const side of [1, -1]) b.box('wood', x + 0.7 * side * c, y, z - 0.7 * side * s, 0.1, 0.4, 0.4, rot, 0x6a4c34, 0);
  b.box('wood', x - 0.22 * s, y + 0.48, z - 0.22 * c, 1.7, 0.5, 0.07, rot, 0x8a6a48, 0);
}

function barrels(b: Builder, x: number, z: number, rand: () => number): void {
  for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
    const bx = x + (rand() - 0.5) * 1.8;
    const bz = z + (rand() - 0.5) * 1.8;
    const y = heightAt(bx, bz);
    if (rand() < 0.6) {
      b.cyl('wood', bx, y, bz, 0.36, 0.33, 0.95, 0x8a6442, 10, 0.15);
      b.cyl('plain', bx, y + 0.28, bz, 0.375, 0.375, 0.06, 0x4a4038, 10, 0);
      b.cyl('plain', bx, y + 0.66, bz, 0.375, 0.375, 0.06, 0x4a4038, 10, 0);
    } else {
      b.box('wood', bx, y, bz, 0.8, 0.7, 0.8, rand() * 3, 0x9a7a52, 0.15);
    }
  }
}

function haystack(b: Builder, x: number, z: number, size: number): void {
  const y = heightAt(x, z);
  b.cyl('plain', x, y - 0.1, z, 1.5 * size, 1.7 * size, 1.4 * size, 0xdcb85a, 10, 0.25);
  b.cone('plain', x, y + 1.3 * size, z, 1.55 * size, 1.5 * size, 0xe6c66a, 10);
  addRound(x, z, 1.5 * size, y + 2.0 * size);
}

/** The humpbacked stone bridge on the road north. */
function bridge(b: Builder): void {
  const { x, z, length: L, width: W } = BRIDGE;
  const bank = Math.max(heightAt(x, z - L / 2), heightAt(x, z + L / 2)) + 0.08;
  const rise = 2.5;
  const bottom = -3.5;
  const top = (u: number): number => bank + rise * (0.5 + 0.5 * Math.cos((2 * Math.PI * u) / L));
  const shape = archedProfile(
    -L / 2, L / 2, bottom, top,
    [[0, 11], [-12.4, 7.6], [12.4, 7.6]].map(([cx, w]) => ({ x: cx, w, crown: top(Math.abs(cx) + w / 2) - 0.9 })),
    24,
  );
  // The profile is drawn along local X; turn it to run north-south.
  const turn = place(x, 0, z, Math.PI / 2);
  b.shape('stone', shape, W, turn, 0xd3ccbc);

  for (const side of [1, -1]) {
    const rail = new THREE.Shape();
    for (let i = 0; i <= 24; i++) {
      const u = -L / 2 + (L * i) / 24;
      if (i === 0) rail.moveTo(u, top(u) - 0.2);
      else rail.lineTo(u, top(u) - 0.2);
    }
    for (let i = 24; i >= 0; i--) {
      const u = -L / 2 + (L * i) / 24;
      rail.lineTo(u, top(u) + 0.95);
    }
    rail.closePath();
    b.shape('stone', rail, 0.42, place(x + (W / 2 - 0.21) * side, 0, z, Math.PI / 2), 0xc7c0b0);
    addBox(x + (W / 2 - 0.21) * side, z, 0.21, L / 2, 0, (_lx, lz) => top(lz) + 0.95, WATER_LEVEL + 1.6);
    // Lamp posts at the crown.
    b.box('wood', x + (W / 2 - 0.21) * side, top(0) + 0.9, z, 0.14, 1.9, 0.14, 0, 0x4a4038, 0);
    b.box('plain', x + (W / 2 - 0.21) * side, top(0) + 2.8, z, 0.34, 0.42, 0.34, 0, 0xffe9a8, 0);
  }
  addBox(x, z, W / 2, L / 2, 0, (_lx, lz) => top(lz), WATER_LEVEL + 1.6);
  orbAt('bridge-under', x, z + 0.5, 0.9);
  orbAt('bridge-rail', x + W / 2 - 0.2, z, 1.2);
}

function pier(b: Builder): void {
  const { x, z } = PIER;
  const top = 1.0;
  const len = 34;
  b.box('wood', x, top - 0.16, z, len, 0.16, 2.6, 0, 0x9a7a52, 0);
  for (let i = 0; i <= 8; i++) {
    for (const side of [1, -1]) {
      b.cyl('wood', x - len / 2 + (len * i) / 8, -4, z + 1.2 * side, 0.14, 0.14, 4 + top + (i % 2 ? 0.7 : 0.1), 0x6a4c34, 6, 0);
    }
  }
  addBox(x, z, len / 2, 1.3, 0, top, 0.6);
  // A rowing boat tied up at the end.
  const bx = x - len / 2 - 1.5;
  const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.9, 0.7, 2.3);
  b.add('wood', hull, 0x8a5a3a, place(bx, 0.42, z + 2.6, 0.3));
  b.box('wood', bx, 0.2, z + 2.6, 1.5, 0.08, 0.4, 0.3, 0xb08a5a, 0);
  orbAt('pier-end', x - len / 2 + 1, z, 1.2);
}

export function buildVillage(detail: number): { object: THREE.Group; info: VillageInfo } {
  const b = new Builder();
  const rand = seededRandom(31);
  const info: VillageInfo = { houses: [], homes: [], well: { x: 16, z: -196 }, stalls: [], benches: [] };
  const taken: { x: number; z: number; r: number }[] = [{ x: info.well.x, z: info.well.z, r: 13 }];

  const free = (x: number, z: number, r: number): boolean => {
    if (heightAt(x, z) < 2.5 || distToPolyline(x, z, RIVER) < 22 + r * 0.5) return false;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (roadAt(x + ox * 0.8, z + oz * 0.8) > 0.2 || cobbleAt(x + ox, z + oz) > 0.2 || fieldAt(x + ox, z + oz) > 0.1) return false;
    }
    return taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  };

  // Houses line the roads through the village, facing them.
  for (const road of ROADS.slice(0, 5)) {
    if (road.kind !== 'dirt') continue;
    let travelled = 0;
    let next = 6;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i];
      const [bx, bz] = road.pts[i + 1];
      const seg = Math.hypot(bx - ax, bz - az);
      while (next < travelled + seg) {
        const t = (next - travelled) / seg;
        const px = ax + (bx - ax) * t;
        const pz = az + (bz - az) * t;
        next += 11 + rand() * 5;
        if (Math.hypot(px - VILLAGE.x, pz - VILLAGE.z) > VILLAGE.r) continue;
        for (const side of [1, -1]) {
          if (rand() < 0.2) continue;
          const nx = (-(bz - az) / seg) * side;
          const nz = ((bx - ax) / seg) * side;
          const w = 7 + rand() * 3;
          const d = 6 + rand() * 2;
          const off = d / 2 + 4.2 + rand() * 2.5;
          const x = px + nx * off;
          const z = pz + nz * off;
          const r = Math.hypot(w, d) / 2 + 0.6;
          if (!free(x, z, r)) continue;
          taken.push({ x, z, r });
          const liveDoor = info.homes.length < 7 && Math.hypot(x - info.well.x, z - info.well.z) < 75;
          const built = addHouse(b, {
            x, z, w, d,
            rot: Math.atan2(-nx, -nz),
            floors: rand() < 0.45 ? 2 : 1,
            roof: pick(ROOFS, rand), wall: pick(WALLS, rand),
            timber: rand() < 0.45, ridgeAlongFront: rand() < 0.6,
            shutters: pick(SHUTTERS, rand), chimney: rand() < 0.75, liveDoor,
          }, rand);
          info.houses.push(built);
          if (liveDoor) info.homes.push(built);
          if (rand() < 0.5) barrels(b, built.stepX + 2.2, built.stepZ + 1.2, rand);
        }
      }
      travelled += seg;
    }
  }

  // The square: a well, market stalls and benches.
  well(b, info.well.x, info.well.z);
  const awnings = [0xc9482f, 0x3f7f9a, 0xe0b040, 0x5f9a4a];
  for (let i = 0; i < 4; i++) {
    const a = 0.6 + i * 1.5;
    const x = info.well.x + Math.cos(a) * 7.5;
    const z = info.well.z + Math.sin(a) * 7.5;
    const rot = Math.atan2(info.well.x - x, info.well.z - z);
    stall(b, x, z, rot, awnings[i], rand);
    info.stalls.push({ x, z, rot });
  }
  for (const a of [2.9, 5.3]) {
    const x = info.well.x + Math.cos(a) * 4.2;
    const z = info.well.z + Math.sin(a) * 4.2;
    const rot = Math.atan2(info.well.x - x, info.well.z - z);
    bench(b, x, z, rot);
    info.benches.push({ x, z, rot });
  }

  bridge(b);
  pier(b);

  // Fences round the fields, haystacks beside the wheat.
  for (const f of FIELDS) {
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    const corner = (u: number, v: number): [number, number] => [
      f.x + (u * (f.w / 2 + 1.2)) * c - (v * (f.d / 2 + 1.2)) * s,
      f.z + (u * (f.w / 2 + 1.2)) * s + (v * (f.d / 2 + 1.2)) * c,
    ];
    // Leave one side open as a gateway.
    fence(b, [corner(-0.3, 1), corner(-1, 1), corner(-1, -1), corner(1, -1), corner(1, 1), corner(0.3, 1)]);
    if (f.crop === 'wheat') {
      for (let i = 0; i < 3; i++) {
        const [hx, hz] = corner(1.25 + rand() * 0.2, -0.7 + i * 0.6);
        if (roadAt(hx, hz) < 0.2 && heightAt(hx, hz) > 2.4) haystack(b, hx, hz, 0.8 + rand() * 0.5);
      }
    }
  }
  // A scarecrow in the first field.
  {
    const f = FIELDS[0];
    const y = heightAt(f.x, f.z);
    const up = new THREE.Vector3(f.x, y, f.z);
    beam(b, 'wood', up, new THREE.Vector3(f.x, y + 2.3, f.z), 0.12, 0x6a4c34);
    beam(b, 'wood', new THREE.Vector3(f.x - 1, y + 1.7, f.z), new THREE.Vector3(f.x + 1, y + 1.75, f.z), 0.1, 0x6a4c34);
    b.box('cloth', f.x, y + 1.0, f.z, 0.75, 0.85, 0.3, 0, 0x8a4a3a, 0.2);
    b.add('plain', new THREE.SphereGeometry(0.24, 8, 6), 0xe2c98a, place(f.x, y + 2.25, f.z));
    b.cone('plain', f.x, y + 2.38, f.z, 0.42, 0.34, 0xc9a24a, 10);
  }

  orbAt('village-well', info.well.x, info.well.z, 2.4);
  if (info.houses.length > 3) {
    const h = info.houses[2];
    orbAt('village-roof', h.spec.x, h.spec.z, 1.2);
    const h2 = info.houses[info.houses.length - 2];
    orbAt('village-roof-2', h2.spec.x, h2.spec.z, 1.2);
  }
  void detail;
  return { object: b.build(), info };
}

/**
 * Crops standing in the fields: one instanced mesh of wheat, one of cabbages.
 */
export function buildCrops(density: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const rand = seededRandom(57);

  // A wheat plant: a few leaning stalks, each topped with an ear.
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const lean = 0.16;
    const h = 0.82 + (i % 2) * 0.14;
    const tx = Math.cos(a) * lean;
    const tz = Math.sin(a) * lean;
    const px = Math.cos(a + 1.57) * 0.035;
    const pz = Math.sin(a + 1.57) * 0.035;
    pos.push(-px, 0, -pz, px, 0, pz, tx, h, tz);
    col.push(0.55, 0.6, 0.25, 0.55, 0.6, 0.25, 0.95, 0.8, 0.36);
    pos.push(tx - px * 1.6, h - 0.05, tz - pz * 1.6, tx + px * 1.6, h - 0.05, tz + pz * 1.6, tx * 1.25, h + 0.2, tz * 1.25);
    col.push(0.93, 0.76, 0.3, 0.93, 0.76, 0.3, 1.0, 0.88, 0.45);
  }
  const wheat = new THREE.BufferGeometry();
  wheat.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wheat.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  wheat.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Array(30).fill(0), 1));
  wheat.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(30).fill(0).flatMap(() => [0, 1, 0]), 3));

  const cabbage = new THREE.IcosahedronGeometry(0.3, 1).scale(1, 0.72, 1);
  {
    const n = cabbage.attributes.position.count;
    const c: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = 0.75 + 0.3 * cabbage.attributes.position.getY(i) / 0.22;
      c.push(0.45 * k, 0.72 * k, 0.42 * k);
    }
    cabbage.deleteAttribute('uv');
    cabbage.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    cabbage.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Array(n).fill(0), 1));
  }

  const dummy = new THREE.Object3D();
  for (const f of FIELDS) {
    if (f.crop === 'tilled') continue;
    const wheatField = f.crop === 'wheat';
    const spacing = wheatField ? 0.62 / Math.sqrt(density) : 1.25;
    const nx = Math.floor((f.w - 2) / spacing);
    const nz = Math.floor((f.d - 2) / spacing);
    const mesh = new THREE.InstancedMesh(wheatField ? wheat : cabbage, material, nx * nz);
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    let n = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const u = -f.w / 2 + 1 + (i + (wheatField ? rand() : 0.5)) * spacing;
        const v = -f.d / 2 + 1 + (j + (wheatField ? rand() : 0.5)) * spacing;
        const x = f.x + u * c - v * s;
        const z = f.z + u * s + v * c;
        dummy.position.set(x, heightAt(x, z) - (wheatField ? 0.02 : -0.12), z);
        dummy.rotation.set(0, rand() * 6.28, 0);
        dummy.scale.setScalar(0.85 + rand() * 0.4);
        dummy.updateMatrix();
        mesh.setMatrixAt(n++, dummy.matrix);
      }
    }
    mesh.count = n;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
