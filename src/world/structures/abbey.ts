import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from '../../render/uniforms';
import { SUN_DIRECTION } from '../../render/glsl';
import { Builder, place, type Mat } from '../build';
import { addBox, addRound } from '../colliders';
import { createFlags, type FlagSpot } from '../flags';
import { ABBEY } from '../layout';
import { seededRandom } from '../noise';
import { beam } from './common';
import { pbrUniforms } from '../../render/pbr/material';
import { createAbbeyLightMaterial } from '../abbey-light';
import { GLASS, GlassPanes } from '../abbey-glass';
import { PLAN } from '../abbey-plan';
import { EQ, along, archPoints, orders, pinnacle, roseTracery, spire, starShape, statue, tracery, wall, wallSolid, type Opening } from './gothic';
import { buildInterior } from './abbey-interior';
import { buildPrecinct } from './abbey-precinct';

export const ABBEY_ENTRY = { x: ABBEY.x, z: ABBEY.entranceZ, facing: '+Z (south)', width: 5 };
export const ABBEY_INTERIOR_RANGE = 190;
/** Light shafts drawn through the windows that face the afternoon sun. */
export const ABBEY_SHAFTS = 10;

/** The abbey's palette. Vertex tints; the procedural materials supply grain and veining. */
export const TINT = {
  lime: 0xefe6d4, trim: 0xfbf5e8, white: 0xf7f2e9, cream: 0xefe7d6, gold: 0xe9b64a, slate: 0x8fa9d4,
  fresco: 0x3a62c2, banner: 0x2c4a9e, oak: 0xa97a4c, oakDark: 0x7c5636, bronze: 0x9a7440, lamp: 0xffdfa6, louvre: 0x25303c,
} as const;

/** A window or door in a shell wall. `p` is its place along the wall's axis, in the abbey's frame. */
export interface Win extends Omit<Opening, 'u'> { p: number; glass?: number; levels?: number; seed?: number; plain?: boolean }
export interface Rose { p: number; y: number; r: number; spokes?: number; glass?: number }
export interface ShellOptions {
  roses?: Rose[];
  collide?: boolean;
  /** Marble through its whole thickness, with only a thin weather skin outside from this height up. */
  core?: number;
  /** Leave out the outer or the inner leaf (for walls shared between two rooms). */
  leaves?: 'both' | 'inner' | 'outer' | 'rooms';
  outerMat?: Mat; outerColor?: number;
}

export interface Ctx {
  ext: Builder; inside: Builder; glass: GlassPanes;
  /** Floor height and the abbey's origin in the world. */
  y: number; ax: number; az: number;
  W: (lx: number, lz: number) => [number, number];
  lamps: THREE.Vector3[]; flags: FlagSpot[]; rand: () => number;
  shell: (a: [number, number], e: [number, number], y0: number, y1: number | ((p: number) => number), thick: number, wins?: Win[], options?: ShellOptions) => void;
}

function context(): Ctx {
  const ax = ABBEY.x, az = ABBEY.z, y = ABBEY.floor;
  const c: Ctx = {
    ext: new Builder(false, true), inside: new Builder(true), glass: new GlassPanes(), y, ax, az,
    W: (lx, lz) => [ax + lx, az + lz], lamps: [], flags: [], rand: seededRandom(4127),
    shell: (a, e, y0, y1, thick, wins = [], options = {}) => shellWall(c, a, e, y0, y1, thick, wins, options),
  };
  return c;
}

/**
 * A wall of the church, built as two leaves: dressed limestone to the weather,
 * white marble to the room. Walls run with their outer face on the left of
 * a -> e. Windows get tracery, glass and moulded orders on both faces.
 */
