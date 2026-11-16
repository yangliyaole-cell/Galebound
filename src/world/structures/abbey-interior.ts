import * as THREE from 'three';
import { place } from '../build';
import { addBox, addRound } from '../colliders';
import { PLAN } from '../abbey-plan';
import { plant } from '../flora/garden';
import { TINT, type Ctx } from './abbey';
import { archHeight, balustrade, banner, candlestick, flowerUrn, lantern, lathe, orders, pew, pier, pinnacle, ribVault, standingArch, starShape, statue } from './gothic';

const NAVE_BAYS: [number, number][] = [[-36.1, -27], [-27, -18], [-18, 0], [0, 9], [9, 18], [18, 27], [27, 36.1]];
const AISLE_BAYS: [number, number][] = [[-36.1, -27], [-27, -18], [0, 9], [9, 18], [18, 28.6]];
const ARCADE_BAYS: [number, number][] = [[-36, -27], [-27, -18], [0, 9], [9, 18], [18, 27]];

/** Piers, arcades and the shafts that carry the vault ribs down the nave walls. */
function structure(c: Ctx): void {
  const { inside, y } = c, P = PLAN, floor = y + 0.04;
  for (const side of [-1, 1]) {
    for (const pz of [-27, -18, 0, 9, 18, 27]) {
      const crossing = pz === -18 || pz === 0, r = crossing ? 1.38 : 1.06;
      const [x, z] = c.W(side * P.nave, pz);
      pier(inside, x, floor, z, r, P.arcadeSpring, TINT.white, TINT.gold);
      addRound(x, z, r * 1.38, y + P.wallTop);
      // A triple shaft climbs from the capital to the springing of the high vault.
      for (const [off, sr] of [[0, 0.24], [-0.34, 0.15], [0.34, 0.15]]) {
        inside.cyl('marble', x - side * (0.76 - Math.abs(off) * 0.3), y + P.arcadeSpring, z + off, sr, sr, P.vaultSpring - P.arcadeSpring - 0.2, TINT.white, 8, 0);
      }
      lathe(inside, 'marble', x - side * 0.76, y + P.vaultSpring - 0.75, z, [[0.3, 0], [0.34, 0.2], [0.5, 0.5], [0.62, 0.7], [0.62, 0.8]], TINT.white, 12, 0);
      lathe(inside, 'gilt', x - side * 0.76, y + P.vaultSpring - 0.8, z, [[0.31, 0], [0.37, 0.04], [0.31, 0.08]], TINT.gold, 12, 0);
      // The respond on the aisle wall opposite.
      const [rx] = c.W(side * (P.wall - 0.72), pz);
      inside.cyl('marble', rx, floor, z, 0.5, 0.56, 0.5, TINT.white, 8, 0.1);
      inside.cyl('marble', rx, floor + 0.5, z, 0.3, 0.3, P.aisleSpring - 1.1, TINT.white, 10, 0.04);
      lathe(inside, 'marble', rx, y + P.aisleSpring - 0.6, z, [[0.3, 0], [0.34, 0.2], [0.52, 0.5], [0.56, 0.6]], TINT.white, 10, 0);
      lathe(inside, 'gilt', rx, y + P.aisleSpring - 0.66, z, [[0.31, 0], [0.37, 0.04], [0.31, 0.08]], TINT.gold, 10, 0);
    }
    // Half piers against the north wall.
    const [nx, nz] = c.W(side * P.nave, -P.end + 1.05);
    pier(inside, nx, floor, nz, 0.95, P.arcadeSpring, TINT.white, TINT.gold);
    for (const [z0, z1] of ARCADE_BAYS) {
      const [x, z] = c.W(side * P.nave, (z0 + z1) / 2);
      standingArch(inside, 'marble', x, z, Math.PI / 2, 7.3, y + P.arcadeSpring, P.arcadeRise, 0.62, 1.4, TINT.white, TINT.gold);
    }
    // The great arches of the crossing, opening the transepts to their full height.
    const [cx, cz] = c.W(side * P.nave, -9);
    standingArch(inside, 'marble', cx, cz, Math.PI / 2, 15.4, y + P.vaultSpring, P.vaultRise - 0.5, 0.9, 1.5, TINT.white, TINT.gold);
    // Aisle transverse arches.
    for (const pz of [-27, -18, 0, 9, 18]) {
      const [x, z] = c.W(side * 13.7, pz);
      standingArch(inside, 'marble', x, z, 0, 7.0, y + P.aisleSpring, P.aisleRise - 0.2, 0.4, 0.6, TINT.white, TINT.gold);
    }
  }
  for (const pz of [-27, -18, 0, 9, 18, 27]) {
    const [x, z] = c.W(0, pz), crossing = pz === -18 || pz === 0;
    standingArch(inside, 'marble', x, z, 0, 17.6, y + P.vaultSpring, P.vaultRise - 0.3, crossing ? 0.85 : 0.5, crossing ? 1.4 : 0.8, TINT.white, TINT.gold);
  }
}