function shellWall(c: Ctx, a: [number, number], e: [number, number], y0: number, y1: number | ((p: number) => number), thick: number, wins: Win[], o: ShellOptions): void {
  const { ext, inside, y } = c;
  const dx = e[0] - a[0], dz = e[1] - a[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, rot = along(dx, dz);
  const out = [-uz, ux], mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
  // Position along the wall from an absolute coordinate on its dominant axis.
  const toU = (p: number): number => Math.abs(ux) > Math.abs(uz) ? (p - mid[0]) / ux : (p - mid[1]) / uz;
  const toP = (u: number): number => Math.abs(ux) > Math.abs(uz) ? mid[0] + u * ux : mid[1] + u * uz;
  const top = typeof y1 === 'number' ? y + y1 : (u: number) => y + y1(toP(u));
  const openings: Opening[] = wins.map((w) => ({ ...w, u: toU(w.p), sill: y + w.sill, spring: y + w.spring }));
  const circle = (r: Rose, n = 28): THREE.Vector2[] => Array.from({ length: n }, (_, i) =>
    new THREE.Vector2(toU(r.p) + Math.cos(-i / n * Math.PI * 2) * r.r, y + r.y + Math.sin(-i / n * Math.PI * 2) * r.r));
  const holes = (): THREE.Path[] => (o.roses ?? []).map((r) => new THREE.Path(circle(r)));
  const leaf = (offset: number): [[number, number], [number, number]] => [
    c.W(a[0] + out[0] * offset, a[1] + out[1] * offset), c.W(e[0] + out[0] * offset, e[1] + out[1] * offset)];
  const leaves = o.leaves ?? 'both';
  const outerMat = o.outerMat ?? 'ashlar', outerColor = o.outerColor ?? TINT.lime;
  if (o.core !== undefined) {
    wall(inside, 'marble', ...leaf(0), y + y0, top, thick, TINT.white, openings, false, holes());
    const skin = openings.filter((w) => w.spring > y + o.core! + 2);
    wall(ext, outerMat, ...leaf(thick / 2 + 0.12), y + o.core, top, 0.3, outerColor, skin, false, holes());
  } else if (leaves === 'rooms') {
    wall(inside, 'marble', ...leaf(0), y + y0, top, thick, TINT.white, openings, false, holes());
  } else {
    if (leaves !== 'inner') wall(ext, outerMat, ...leaf(thick / 4), y + y0, top, thick / 2 + 0.02, outerColor, openings, false, holes());
    if (leaves !== 'outer') wall(inside, 'marble', ...leaf(-thick / 4), y + Math.max(y0, -0.5), top, thick / 2 + 0.02, TINT.white, openings, false, holes());
  }
  if (o.collide ?? true) wallSolid(c.W(...a), c.W(...e), thick, top, openings);

  const inward = new THREE.Vector3(-out[0], 0, -out[1]);
  const frame = (u: number, offset: number, flip = false): THREE.Matrix4 => {
    const [wx, wz] = c.W(mid[0] + ux * u + out[0] * offset, mid[1] + uz * u + out[1] * offset);
    return place(wx, 0, wz, rot + (flip ? Math.PI : 0));
  };
  const face = o.core !== undefined ? thick / 2 + 0.27 : thick / 2;
  for (const w of openings) {
    const win = wins[openings.indexOf(w)];
    if (win.plain) continue;
    const rise = w.rise ?? w.w * EQ, big = w.w > 6;
    // Moulded orders on both faces; the innermost one inside is gilded.
    if (leaves !== 'rooms') ext.detail(() => orders(ext, outerMat, frame(w.u, face), { ...w, rise }, big ? 3 : 2, TINT.trim, big ? 0.24 : 0.17, big ? 0.16 : 0.11));
    orders(inside, 'marble', frame(w.u, -thick / 2, true), { ...w, rise }, big ? 3 : 2, TINT.white, big ? 0.22 : 0.15, big ? 0.14 : 0.09, w.door ? 0 : TINT.gold);
    if (w.door) continue;
    if (win.glass === undefined) continue;
    // The tracery is one stone, but its two faces belong to the weather and to the room.
    const bar = big ? 0.24 : 0.15, deep = big ? 0.42 : 0.3;
    if (leaves !== 'rooms') ext.detail(() => tracery(ext, outerMat, frame(w.u, 0), w.w, w.sill, w.spring, win.levels ?? 2, TINT.trim, bar, deep / 2, 0, deep / 4));
    tracery(inside, 'marble', frame(w.u, 0), w.w, w.sill, w.spring, win.levels ?? 2, TINT.white, bar, deep / 2, 0, -deep / 4);
    c.glass.add(archPoints(w.w, w.spring, rise, 10, w.sill), frame(w.u, 0), win.glass, win.seed ?? w.u * 0.37 + mid[1] * 0.11, inward);
    // A weathered sill outside and a hood mould dripping off at the springing.
    if (leaves !== 'rooms') {
      const [sx, sz] = c.W(mid[0] + ux * w.u + out[0] * (face + 0.14), mid[1] + uz * w.u + out[1] * (face + 0.14));
      ext.box(outerMat, sx, w.sill - 0.3, sz, w.w + (big ? 1.5 : 1.0), 0.3, 0.42, rot, TINT.trim, 0);
    }
  }
  for (const r of o.roses ?? []) {
    const u = toU(r.p);
    const deep = r.r > 3 ? 0.46 : 0.3;
    ext.detail(() => roseTracery(ext, outerMat, frame(u, 0), r.r, y + r.y, r.spokes ?? 8, TINT.trim, deep / 2, deep / 4));
    roseTracery(inside, 'marble', frame(u, 0), r.r, y + r.y, r.spokes ?? 8, TINT.white, deep / 2, -deep / 4);
    c.glass.add(circle({ ...r, p: mid[Math.abs(ux) > Math.abs(uz) ? 0 : 1] }).map((v) => new THREE.Vector2(v.x, v.y)), frame(u, 0), r.glass ?? GLASS.rose, r.p * 0.3 + r.y, inward);
    for (const side of [1, -1]) {
      const b = side > 0 ? ext : inside, ring = new THREE.Shape(circle({ ...r, p: mid[Math.abs(ux) > Math.abs(uz) ? 0 : 1], r: r.r + 0.34 }, 36));
      ring.holes.push(new THREE.Path(circle({ ...r, p: mid[Math.abs(ux) > Math.abs(uz) ? 0 : 1] }, 36).reverse()));
      if (side > 0 && leaves === 'rooms') continue;
      b.add(side > 0 ? outerMat : 'marble', new THREE.ExtrudeGeometry(ring, { depth: 0.2, bevelEnabled: false }), side > 0 ? TINT.trim : TINT.white,
        frame(u, side > 0 ? face : -thick / 2, side < 0), 0);
    }
  }
}

/** A pitched roof of two slate slabs with a stone ridge. The ridge runs along z, or along x if `turned`. */
export function gableRoof(b: Builder, cx: number, cz: number, half: number, length: number, base: number, rise: number, turned = false, color: number = TINT.slate): void {
  const world = place(cx, 0, cz, turned ? Math.PI / 2 : 0), angle = Math.atan2(rise, half), run = Math.hypot(half, rise) + 0.7;
  for (const side of [1, -1]) {
    const local = new THREE.Matrix4().makeRotationZ(-angle * side)
      .setPosition(side * (half / 2 + Math.cos(angle) * 0.35), base + rise / 2 - Math.sin(angle) * 0.35 + 0.1, 0);
    b.slab('slate', run, 0.36, length, new THREE.Matrix4().multiplyMatrices(world, local), color);
  }
  b.slab('ashlar', 0.5, 0.5, length + 0.2, new THREE.Matrix4().multiplyMatrices(world, new THREE.Matrix4().setPosition(0, base + rise + 0.2, 0)), TINT.trim);
  // Cresting: a comb of small fleurons along the ridge.
  b.detail(() => {
    for (let k = -Math.floor(length / 3) ; k <= Math.floor(length / 3); k++) {
      const m = new THREE.Matrix4().multiplyMatrices(world, new THREE.Matrix4().setPosition(0, base + rise + 0.45, k * 1.5));
      b.add('ashlar', new THREE.OctahedronGeometry(0.2).scale(0.6, 1.5, 1), TINT.trim, m, 0);
    }
  });
}
/** A lean-to roof falling from (xHigh, yHigh) to (xLow, yLow), running along z from z0 to z1 (or along x if `turned`). */
export function leanRoof(b: Builder, xHigh: number, yHigh: number, xLow: number, yLow: number, z0: number, z1: number, turned = false, color: number = TINT.slate): void {
  const run = Math.hypot(xLow - xHigh, yHigh - yLow), angle = Math.atan2(yLow - yHigh, xLow - xHigh);
  const local = new THREE.Matrix4().makeRotationZ(angle).setPosition((xHigh + xLow) / 2, (yHigh + yLow) / 2 + 0.12, (z0 + z1) / 2);
  const m = turned ? new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(local) : local;
  b.slab('slate', run + 0.5, 0.3, Math.abs(z1 - z0), m, color);
}

function shell(c: Ctx): void {
  const { ext, inside, y } = c, P = PLAN, W = P.wall, T = P.wallThick;
  const [X, Z] = c.W(0, 0);
  // Footings and floor. The marble floor belongs to the interior; a plain slab stands in for it from afar.
  ext.box('ashlar', X, y - 0.6, Z, W * 2 + 2.4, 0.62, P.end * 2 + 2.8, 0, TINT.lime, 0);
  ext.box('ashlar', X, y - 0.6, Z - 9, P.reach * 2 + 2.6, 0.62, 20.4, 0, TINT.lime, 0);
  inside.box('tile', X, y - 0.2, Z, W * 2 - 1.2, 0.24, P.end * 2 - 1.6, 0, 0xffffff, 0);
  for (const side of [-1, 1]) inside.box('tile', X + side * 23.3, y - 0.2, Z - 9, 11.4, 0.24, 17.4, 0, 0xffffff, 0);
  addBox(X, Z, W + 0.7, P.end + 0.9, 0, y + 0.04);
  addBox(X, Z - 9, P.reach + 0.75, 9.65, 0, y + 0.04);

  const gable = (centre: number, half: number) => (p: number): number => P.wallTop + 0.6 + P.roofRise * Math.max(0, 1 - Math.abs(p - centre) / half);
  const aisleWin = (p: number, glass: number): Win => ({ p, w: 4.4, sill: 3.4, spring: 8.2, glass, levels: 2 });
  const highWin = (p: number): Win => ({ p, w: 3.2, sill: 8.6, spring: 9.9, glass: GLASS.lattice, levels: 1 });
  // Aisle walls. The outer face is on the left of each run.
  c.shell([-W, -P.end - 0.9], [-W, -18.65], -6, P.aisleTop, T, [highWin(-31.5), { p: -23, w: 1.9, sill: 0, spring: 2.5, door: true }]);
  c.shell([-W, 0.65], [-W, 28.9], -6, P.aisleTop, T, [aisleWin(4.5, GLASS.castle), aisleWin(13.5, GLASS.river), aisleWin(22.5, GLASS.castle)]);
  c.shell([W, 28.9], [W, 0.65], -6, P.aisleTop, T, [highWin(4.5), highWin(13.5), highWin(22.5), { p: 13.5, w: 2.4, sill: 0, spring: 3.1, door: true }]);
  c.shell([W, -18.65], [W, -P.end - 0.9], -6, P.aisleTop, T, [aisleWin(-22.5, GLASS.river), aisleWin(-31.5, GLASS.castle)]);
  // North end: the aisle chapels' windows, and the great window of the Gale.
  const endWin = (p: number): Win => ({ p, w: 3.4, sill: 4.8, spring: 8.4, glass: GLASS.river, levels: 1 });
  c.shell([W + 0.7, -P.end], [10.1, -P.end], -6, P.aisleTop, P.endThick, [endWin(14)]);
  c.shell([-10.1, -P.end], [-W - 0.7, -P.end], -6, P.aisleTop, P.endThick, [endWin(-14)]);
  c.shell([10.1, -P.end], [-10.1, -P.end], -6, gable(0, 10.1), P.endThick,
    [{ p: 0, w: 12.4, sill: 8.6, spring: 15.2, glass: GLASS.great, levels: 3, seed: 1.3 }], { roses: [{ p: 0, y: 36.6, r: 1.5, spokes: 6 }] });
  // South front between the towers: the portal under the great rose.
  c.shell([-9.3, P.end], [9.3, P.end], -6, gable(0, 10.1), P.endThick, [{ p: 0, w: 5, sill: 0, spring: 5.6, door: true }],
    { roses: [{ p: 0, y: 21.2, r: 4.7, spokes: 12 }, { p: 0, y: 37, r: 1.4, spokes: 6 }] });
  // Transepts: end walls with a great window under a rose, and their flanks.
  const armWin = (p: number, glass: number): Win => ({ p, w: 7.6, sill: 6.2, spring: 13.2, glass, levels: 3 });
  const lancet = (p: number, sill: number, spring: number): Win => ({ p, w: 3, sill, spring, glass: GLASS.lattice, levels: 1 });
  c.shell([-P.reach, -18.65], [-P.reach, 0.65], -6, gable(-9, 9.65), 1.5, [armWin(-9, GLASS.river)], { roses: [{ p: -9, y: 25.6, r: 2.3 }] });
  c.shell([P.reach, 0.65], [P.reach, -18.65], -6, gable(-9, 9.65), 1.5, [armWin(-9, GLASS.castle)], { roses: [{ p: -9, y: 25.6, r: 2.3 }] });
  c.shell([-18.7, -18], [-P.reach - 0.75, -18], -6, P.wallTop, 1.3, [lancet(-24.2, 10.5, 16)]);
  c.shell([P.reach + 0.75, -18], [18.7, -18], -6, P.wallTop, 1.3, [lancet(24.2, 6, 14.5)]);
  c.shell([-P.reach - 0.75, 0], [-18.7, 0], -6, P.wallTop, 1.3, [lancet(-24.2, 6, 14.5)]);
  c.shell([18.7, 0], [P.reach + 0.75, 0], -6, P.wallTop, 1.3, [lancet(24.2, 10, 15.5)]);
  // Where the aisles open into the transepts: an arch below, wall above.
  const aisleArch = (p: number): Win => ({ p, w: 7, sill: P.aisleSpring, spring: P.aisleSpring, rise: P.aisleRise, door: true, plain: true });
  for (const [a, e, p] of [[[-10.1, -18], [-18.7, -18], -14.4], [[18.7, -18], [10.1, -18], 14.4], [[-18.7, 0], [-10.1, 0], -14.4], [[10.1, 0], [18.7, 0], 14.4]] as [[number, number], [number, number], number][]) {
    c.shell(a, e, P.aisleSpring, P.wallTop, 1.3, [aisleArch(p)], { core: P.aisleTop, collide: false });
    addBox(...c.W((a[0] + e[0]) / 2, a[1]), 4.3, 0.65, 0, y + P.wallTop, y + 12.5);
  }
  // The nave walls stand on the arcades: arch, triforium, clerestory.
  for (const side of [-1, 1]) for (const [z0, z1] of [[-36, -27], [-27, -18], [0, 9], [9, 18], [18, 27]]) {
    const m = (z0 + z1) / 2, x = side * P.nave;
    const wins: Win[] = [
      { p: m, w: 7.3, sill: P.arcadeSpring, spring: P.arcadeSpring, rise: P.arcadeRise, door: true, plain: true },
      ...[-2.5, 0, 2.5].map((d): Win => ({ p: m + d, w: 1.5, sill: 16.5, spring: 17.7, plain: true })),
      { p: m, w: 5, sill: P.clerestory, spring: P.clerestory + 2.1, glass: GLASS.lattice, levels: 2, seed: m * 0.7 + side },
    ];
    c.shell(side > 0 ? [x, z1] : [x, z0], side > 0 ? [x, z0] : [x, z1], P.arcadeSpring, P.wallTop, 1.2, wins, { core: P.aisleTop + 3.4, collide: false });
    addBox(...c.W(x, m), 0.6, 4.5, 0, y + P.wallTop, y + 12);
  }
  // Roofs, their colliders, and a cornice with a pierced parapet line.
  gableRoof(ext, X, Z, 10.5, P.end * 2 + 2.6, y + P.wallTop, P.roofRise);
  for (const side of [-1, 1]) gableRoof(ext, X + side * 20.1, Z - 9, 10.1, 20.6, y + P.wallTop, P.roofRise, true);
  addBox(X, Z, 10.5, P.end + 1.3, 0, (lx) => y + P.wallTop + 0.4 + P.roofRise * (1 - Math.abs(lx) / 10.5), y + P.wallTop - 1);
  for (const side of [-1, 1]) {
    addBox(X + side * 20.1, Z - 9, 10.3, 10.1, 0, (_lx, lz) => y + P.wallTop + 0.4 + P.roofRise * (1 - Math.abs(lz) / 10.1), y + P.wallTop - 1);
    for (const [z0, z1] of [[-P.end - 0.9, -18.65], [0.65, 28.9]]) {
      leanRoof(ext, X + side * 10.2, y + P.aisleTop + 4.3, X + side * 19.2, y + P.aisleTop - 0.1, Z + z0, Z + z1);
      addBox(X + side * 14.6, Z + (z0 + z1) / 2, 4.5, (z1 - z0) / 2, 0, (lx) => y + P.aisleTop + 2.1 - side * lx * 0.49, y + 13.6);
      ext.box('ashlar', X + side * 18.9, y + P.aisleTop - 0.5, Z + (z0 + z1) / 2, 0.7, 0.5, z1 - z0, 0, TINT.trim, 0);
    }
    ext.box('ashlar', X + side * 10.35, y + P.wallTop - 0.55, Z, 0.7, 0.6, P.end * 2, 0, TINT.trim, 0);
  }
}

function towers(c: Ctx): void {
  const { ext, inside, y } = c, P = PLAN, h = P.towerHalf;
  const belfry = (x: number, z: number, half: number, y0: number, y1: number): void => {
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a);
      for (const off of [-half * 0.42, half * 0.42]) {
        const px = x + nx * (half + 0.02) + nz * off, pz = z + nz * (half + 0.02) - nx * off;
        const m = place(px, 0, pz, a);
        const w = half * 0.5, spring = y1 - w * EQ;
        ext.add('plain', new THREE.ShapeGeometry(new THREE.Shape(archPoints(w, spring, w * EQ, 8, y0))), TINT.louvre, m, 0);
        orders(ext, 'ashlar', m, { w, sill: y0, spring }, 2, TINT.trim, 0.2, 0.14);
        // Louvre boards.
        ext.detail(() => { for (let ly = y0 + 0.5; ly < spring; ly += 0.7) ext.slab('slate', w, 0.07, 0.42, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationX(0.6).setPosition(0, ly, 0.1)), 0x55657c); });
      }
    }
  };
  const stage = (x: number, z: number, half: number, at: number): void => {
    ext.box('ashlar', x, y + at, z, half * 2 + 0.7, 0.45, half * 2 + 0.7, 0, TINT.trim, 0);
  };
  for (const [tx, tz] of P.towers) {
    const [x, z] = c.W(tx, tz);
    ext.box('ashlar', x, y - 8, z, h * 2, P.towerHeight + 8, h * 2, 0, TINT.lime, 0.1);
    addBox(x, z, h, h, 0, y + P.towerHeight);
    // The faces the church sees are marble.
    inside.box('marble', x - Math.sign(tx) * (h + 0.04), y, z - 1.2, 0.12, P.wallTop, h * 2 - 2.2, 0, TINT.white, 0.04);
    inside.box('marble', x, y, z - h - 0.04, h * 2 - 0.6, P.aisleTop - 2, 0.12, 0, TINT.white, 0.04);
    for (const at of [P.aisleTop, P.wallTop, 40, P.towerHeight - 0.4]) stage(x, z, h, at);
    // Clasping buttresses that step back as they rise.
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const [bx, bz] of [[1, 0], [0, 1]]) {
      const px = x + sx * (h - 0.9 * (1 - bx)) + sx * bx * 0.5, pz = z + sz * (h - 0.9 * (1 - bz)) + sz * bz * 0.5;
      ext.box('ashlar', px, y - 8, pz, bx ? 1.3 : 1.5, 30, bz ? 1.3 : 1.5, 0, TINT.lime, 0.06);
      ext.box('ashlar', px - sx * bx * 0.2, y + 22, pz - sz * bz * 0.2, bx ? 0.9 : 1.3, 17, bz ? 0.9 : 1.3, 0, TINT.lime, 0);
    }
    // Two tall blind lancets on the south face, the belfry above.
    for (const off of [-2.1, 2.1]) {
      const m = place(x + off, 0, z + h + 0.02, 0);
      orders(ext, 'ashlar', m, { w: 1.7, sill: y + 17, spring: y + 28 }, 2, TINT.trim, 0.16, 0.1);
      ext.add('plain', new THREE.ShapeGeometry(new THREE.Shape(archPoints(1.7, y + 28, 1.7 * EQ, 8, y + 17))), TINT.louvre, m, 0);
    }
    belfry(x, z, h, y + 41.2, y + 50.4);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pinnacle(ext, 'ashlar', x + sx * (h - 0.5), y + P.towerHeight, z + sz * (h - 0.5), 1.25, 8.5, TINT.trim, TINT.gold);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      ext.box('ashlar', x + Math.sin(a) * (h - 0.25), y + P.towerHeight, z + Math.cos(a) * (h - 0.25), h * 2 - 2.6, 1.3, 0.35, a, TINT.trim, 0);
    }
    const tip = spire(ext, x, y + P.towerHeight, z, h - 0.5, 27, TINT.slate, TINT.gold);
    addRound(x, z, h - 0.5, (lx, lz) => y + P.towerHeight + 27 * Math.max(0, 1 - Math.hypot(lx, lz) / (h - 0.5)), y + P.towerHeight);
    c.flags.push({ x: x + Math.sign(tx) * (h - 0.5), y: y + P.towerHeight + 8.6, z: z + h - 0.5, color: 0x2c4a9e, size: 1.6 });
    void tip;
  }
  // The crossing tower rises through the meeting of the four roofs.
  const [x, z] = c.W(0, -9), base = P.wallTop + 1, top = 59;
  ext.box('ashlar', x, y + base, z, 11, top - base, 11, 0, TINT.lime, 0.05);
  addBox(x, z, 5.5, 5.5, 0, y + top, y + base);
  for (const at of [44.6, top - 0.4]) stage(x, z, 5.5, at);
  belfry(x, z, 5.5, y + 46, y + 56.6);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    ext.box('ashlar', x + sx * 5.5, y + base, z + sz * 5.5, 1.5, top - base, 1.5, Math.PI / 4, TINT.lime, 0);
    pinnacle(ext, 'ashlar', x + sx * 5.5, y + top, z + sz * 5.5, 1.4, 10, TINT.trim, TINT.gold);
  }
  spire(ext, x, y + top, z, 5.4, 33, TINT.slate, TINT.gold);
  addRound(x, z, 5.4, (lx, lz) => y + top + 33 * Math.max(0, 1 - Math.hypot(lx, lz) / 5.4), y + top);
}