function vaults(c: Ctx): void {
  const { inside, y } = c, P = PLAN;
  for (const [z0, z1] of NAVE_BAYS) {
    const [x0, w0] = c.W(-8.9, z0), [x1, w1] = c.W(8.9, z1);
    ribVault(inside, x0, w0, x1, w1, y + P.vaultSpring, P.vaultRise, TINT.fresco, TINT.white, TINT.gold, z0 === -18 ? 0.26 : 0.2);
  }
  for (const side of [-1, 1]) {
    for (const [a, e] of [[8.9, 18.6], [18.6, 28.25]]) {
      const [x0, w0] = c.W(side > 0 ? a : -e, -17.35), [x1, w1] = c.W(side > 0 ? e : -a, -0.65);
      ribVault(inside, x0, w0, x1, w1, y + P.vaultSpring, P.vaultRise, TINT.fresco, TINT.white, TINT.gold);
    }
    for (const [z0, z1] of AISLE_BAYS) {
      const [x0, w0] = c.W(side > 0 ? 10.1 : -17.3, z0), [x1, w1] = c.W(side > 0 ? 17.3 : -10.1, z1);
      ribVault(inside, x0, w0, x1, w1, y + P.aisleSpring, P.aisleRise, TINT.fresco, TINT.white, TINT.gold, 0.13);
    }
  }
}

/** The gallery over the arcades: a cornice, a pierced balustrade, and flowers trailing from it. */
function triforium(c: Ctx): void {
  const { inside, y } = c, P = PLAN;
  const garland = (x: number, gy: number, z: number, side: number): void => {
    // Flowers heaped on the rail and trailing down over the arcade.
    for (const dz of [-1.5, -0.5, 0.5, 1.5]) plant('spill', x - side * 0.1, gy - 0.12, z + dz, 1.0, undefined, [1, 1.7, 1.1]);
    // The draws the old garland made, so the nave beyond it is furnished as before.
    for (let k = 0; k < 16; k++) { c.rand(); c.rand(); if (k % 3 !== 0) c.rand(); c.rand(); c.rand(); }
  };
  for (const side of [-1, 1]) for (const [z0, z1] of ARCADE_BAYS) {
    const m = (z0 + z1) / 2;
    const [x, z] = c.W(side * (P.nave - 0.78), m);
    inside.box('marble', x, y + P.triforium - 0.5, z, 0.5, 0.18, 8.4, 0, TINT.white, 0);
    inside.box('marble', x - side * 0.08, y + P.triforium - 0.32, z, 0.66, 0.32, 8.4, 0, TINT.white, 0);
    inside.box('gilt', x - side * 0.4, y + P.triforium - 0.22, z, 0.04, 0.1, 8.4, 0, TINT.gold, 0);
    balustrade(inside, 'marble', c.W(side * (P.nave - 0.92), z0 + 0.7), c.W(side * (P.nave - 0.92), z1 - 0.7), y + P.triforium, 0.95, TINT.white, false);
    // Colonnettes between the gallery openings.
    for (const d of [-3.75, -1.25, 1.25, 3.75]) {
      const [px, pz] = c.W(side * (P.nave - 0.64), m + d);
      inside.cyl('marble', px, y + 16.5, pz, 0.1, 0.1, 1.2, TINT.white, 6, 0);
      lathe(inside, 'gilt', px, y + 17.62, pz, [[0.1, 0], [0.17, 0.1], [0.17, 0.14]], TINT.gold, 8, 0);
    }
    if (Math.round(m) % 2 === 0 || m > 20) garland(x - side * 0.3, y + P.triforium + 0.9, z, side);
  }
}

function floorAndSeating(c: Ctx): void {
  const { inside, y } = c, P = PLAN, floor = y + 0.04;
  const [X, Z] = c.W(0, 0);
  // The blue runner with its gold borders and stars, from the door to the foot of the sanctuary.
  const from = 34, to = P.daisZ + 0.4, length = from - to, mid = Z + (from + to) / 2;
  inside.box('velvet', X, floor, mid, 3.5, 0.03, length, 0, TINT.banner, 0);
  for (const side of [-1, 1]) {
    inside.box('gilt', X + side * 1.56, floor + 0.03, mid, 0.13, 0.008, length, 0, TINT.gold, 0);
    inside.box('gilt', X + side * 1.3, floor + 0.03, mid, 0.035, 0.008, length, 0, TINT.gold, 0);
    // Scrollwork between the two rules: a running line of lozenges.
    for (let lz = to + 0.4; lz < from; lz += 0.62) {
      inside.add('gilt', new THREE.ShapeGeometry(starShape(2, 0.19, 0.05)).rotateX(-Math.PI / 2), TINT.gold, place(X + side * 1.43, floor + 0.034, Z + lz), 0);
    }
  }
  for (let lz = from - 2.6; lz > to + 1; lz -= 4.5) {
    inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.92, 0.34)).rotateX(-Math.PI / 2), TINT.gold, place(X, floor + 0.034, Z + lz), 0);
    inside.add('gilt', new THREE.ShapeGeometry(starShape(4, 1.18, 0.16)).rotateX(-Math.PI / 2), TINT.gold, place(X, floor + 0.033, Z + lz, Math.PI / 4), 0);
    for (const side of [-1, 1]) inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.2, 0.08)).rotateX(-Math.PI / 2), TINT.gold, place(X + side * 0.86, floor + 0.034, Z + lz + 2.25), 0);
  }
  // A great star set in the pavement under the crossing.
  for (const [n, outer, inner, turn] of [[8, 4.2, 1.5, 0], [8, 2.8, 1.9, Math.PI / 8]] as [number, number, number, number][]) {
    const ring = starShape(n, outer, inner, turn);
    ring.holes.push(new THREE.Path(starShape(n, outer - 0.22, inner - 0.16, turn).getPoints().reverse()));
    for (const side of [-1, 1]) inside.add('gilt', new THREE.ShapeGeometry(ring).rotateX(-Math.PI / 2), TINT.gold, place(X + side * 5.6, floor + 0.012, Z - 9), 0);
  }
  // Pews in two blocks, facing the altar.
  for (const side of [-1, 1]) for (let lz = 25.2; lz > 2; lz -= 1.62) {
    const [x, z] = c.W(side * 5.35, lz);
    pew(inside, x, floor, z, 5.5, Math.PI, TINT.oak, TINT.oakDark);
    addBox(x, z, 2.75, 0.42, 0, y + 1.1);
  }
}