function buttresses(c: Ctx): void {
  const { ext, y } = c, P = PLAN, cloister = P.cloister.x0 + P.cloister.walk;
  for (const side of [-1, 1]) {
    // Wall buttresses on the aisles: two weathered stages and a gablet.
    for (const bz of [-36.6, -27, 9, 18]) {
      if (side < 0 && bz === -27) continue;
      if (side > 0 && bz > 0) continue;
      const [x, z] = c.W(side * (P.wall + 1.5), bz);
      ext.box('ashlar', x, y - 8, z, 1.8, 16, 1.7, 0, TINT.lime, 0.06);
      ext.box('ashlar', x - side * 0.25, y + 8, z, 1.3, 5.2, 1.5, 0, TINT.lime, 0);
      ext.prism('ashlar', x - side * 0.25, y + 13.2, z, 1.5, 1.4, 1.3, Math.PI / 2, TINT.trim);
      ext.prism('ashlar', x + side * 0.1, y + 8, z, 1.7, 1.1, 0.8, Math.PI / 2, TINT.trim);
      addBox(x, z, 0.9, 0.85, 0, y + 13);
    }
    // Flying buttresses: an outer pier under a pinnacle, and two arched struts to the clerestory.
    for (const bz of [-27, 9, 18, 27]) {
      if (side < 0 && bz === -27) continue;
      const px = side * (side > 0 && bz > 0 ? cloister : 24.2);
      const [x, z] = c.W(px, bz);
      ext.box('ashlar', x, y - 8, z, 1.7, 29, 2.1, 0, TINT.lime, 0.06);
      addBox(x, z, 0.85, 1.05, 0, y + 21);
      ext.prism('ashlar', x, y + 21, z, 1.9, 2.3, 1.6, Math.PI / 2, TINT.trim);
      pinnacle(ext, 'ashlar', x, y + 21, z, 1.25, 7.5, TINT.trim, TINT.gold);
      for (const [from, to, thick] of [[19.6, 27.4, 1.25], [15.4, 21.6, 0.9]] as [number, number, number][]) {
        const a = new THREE.Vector3(x - side * 0.7, y + from, z), e = new THREE.Vector3(c.ax + side * (P.nave + 0.75), y + to, z);
        beam(ext, 'ashlar', a, e, 0.85, TINT.lime, thick);
        // A stone gutter along its back.
        beam(ext, 'ashlar', a.clone().setY(a.y + thick * 0.55), e.clone().setY(e.y + thick * 0.55), 1.0, TINT.trim, 0.2);
      }
    }
    // Pilasters between the clerestory windows, each crowned with a pinnacle on the parapet.
    for (const bz of [-36.4, -27, -18, 0, 9, 18, 27]) {
      const [x, z] = c.W(side * (P.nave + 0.95), bz);
      ext.box('ashlar', x, y + P.aisleTop + 3, z, 0.9, P.wallTop - P.aisleTop - 3, 1.5, 0, TINT.lime, 0);
      pinnacle(ext, 'ashlar', x, y + P.wallTop, z, 0.95, 5.2, TINT.trim, TINT.gold);
    }
  }
  // Gable crosses.
  for (const [gx, gz] of [[0, -P.end], [0, P.end], [-P.reach, -9], [P.reach, -9]]) {
    const [x, z] = c.W(gx, gz), top = y + P.wallTop + P.roofRise + 0.6;
    ext.cyl('ashlar', x, top, z, 0.2, 0.34, 1.6, TINT.trim, 8, 0);
    ext.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 1.0, 0.36), { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06), TINT.gold, place(x, top + 2.5, z, gx ? Math.PI / 2 : 0), 0);
  }
}