/** The raised sanctuary: steps, the high altar, a reredos of gabled niches, lights and flowers. */
function sanctuary(c: Ctx): void {
  const { inside, y } = c, P = PLAN;
  const [X, Z] = c.W(0, 0);
  for (let k = 0; k < 3; k++) {
    const front = P.daisZ - k * 0.56, back = -36.1, top = 0.04 + (k + 1) * 0.22;
    inside.box('marble', X, y + top - 0.22, Z + (front + back) / 2, 17.5, 0.22, front - back, 0, TINT.white, 0);
    inside.box('gilt', X, y + top - 0.03, Z + front + 0.01, 17.5, 0.03, 0.04, 0, TINT.gold, 0);
    addBox(X, Z + (front + back) / 2, 8.75, (front - back) / 2, 0, y + top);
  }
  const dais = y + 0.04 + P.dais;
  inside.box('velvet', X, dais, Z - 26.6, 3.5, 0.03, 4.4, 0, TINT.banner, 0);
  for (const side of [-1, 1]) inside.box('gilt', X + side * 1.56, dais + 0.03, Z - 26.6, 0.13, 0.008, 4.4, 0, TINT.gold, 0);
  // The altar on its own step.
  const az = Z - 30.4;
  inside.box('marble', X, dais, az, 6.6, 0.2, 3.6, 0, TINT.white, 0);
  inside.box('marble', X, dais + 0.2, az, 4.1, 1.05, 1.2, 0, TINT.white, 0.08);
  inside.box('marble', X, dais + 1.25, az, 4.6, 0.14, 1.56, 0, TINT.white, 0);
  inside.box('velvet', X, dais + 1.39, az, 4.7, 0.02, 1.66, 0, 0xffffff, 0);
  inside.box('velvet', X, dais + 0.26, az + 0.62, 3.9, 0.96, 0.02, 0, TINT.banner, 0);
  inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.4, 0.15)), TINT.gold, place(X, dais + 0.74, az + 0.64), 0);
  for (const side of [-1, 1]) {
    inside.box('gilt', X + side * 1.9, dais + 0.26, az + 0.635, 0.06, 0.96, 0.02, 0, TINT.gold, 0);
    inside.cyl('marble', X + side * 2.15, dais + 0.2, az + 0.66, 0.11, 0.13, 1.05, TINT.white, 8, 0);
    for (const d of [0.55, 1.1, 1.65]) { candlestick(inside, X + side * d, dais + 1.41, az - 0.36, 0.72, TINT.gold); c.lamps.push(new THREE.Vector3(X + side * d, dais + 2.5, az - 0.36)); }
  }
  // Tabernacle: a little gilded house with a star on its ridge.
  inside.box('gilt', X, dais + 1.41, az - 0.3, 0.8, 0.9, 0.6, 0, TINT.gold, 0);
  inside.pyramid('gilt', X, dais + 2.31, az - 0.3, 0.96, 0.76, 0.6, 0, TINT.gold);
  inside.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 0.3, 0.11), { depth: 0.04, bevelEnabled: false }), TINT.gold, place(X, dais + 3.3, az - 0.32), 0);
  inside.cyl('gilt', X, dais + 2.9, az - 0.3, 0.025, 0.035, 0.3, TINT.gold, 6, 0);
  addBox(X, az, 2.4, 0.9, 0, y + 2.2);
  // Reredos: five niches under gables, the middle one a glory of gold on blue.
  const rz = Z - 34.9;
  inside.box('marble', X, dais, rz, 11.6, 2.5, 1.0, 0, TINT.white, 0.06);
  inside.box('gilt', X, dais + 2.46, rz + 0.5, 11.7, 0.07, 0.06, 0, TINT.gold, 0);
  addBox(X, rz, 5.8, 0.6, 0, y + 7);
  [-4.5, -2.25, 0, 2.25, 4.5].forEach((dx, i) => {
    const mid = i === 2, w = mid ? 2.4 : 1.9, h = mid ? 4.2 : 3.1, base = dais + 2.5;
    inside.box('marble', X + dx, base, rz - 0.2, w + 0.3, h + 0.5, 0.5, 0, TINT.white, 0.04);
    inside.box('velvet', X + dx, base + 0.1, rz + 0.07, w - 0.34, h - 0.2, 0.02, 0, TINT.banner, 0);
    orders(inside, 'marble', place(X + dx, 0, rz + 0.08, 0), { w: w - 0.3, sill: base, spring: base + h - (w - 0.3) * 0.72, rise: (w - 0.3) * 0.72 }, 2, TINT.white, 0.13, 0.12, TINT.gold);
    inside.prism('marble', X + dx, base + h + 0.2, rz + 0.1, w + 0.5, 0.5, mid ? 1.5 : 1.15, 0, TINT.white);
    inside.add('gilt', new THREE.ShapeGeometry(starShape(4, 0.26, 0.08)), TINT.gold, place(X + dx, base + h + 0.62, rz + 0.37), 0);
    if (mid) {
      inside.add('gilt', new THREE.ExtrudeGeometry(starShape(16, 0.95, 0.5), { depth: 0.05, bevelEnabled: false }), TINT.gold, place(X, base + 2.1, rz + 0.1), 0);
      inside.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 0.7, 0.24), { depth: 0.08, bevelEnabled: false }), TINT.gold, place(X, base + 2.1, rz + 0.14), 0);
      inside.add('glow', new THREE.SphereGeometry(0.13, 10, 8), 0xfff2c8, place(X, base + 2.1, rz + 0.26), 0);
    } else statue(inside, X + dx, base + 0.1, rz + 0.22, 2.3, 0, TINT.white, TINT.gold);
  });
  for (const dx of [-5.65, -3.38, -1.2, 1.2, 3.38, 5.65]) pinnacle(inside, 'marble', X + dx, dais + 2.5, rz + 0.18, 0.34, Math.abs(dx) < 2 ? 5.9 : 4.4, TINT.white, TINT.gold);
  // Standing lights and flowers on the steps, and two figures on brackets beside the great window.
  for (const side of [-1, 1]) {
    for (const [dx, dz, h] of [[3.7, -29.2, 2.3], [5.2, -31.6, 2.3]]) { candlestick(inside, X + side * dx, dais + 0.2 * (dz < -31 ? 0 : 0), Z + dz, h, TINT.gold); c.lamps.push(new THREE.Vector3(X + side * dx, dais + h * 1.4, Z + dz)); }
    const [ux, uz] = c.W(side * 6.9, -25.6);
    flowerUrn(inside, ux, dais, uz, 1.25, TINT.white, c.rand, 1.0); addRound(ux, uz, 0.6, y + 2.2);
    const [vx, vz] = c.W(side * 7.4, P.daisZ + 1.3);
    flowerUrn(inside, vx, y + 0.04, vz, 1.0, TINT.white, c.rand, 0.7); addRound(vx, vz, 0.5, y + 1.6);
    const [sx, sz] = c.W(side * 7.75, -35.55);
    lathe(inside, 'marble', sx, y + 5.2, sz, [[0.1, 0], [0.3, 0.5], [0.62, 0.9], [0.66, 1.0]], TINT.white, 8, 0);
    statue(inside, sx, y + 6.2, sz, 3.0, 0, TINT.white, TINT.gold);
    inside.prism('marble', sx, y + 9.6, sz, 1.5, 1.2, 1.0, 0, TINT.white);
    pinnacle(inside, 'marble', sx, y + 10.5, sz, 0.3, 1.8, TINT.white, TINT.gold);
  }
}

/** Lesser altars: the two aisle chapels, the transept chapels, a tomb and the font. */
function chapels(c: Ctx): void {
  const { inside, y } = c, floor = y + 0.04;
  const smallAltar = (lx: number, lz: number, turn: number, w: number): void => {
    const [x, z] = c.W(lx, lz), m = place(x, 0, z, turn), put = (px: number, pz: number): [number, number] => {
      const v = new THREE.Vector3(px, 0, pz).applyMatrix4(m); return [v.x, v.z];
    };
    inside.box('marble', x, floor, z, w + 1.2, 0.18, 2.4, turn, TINT.white, 0);
    inside.box('marble', x, floor + 0.18, z, w - 0.3, 0.95, 0.9, turn, TINT.white, 0.08);
    inside.box('marble', x, floor + 1.13, z, w, 0.12, 1.2, turn, TINT.white, 0);
    inside.box('velvet', x, floor + 1.25, z, w + 0.06, 0.02, 1.26, turn, 0xffffff, 0);
    inside.add('velvet', new THREE.PlaneGeometry(w - 0.4, 0.86), TINT.banner, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(0, floor + 0.66, 0.46)), 0);
    inside.add('gilt', new THREE.ShapeGeometry(starShape(8, 0.3, 0.11)), TINT.gold, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().setPosition(0, floor + 0.66, 0.47)), 0);
    for (const side of [-1, 1]) {
      const [cx, cz] = put(side * (w / 2 - 0.35), -0.3);
      candlestick(inside, cx, floor + 1.27, cz, 0.6, TINT.gold); c.lamps.push(new THREE.Vector3(cx, floor + 2.2, cz));
      const [ux, uz] = put(side * (w / 2 + 1.0), 0.1);
      flowerUrn(inside, ux, floor, uz, 0.8, TINT.white, c.rand, 0.6);
    }
    const [bx, bz] = put(0, -0.34);
    statue(inside, bx, floor + 1.27, bz, 1.7, turn, TINT.white, TINT.gold);
    addBox(x, z, w / 2 + 0.2, 0.7, turn, y + 1.4);
  };
  smallAltar(-14, -34.6, 0, 3.0);
  smallAltar(14, -34.6, 0, 3.0);
  smallAltar(-26.4, -9, Math.PI / 2, 4.2);
  smallAltar(26.4, -9, -Math.PI / 2, 4.2);
  // A founder's tomb in the west transept: a chest with a blind arcade, and a figure laid upon it.
  const [tx, tz] = c.W(-21.5, -14.8);
  inside.box('marble', tx, floor, tz, 3.4, 0.2, 1.7, 0, TINT.white, 0);
  inside.box('marble', tx, floor + 0.2, tz, 3.0, 0.8, 1.3, 0, TINT.white, 0.1);
  inside.box('marble', tx, floor + 1.0, tz, 3.2, 0.12, 1.5, 0, TINT.white, 0);
  for (let k = -2; k <= 2; k++) orders(inside, 'marble', place(tx + k * 0.58, 0, tz + 0.65, 0), { w: 0.36, sill: floor + 0.28, spring: floor + 0.62, rise: 0.26 }, 1, TINT.white, 0.06, 0.05, TINT.gold);
  const lying = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(tx + 1.2, floor + 1.4, tz);
  inside.add('marble', new THREE.LatheGeometry([[0.24, 0], [0.26, 0.2], [0.2, 1.3], [0.24, 1.7], [0.18, 1.9], [0.08, 2.0]].map(([r, v]) => new THREE.Vector2(r, v)), 10).scale(1, 1, 0.8), TINT.white, lying, 0);
  inside.add('marble', new THREE.SphereGeometry(0.15, 10, 8), TINT.white, place(tx - 1.0, floor + 1.42, tz), 0);
  addBox(tx, tz, 1.7, 0.85, 0, y + 1.7);
  // The font by the west door of the aisle, under a gilded cover.
  const [fx, fz] = c.W(-13.7, 22.5);
  inside.cyl('marble', fx, floor, fz, 1.25, 1.35, 0.2, TINT.white, 8, 0);
  lathe(inside, 'marble', fx, floor + 0.2, fz, [[0.6, 0], [0.62, 0.08], [0.36, 0.2], [0.34, 0.62], [0.7, 0.86], [0.86, 1.02], [0.88, 1.2], [0.8, 1.2], [0.74, 1.08]], TINT.white, 8, 0.08);
  lathe(inside, 'oak', fx, floor + 1.4, fz, [[0.84, 0], [0.8, 0.06], [0.5, 0.22], [0.2, 0.5], [0.08, 0.8]], TINT.oakDark, 8, 0);
  lathe(inside, 'gilt', fx, floor + 1.4, fz, [[0.86, 0], [0.9, 0.03], [0.86, 0.06]], TINT.gold, 8, 0);
  inside.add('gilt', new THREE.OctahedronGeometry(0.12), TINT.gold, place(fx, floor + 2.32, fz), 0);
  addRound(fx, fz, 0.95, y + 1.5);
}