function portal(c: Ctx): void {
  const { ext, inside, y } = c, P = PLAN;
  const [x, z] = c.W(0, P.end + P.endThick / 2);
  const door = { w: 5, sill: y, spring: y + 5.6, rise: 5 * EQ };
  // Five orders of moulding stepping out round the door, under a crocketed gable.
  orders(ext, 'ashlar', place(x, 0, z, 0), door, 5, TINT.trim, 0.26, 0.2, TINT.gold);
  const gable = new THREE.Shape([new THREE.Vector2(-4.7, y + 9.4), new THREE.Vector2(4.7, y + 9.4), new THREE.Vector2(0, y + 17)]);
  gable.holes.push(new THREE.Path(Array.from({ length: 18 }, (_, i) => new THREE.Vector2(Math.cos(-i / 18 * Math.PI * 2) * 1.15, y + 12.2 + Math.sin(-i / 18 * Math.PI * 2) * 1.15))));
  ext.shape('ashlar', gable, 0.5, place(x, 0, z + 0.9, 0), TINT.trim);
  ext.add('gilt', new THREE.ExtrudeGeometry(starShape(8, 1.0, 0.36), { depth: 0.1, bevelEnabled: false }), TINT.gold, place(x, y + 12.2, z + 0.7, 0), 0);
  for (const side of [-1, 1]) {
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      ext.add('ashlar', new THREE.OctahedronGeometry(0.2).scale(1, 1.3, 1), TINT.trim, place(x + side * 4.7 * (1 - t), y + 9.5 + 7.5 * t + 0.25, z + 0.9), 0);
    }
    // Jamb figures on pedestals under gablets, and the stepped piers that frame the portal.
    ext.box('ashlar', x + side * 5.4, y - 6, z + 0.5, 1.5, 20.5, 1.9, 0, TINT.lime, 0.06);
    pinnacle(ext, 'ashlar', x + side * 5.4, y + 14.5, z + 0.5, 1.2, 6.5, TINT.trim, TINT.gold);
    addBox(x + side * 5.4, z + 0.5, 0.75, 0.95, 0, y + 14.5);
    ext.box('ashlar', x + side * 3.9, y, z + 1.0, 1.0, 1.5, 1.0, 0, TINT.trim, 0.1);
    statue(ext, x + side * 3.9, y + 1.5, z + 1.0, 2.5, 0, TINT.trim);
    ext.prism('ashlar', x + side * 3.9, y + 4.7, z + 1.0, 1.3, 1.2, 0.9, 0, TINT.trim);
    addBox(x + side * 3.9, z + 1.0, 0.5, 0.5, 0, y + 4);
    // Oak doors stand open against the inner wall.
    inside.box('oak', x + side * 2.62, y, z - 2.6, 0.14, 7.2, 2.5, 0, TINT.oakDark, 0.08);
    for (const hinge of [1.2, 3.4, 5.6]) inside.box('bronze', x + side * 2.53, y + hinge, z - 2.6, 0.04, 0.16, 2.2, 0, TINT.bronze, 0);
  }
  // A broad threshold of two shallow steps.
  ext.box('ashlar', x, y - 0.4, z + 2.2, 13, 0.42, 4.6, 0, TINT.trim, 0);
  addBox(x, z + 2.2, 6.5, 2.3, 0, y + 0.03);
}