/** Lamps on chains, banners on the piers, urns of flowers and ivy round the columns nearest the door. */
function furnishings(c: Ctx): void {
  const { inside, y } = c, P = PLAN, floor = y + 0.04;
  const hang = (lx: number, lz: number, top: number, drop: number, size: number): void => {
    const [x, z] = c.W(lx, lz);
    c.lamps.push(lantern(inside, x, y + top, z, drop, size, TINT.bronze, TINT.gold, TINT.lamp));
  };
  const crown = (x: number, span: number, spring: number, rise: number): number => spring + Math.max(rise, archHeight(span, rise, x)) - 0.25;
  for (const [z0, z1] of NAVE_BAYS) {
    if (z0 === -18) { for (const dz of [-13.5, -4.5]) for (const side of [-1, 1]) hang(side * 5.4, dz, crown(5.4, 17.8, P.vaultSpring, P.vaultRise) - 0.4, 16.6, 1.6); continue; }
    const m = (z0 + z1) / 2;
    for (const side of [-1, 1]) hang(side * 5.4, m, crown(5.4, 17.8, P.vaultSpring, P.vaultRise), m < -20 ? 15.4 : 17.4, 1.5);
  }
  for (const side of [-1, 1]) {
    for (const [z0, z1] of AISLE_BAYS) hang(side * 13.7, (z0 + z1) / 2, P.aisleSpring + P.aisleRise - 0.2, 5.3, 0.95);
    hang(side * 21.5, -9, P.vaultSpring + P.vaultRise - 0.3, 15.5, 1.4);
    // Banners of the star on the nave face of each pier.
    for (const pz of [-27, 0, 9, 18, 27]) {
      const [x, z] = c.W(side * (P.nave - (pz === 0 ? 1.62 : 1.26)), pz);
      banner(inside, x, y + 8.3, z, -side * Math.PI / 2, 1.7, 4.7, TINT.banner, TINT.gold);
    }
    // And longer ones on the aisle walls between the windows.
    for (const pz of [9, 18]) {
      const [x, z] = c.W(side * (P.wall - 0.86), pz + 1.3);
      banner(inside, x, y + 7.6, z, -side * Math.PI / 2, 1.2, 3.6, TINT.banner, TINT.gold);
    }
    for (const pz of [27, 9, -18]) {
      const [x, z] = c.W(side * 11.5, pz + 0.2);
      flowerUrn(inside, x, floor, z, 1.05, TINT.white, c.rand, 0.9); addRound(x, z, 0.55, y + 1.9);
    }
    const [ex, ez] = c.W(side * 4.6, 34.6);
    flowerUrn(inside, ex, floor, ez, 1.3, TINT.white, c.rand, 1.1); addRound(ex, ez, 0.65, y + 2.3);
    // Ivy winds up the two piers nearest the door.
    const [ix, iz] = c.W(side * P.nave, 27);
    for (let k = 0; k < 130; k++) {
      const t = k / 130, a = t * 15 + side, r = 1.2 + c.rand() * 0.22, h = t * 8.4 + c.rand() * 0.3;
      const leaf = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.12, 0.08), new THREE.Vector2(0.14, 0.22), new THREE.Vector2(0, 0.34), new THREE.Vector2(-0.14, 0.22), new THREE.Vector2(-0.12, 0.08)]);
      inside.add('velvet', new THREE.ShapeGeometry(leaf).rotateX(-0.5 - c.rand() * 0.6).rotateZ((c.rand() - 0.5) * 1.6), [0x5f8f3e, 0x77a84a, 0x4c7a36][k % 3],
        place(ix + Math.cos(a) * r, floor + 0.3 + h, iz + Math.sin(a) * r, -a + Math.PI / 2), 0);
    }
  }
}

/** A blind arcade along the foot of the walls: small pointed arches on colonnettes, a string course above. */
function wallArcades(c: Ctx): void {
  const { inside, y } = c, P = PLAN, floor = y + 0.04;
  const run = (a: [number, number], e: [number, number], skip: [number, number][] = []): void => {
    const dx = e[0] - a[0], dz = e[1] - a[1], len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 1.9)), bay = len / n;
    const rot = Math.atan2(-dz, dx);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, lx = a[0] + dx * t, lz = a[1] + dz * t;
      if (skip.some(([s0, s1]) => { const p = Math.abs(dx) > Math.abs(dz) ? lx : lz; return p > s0 && p < s1; })) continue;
      const [x, z] = c.W(lx, lz);
      orders(inside, 'marble', place(x, 0, z, rot), { w: bay - 0.56, sill: floor + 0.5, spring: floor + 1.85, rise: (bay - 0.56) * 0.8 }, 2, TINT.white, 0.07, 0.06, TINT.gold);
      const [px, pz] = c.W(a[0] + dx * k / n, a[1] + dz * k / n);
      inside.cyl('marble', px + Math.sin(rot) * 0.1, floor + 0.5, pz + Math.cos(rot) * 0.1, 0.085, 0.085, 1.35, TINT.white, 6, 0);
    }
    const [mx, mz] = c.W((a[0] + e[0]) / 2, (a[1] + e[1]) / 2);
    inside.box('marble', mx, floor, mz, len, 0.5, 0.36, rot, TINT.white, 0.06);
    inside.box('marble', mx, floor + 3.05, mz, len, 0.14, 0.3, rot, TINT.white, 0);
    inside.box('gilt', mx + Math.sin(rot) * 0.13, floor + 3.08, mz + Math.cos(rot) * 0.13, len, 0.04, 0.06, rot, TINT.gold, 0);
  };
  const w = P.wall - P.wallThick / 2 - 0.02;
  // Walls run with the room on the left, so the arcade faces inward.
  run([-w, 27.6], [-w, 1.6]); run([-w, -19.6], [-w, -35.4], [[-24.6, -21.4]]);
  run([w, 1.6], [w, 27.6], [[11.8, 15.2]]); run([w, -35.4], [w, -19.6]);
  run([-P.reach + 0.78, -1.4], [-P.reach + 0.78, -16.6], [[-12, -6]]); run([P.reach - 0.78, -16.6], [P.reach - 0.78, -1.4], [[-12, -6]]);
  run([-27.8, -17.33], [-19.6, -17.33]); run([19.6, -17.33], [27.8, -17.33]);
  run([-19.6, -0.67], [-27.8, -0.67]); run([27.8, -0.67], [19.6, -0.67]);
}

export function buildInterior(c: Ctx): void {
  structure(c); vaults(c); triforium(c); wallArcades(c); floorAndSeating(c); sanctuary(c); chapels(c); furnishings(c);
}