/** Shafts of afternoon light through the west windows, and the coloured pools where they land. */
function sunbeams(c: Ctx): { shafts: THREE.Mesh; patches: THREE.Mesh } {
  const { y } = c, P = PLAN;
  const light: THREE.BufferGeometry[] = [], pools: THREE.BufferGeometry[] = [];
  const travel = new THREE.Vector3(-SUN_DIRECTION[0], -SUN_DIRECTION[1], -SUN_DIRECTION[2]).normalize();
  const tint = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
    const k = new THREE.Color(color), n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [k.r, k.g, k.b]).flat(), 3));
    return g;
  };
  const shaft = (lx: number, ly: number, lz: number, stopX: number, color: number, neck: number, spread: number): void => {
    const [sx, sz] = c.W(lx, lz), start = new THREE.Vector3(sx, y + ly, sz);
    // The beam runs until it meets the floor or the far arcade, whichever comes first.
    const toFloor = (ly - 0.12) / -travel.y, toWall = (stopX - lx) / travel.x, run = Math.min(toFloor, toWall);
    const end = start.clone().addScaledVector(travel, run);
    const across = new THREE.Vector3(travel.z, 0, -travel.x).normalize(), upright = new THREE.Vector3().crossVectors(travel, across).normalize();
    for (const v of [across, upright]) {
      const g = new THREE.BufferGeometry().setFromPoints([start.clone().addScaledVector(v, -neck), start.clone().addScaledVector(v, neck),
        end.clone().addScaledVector(v, spread), end.clone().addScaledVector(v, -spread)]);
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      light.push(tint(g, color));
    }
    if (toFloor <= toWall) pools.push(tint(new THREE.PlaneGeometry(spread * 3.4, spread * 2.2).rotateX(-Math.PI / 2).translate(end.x, y + 0.07, end.z), color));
  };
  const hues = [0xffe9c4, 0xcfe0ff, 0xffe2a8, 0xd8e8ff, 0xfff0d0];
  [-31.5, -22.5, 4.5, 13.5, 22.5].forEach((z, i) => shaft(-P.nave + 0.7, P.clerestory + 3.2, z, P.nave - 0.8, hues[i], 1.3, 2.0));
  [4.5, 13.5, 22.5].forEach((z, i) => shaft(-P.wall + 0.8, 7.4, z, P.nave - 0.8, hues[(i + 2) % 5], 1.2, 1.9));
  shaft(-P.reach + 0.9, 13, -9, P.nave - 0.8, 0xffe6b8, 2.0, 3.0);
  shaft(-P.wall + 0.8, 11, -31.5, P.nave - 0.8, 0xdfe9ff, 0.9, 1.5);
  const shafts = new THREE.Mesh(mergeGeometries(light), createAbbeyLightMaterial('shaft'));
  shafts.name = 'Abbey bounded window shafts'; shafts.renderOrder = 2;
  const patches = new THREE.Mesh(mergeGeometries(pools), createAbbeyLightMaterial('patch'));
  patches.name = 'Abbey bounded window patches'; patches.renderOrder = 1;
  return { shafts, patches };
}

/** A soft glow round every lamp and candle, always facing the eye. */
function halos(points: THREE.Vector3[]): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])), 3));
  g.instanceCount = points.length;
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    name: 'abbey-halo', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: shared.uTime },
    vertexShader: `attribute vec3 aCentre; uniform float uTime; varying vec2 vUv; varying float vFlicker;
      void main() {
        vUv = position.xy;
        vFlicker = 0.9 + 0.1 * sin(uTime * 3.1 + aCentre.x * 1.7 + aCentre.z * 2.3);
        vec4 view = viewMatrix * vec4(aCentre, 1.0);
        view.xy += position.xy * 2.3;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `varying vec2 vUv; varying float vFlicker;
      void main() {
        float r = length(vUv);
        float glow = pow(max(0.0, 1.0 - r), 2.6);
        gl_FragColor = vec4(vec3(1.0, 0.78, 0.46) * glow * 0.34 * vFlicker, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'Abbey lamp halos';
  return mesh;
}

/** Cloudfall Abbey: a hollow gothic church with its cloister, chapter house, library and sacristy. */
export function buildAbbey(): THREE.Group {
  const c = context();
  pbrUniforms.uAbbeyFloor.value = c.y;
  shell(c); towers(c); buttresses(c); portal(c);
  buildInterior(c);
  buildPrecinct(c);
  const exterior = c.ext.build(true), interior = c.inside.build(true);
  exterior.add(c.glass.build());
  const beams = sunbeams(c);
  interior.add(beams.shafts, beams.patches, halos(c.lamps));
  interior.visible = false;
  // The interior is drawn only when the traveller is near enough to see into it.
  exterior.children[0].onBeforeRender = () => {
    interior.visible = Math.hypot(shared.uPlayer.value.x - c.ax, shared.uPlayer.value.z - c.az) < ABBEY_INTERIOR_RANGE;
  };
  exterior.children[0].frustumCulled = false;
  const group = new THREE.Group(); group.name = 'Cloudfall Abbey';
  group.add(exterior, interior, createFlags(c.flags));
  group.userData.interior = interior;
  return group;
}
