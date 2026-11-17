import * as THREE from 'three';
import { seededRandom } from '../noise';

/**
 * Trees grown from code: a trunk, limbs that fork and reach, and clumps of
 * foliage hung on the outer twigs. Wood is a real tube mesh; foliage is a set
 * of cards, each showing a painted spray of leaves and carrying the direction
 * out of the crown so that the whole crown shades as one rounded mass.
 */
export type TreeKind = 'oak' | 'great' | 'blossom' | 'cypress' | 'pine';

export interface TreeModel {
  wood: THREE.BufferGeometry;
  /** Every foliage card, for trees close to the eye. */
  leaves: THREE.BufferGeometry;
  /** A quarter as many cards, each twice the size, for the middle distance. */
  leavesMid: THREE.BufferGeometry;
  height: number;
  radius: number;
  trunkRadius: number;
  trunkHeight: number;
}

interface Card { p: THREE.Vector3; n: THREE.Vector3; size: number; depth: number }

class Wood {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  /** A tapering tube through `path`. Rings are carried along without twisting. */
  tube(path: THREE.Vector3[], radii: number[], sides: number, shade = 1): void {
    const base = this.pos.length / 3;
    const tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), n = new THREE.Vector3();
    side.set(1, 0, 0);
    for (let i = 0; i < path.length; i++) {
      tangent.copy(path[Math.min(path.length - 1, i + 1)]).sub(path[Math.max(0, i - 1)]).normalize();
      // Re-square the frame against the new tangent.
      up.crossVectors(tangent, side).normalize();
      if (up.lengthSq() < 0.5) up.set(0, 0, 1);
      side.crossVectors(up, tangent).normalize();
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2;
        n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
        // Ridged bark: the radius wobbles round the ring and along the limb.
        const ridge = 1 + 0.07 * Math.sin(a * 5 + i * 1.3) + 0.04 * Math.sin(a * 11 + i * 0.7);
        const r = radii[i] * ridge;
        this.pos.push(path[i].x + n.x * r, path[i].y + n.y * r, path[i].z + n.z * r);
        this.nor.push(n.x, n.y, n.z);
        const tone = shade * (0.78 + 0.22 * Math.sin(a * 5 + i * 1.3) * 0.5 + 0.11);
        this.col.push(0.2 * tone, 0.145 * tone, 0.105 * tone);
      }
    }
    const ring = sides + 1;
    for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * ring + k, b = a + 1, c = a + ring, d = c + 1;
      // Counter-clockwise seen from outside: with the (side, up, tangent) frame above, a,c,b faced inward
      // and the front-face material drew only the far wall of every limb.
      this.idx.push(a, b, c, b, d, c);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

function cardGeometry(cards: Card[]): THREE.BufferGeometry {
  const vertices = cards.length * 4;
  const pos = new Float32Array(vertices * 3), nor = new Float32Array(vertices * 3);
  const corner = new Float32Array(vertices * 2), data = new Float32Array(vertices * 3);
  const idx = vertices > 65535 ? new Uint32Array(cards.length * 6) : new Uint16Array(cards.length * 6);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  cards.forEach((c, i) => {
    const seed = (Math.sin(i * 91.7 + c.p.x * 13.1) * 43758.5453) % 1;
    for (let j = 0; j < 4; j++) {
      const v = i * 4 + j;
      pos.set([c.p.x, c.p.y, c.p.z], v * 3);
      nor.set([c.n.x, c.n.y, c.n.z], v * 3);
      corner.set(corners[j], v * 2);
      data.set([c.size, Math.abs(seed), c.depth], v * 3);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aCard', new THREE.BufferAttribute(data, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Points along a limb that leaves `from` toward `dir` and bends upward as it goes. */
function limb(from: THREE.Vector3, dir: THREE.Vector3, length: number, lift: number, steps: number, wander: number, rand: () => number): THREE.Vector3[] {
  const pts = [from.clone()];
  const d = dir.clone().normalize(), p = from.clone();
  for (let i = 1; i <= steps; i++) {
    d.y += lift / steps;
    d.x += (rand() - 0.5) * wander;
    d.z += (rand() - 0.5) * wander;
    d.normalize();
    p.addScaledVector(d, length / steps);
    pts.push(p.clone());
  }
  return pts;
}
const taper = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + (to - from) * Math.pow(i / (n - 1), 0.8));

function finish(wood: Wood, tips: { p: THREE.Vector3; r: number }[], perTip: number, cardSize: number, rand: () => number,
  trunkRadius: number, trunkHeight: number, upward = 0.25): TreeModel {
  const centre = new THREE.Vector3();
  let weight = 0, top = 0, radius = 0;
  for (const t of tips) { centre.addScaledVector(t.p, t.r); weight += t.r; }
  centre.divideScalar(weight || 1);
  let reach = 0;
  for (const t of tips) reach = Math.max(reach, t.p.distanceTo(centre) + t.r);
  const make = (count: number, size: number, spread: number): Card[] => {
    const cards: Card[] = [];
    for (const t of tips) for (let k = 0; k < count; k++) {
      // Even directions, pushed outward so the cards form a shell round the tip.
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, ring = Math.sqrt(1 - u * u);
      const out = new THREE.Vector3(Math.cos(a) * ring, u * 0.8 + 0.15, Math.sin(a) * ring);
      const p = t.p.clone().addScaledVector(out, t.r * spread * (0.45 + 0.55 * rand()));
      const fromCentre = p.clone().sub(centre);
      const depth = 1 - Math.min(1, fromCentre.length() / reach);
      const n = fromCentre.normalize().multiplyScalar(0.62).addScaledVector(out, 0.38);
      n.y += upward;
      cards.push({ p, n: n.normalize(), size: size * t.r * (0.8 + 0.45 * rand()), depth });
      top = Math.max(top, p.y + size * t.r);
      radius = Math.max(radius, Math.hypot(p.x, p.z) + size * t.r);
    }
    return cards;
  };
  const near = make(perTip, cardSize, 1);
  const mid = make(Math.max(1, Math.round(perTip / 4)), cardSize * 1.9, 0.75);
  return { wood: wood.build(), leaves: cardGeometry(near), leavesMid: cardGeometry(mid), height: top, radius, trunkRadius, trunkHeight };
}

function broadleaf(seed: number, grand: boolean, detail: number): TreeModel {
  const rand = seededRandom(seed), wood = new Wood();
  const girth = grand ? 0.62 : 0.34 + rand() * 0.08;
  const bole = grand ? 3.4 : 2.6 + rand() * 1.1;
  const lean = new THREE.Vector3((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5);
  // The trunk: flared at the root, leaning a little, running on as a leader into the crown.
  const leader = limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean.x * 0.2, 1, lean.z * 0.2), bole + (grand ? 3.6 : 2.6), 0.2, 9, 0.12, rand);
  const radii = taper(girth, girth * 0.24, leader.length);
  radii[0] *= 1.55; radii[1] *= 1.18;
  wood.tube(leader, radii, detail > 1 ? 12 : 8);
  const tips: { p: THREE.Vector3; r: number }[] = [{ p: leader[leader.length - 1].clone().add(new THREE.Vector3(0, 0.5, 0)), r: grand ? 1.5 : 1.15 }];
  const limbs = grand ? 8 : 5 + Math.floor(rand() * 2);
  for (let i = 0; i < limbs; i++) {
    const at = 0.42 + 0.5 * (i / limbs) + rand() * 0.06;
    const k = Math.min(leader.length - 2, Math.floor(at * (leader.length - 1)));
    const a = i / limbs * Math.PI * 2 * 1.618 + rand() * 0.5;
    const rise = 0.25 + rand() * 0.45 + at * 0.4;
    const length = (grand ? 3.9 : 2.7) * (1.15 - at * 0.45) * (0.85 + rand() * 0.3);
    const path = limb(leader[k], new THREE.Vector3(Math.cos(a), rise, Math.sin(a)), length, 0.55, 6, 0.22, rand);
    wood.tube(path, taper(radii[k] * 0.62, girth * 0.1, path.length), detail > 1 ? 7 : 5, 0.92);
    // Boughs fork off the outer half of each limb; twigs fork off the boughs.
    const forks = grand ? 5 : 4;
    for (let f = 0; f < forks; f++) {
      const j = 2 + Math.floor((f / forks) * (path.length - 2));
      const along = path[Math.min(path.length - 1, j + 1)].clone().sub(path[j]).normalize();
      const turn = (f % 2 ? 1 : -1) * (0.7 + rand() * 0.6);
      const dir = along.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      dir.y += 0.2 + rand() * 0.4;
      const bough = limb(path[j], dir, length * (0.42 + rand() * 0.22), 0.4, 4, 0.3, rand);
      wood.tube(bough, taper(girth * 0.11, girth * 0.035, bough.length), 4, 0.86);
      tips.push({ p: bough[bough.length - 1], r: (grand ? 1.25 : 1.0) * (0.85 + rand() * 0.35) });
      if (detail > 0) tips.push({ p: bough[2].clone().add(new THREE.Vector3((rand() - 0.5), 0.4 + rand() * 0.5, (rand() - 0.5))), r: (grand ? 1.05 : 0.85) });
    }
    tips.push({ p: path[path.length - 1], r: (grand ? 1.3 : 1.05) });
  }
  return finish(wood, tips, detail > 1 ? 9 : 6, 0.58, rand, girth * 1.25, bole);
}

function columnar(seed: number, detail: number): TreeModel {
  const rand = seededRandom(seed), wood = new Wood();
  const height = 8.5 + rand() * 3;
  const trunk = limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 1, 0), height * 0.92, 0, 6, 0.03, rand);
  wood.tube(trunk, taper(0.2, 0.04, trunk.length), 6);
  const tips: { p: THREE.Vector3; r: number }[] = [];
  // A flame-shaped spire: narrow at the foot, widest a third of the way up, then a long point.
  const rings = detail > 0 ? 16 : 10;
  for (let i = 0; i < rings; i++) {
    const t = (i + 0.5) / rings, y = 0.9 + t * (height - 0.9);
    const width = 1.05 * Math.pow(Math.sin(Math.pow(t, 0.62) * Math.PI), 0.8) + 0.12;
    const count = Math.max(2, Math.round(width * 4.2));
    for (let k = 0; k < count; k++) {
      const a = k / count * Math.PI * 2 + i * 1.9;
      tips.push({ p: new THREE.Vector3(Math.cos(a) * width * 0.6, y, Math.sin(a) * width * 0.6), r: 0.55 + width * 0.28 });
    }
  }
  return finish(wood, tips, detail > 1 ? 4 : 3, 0.62, rand, 0.26, 1.2, 0.45);
}

function conifer(seed: number, detail: number): TreeModel {
  const rand = seededRandom(seed), wood = new Wood();
  const height = 10 + rand() * 4.5;
  const trunk = limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 1, 0), height, 0, 8, 0.025, rand);
  wood.tube(trunk, taper(0.27, 0.03, trunk.length), 7);
  const tips: { p: THREE.Vector3; r: number }[] = [];
  // Whorls of boughs, long and drooping low down, short and lifted near the top.
  const first = 2.0 + rand() * 0.8, gap = detail > 0 ? 0.78 : 1.2;
  for (let y = first, w = 0; y < height - 0.6; y += gap * (0.9 + rand() * 0.2), w++) {
    const t = (y - first) / (height - first);
    const length = (3.1 + rand() * 0.4) * Math.pow(1 - t, 0.85) + 0.35;
    const count = 5 + (w % 2);
    for (let k = 0; k < count; k++) {
      const a = k / count * Math.PI * 2 + w * 0.9 + rand() * 0.3;
      const droop = -0.28 + t * 0.55;
      const path = limb(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a), droop, Math.sin(a)), length, 0.16, 3, 0.08, rand);
      if (detail > 0 || k % 2 === 0) wood.tube(path, taper(0.06 * (1 - t) + 0.02, 0.012, path.length), 3, 0.8);
      for (let s = 1; s < path.length; s++) tips.push({ p: path[s].clone(), r: 0.42 + length * 0.12 });
    }
  }
  tips.push({ p: new THREE.Vector3(0, height, 0), r: 0.45 });
  return finish(wood, tips, detail > 1 ? 4 : 2, 0.62, rand, 0.34, first, 0.5);
}

/**
 * Shrubs and flowers: no trunk worth the name and no solid core. The whole
 * plant is sprays of leaves, packed thickly at the surface of its shape and
 * thinning into a shaded interior, so that looking into it shows more leaves.
 * Some kinds are wild and ragged, some are clipped smooth, some hang from a
 * rim or climb a wall. Flowering kinds paint a share of their sprays in bloom.
 */
export type ShrubKind = 'shrub' | 'briar' | 'broom' | 'rose' | 'hydrangea' | 'yew' | 'hedge' | 'bed' | 'spill' | 'ivy' | 'climber';
export const SHRUB_KINDS: ShrubKind[] = ['shrub', 'briar', 'broom', 'rose', 'hydrangea', 'yew', 'hedge', 'bed', 'spill', 'ivy', 'climber'];
export type FloraKind = TreeKind | ShrubKind;

type Shape = 'mound' | 'ball' | 'cone' | 'block' | 'bed' | 'spill' | 'wall';
/** w across (x), h tall, d deep (z, defaults to w); leaf is the half-width of a spray; clipped shapes stay smooth. */
interface Form { shape: Shape; w: number; h: number; d?: number; leaf: number; cover: number; clipped?: boolean }
const FORMS: Record<ShrubKind, Form> = {
  shrub: { shape: 'mound', w: 2.0, h: 1.35, leaf: 0.26, cover: 4.2 },
  briar: { shape: 'mound', w: 2.3, h: 1.5, leaf: 0.25, cover: 4.0 },
  broom: { shape: 'mound', w: 1.7, h: 1.6, leaf: 0.24, cover: 4.2 },
  rose: { shape: 'mound', w: 1.3, h: 1.25, leaf: 0.2, cover: 4.4 },
  hydrangea: { shape: 'ball', w: 1.5, h: 1.25, leaf: 0.22, cover: 4.4 },
  yew: { shape: 'cone', w: 1.9, h: 3.4, leaf: 0.17, cover: 4.6, clipped: true },
  hedge: { shape: 'block', w: 1.5, h: 0.75, d: 0.7, leaf: 0.13, cover: 4.6, clipped: true },
  bed: { shape: 'bed', w: 1.7, h: 0.5, leaf: 0.15, cover: 3.8 },
  spill: { shape: 'spill', w: 1.2, h: 0.42, leaf: 0.12, cover: 3.8 },
  ivy: { shape: 'wall', w: 1.8, h: 2.6, leaf: 0.19, cover: 3.4 },
  climber: { shape: 'wall', w: 1.8, h: 2.6, leaf: 0.19, cover: 3.4 },
};

/** Rough outer area of a form, to decide how many sprays cover it. */
function formArea(f: Form): number {
  const a = f.w / 2, c = (f.d ?? f.w) / 2;
  switch (f.shape) {
    case 'mound': case 'ball': {
      const b = f.h / 2, p = 1.6;
      const whole = 4 * Math.PI * Math.pow((Math.pow(a * b, p) + Math.pow(a * c, p) + Math.pow(b * c, p)) / 3, 1 / p);
      return whole * (f.shape === 'mound' ? 0.75 : 0.9);
    }
    case 'cone': return Math.PI * a * Math.hypot(a, f.h);
    case 'block': return f.w * (f.d ?? f.w) + 2 * f.h * (f.w + (f.d ?? f.w));
    case 'bed': return Math.PI * a * c * 1.25;
    case 'spill': return Math.PI * a * c * 1.25 + 2 * Math.PI * a * f.h * 1.6;
    case 'wall': return f.w * f.h * 0.75;
  }
}

export function makeShrub(kind: ShrubKind, seed: number, detail: number): TreeModel {
  const f = FORMS[kind], rand = seededRandom(seed * 131 + 7), wood = new Wood();
  const a = f.w / 2, c = (f.d ?? f.w) / 2;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), centre = new THREE.Vector3();
  // Lumps make a wild shrub irregular; a clipped one stays true to its shape.
  const lumpPhase = rand() * 100;
  const lump = (x: number, y: number, z: number): number => f.clipped ? 1
    : 1 + 0.16 * Math.sin(x * 3.1 + lumpPhase) * Math.cos(z * 2.7 - y * 1.9 + lumpPhase) + 0.08 * Math.sin(y * 5.3 + x * 4.1 + lumpPhase * 2);
  /** A point on the outside of the shape, its outward normal, and the centre it is measured from. */
  const surface = (): void => {
    switch (f.shape) {
      case 'mound': case 'ball': {
        const b = f.h / 2, cy = f.shape === 'ball' ? f.h / 2 : f.h * 0.45;
        let u: number;
        do u = rand() * 2 - 1; while (u < (f.shape === 'ball' ? -0.75 : -0.45));
        const t = rand() * Math.PI * 2, ring = Math.sqrt(1 - u * u);
        const k = lump(Math.cos(t) * ring, u, Math.sin(t) * ring);
        p.set(Math.cos(t) * ring * a * k, cy + u * b * k, Math.sin(t) * ring * c * k);
        n.set(Math.cos(t) * ring / a, u / b, Math.sin(t) * ring / c).normalize();
        centre.set(0, cy, 0);
        if (p.y < 0.06) p.y = 0.06 + rand() * 0.08;
        return;
      }
      case 'cone': {
        const base = 0.35;
        let y: number, r: number;
        do { y = base + rand() * (f.h - base); r = a * Math.pow(1 - (y - base) / (f.h - base), 0.85) * Math.min(1, (y - base + 0.25) / 0.45); } while (rand() * a > r);
        const t = rand() * Math.PI * 2;
        p.set(Math.cos(t) * r, y, Math.sin(t) * r);
        n.set(Math.cos(t), a / (f.h - base), Math.sin(t)).normalize();
        centre.set(0, Math.max(base + 0.2, y), 0);
        return;
      }
      case 'block': {
        const d = f.d ?? f.w, top = f.w * d, sx = f.h * d, sz = f.h * f.w, pick = rand() * (top + 2 * sx + 2 * sz);
        const x = (rand() - 0.5) * f.w, y = rand() * f.h, z = (rand() - 0.5) * d;
        if (pick < top) { p.set(x, f.h, z); n.set(0, 1, 0); }
        else if (pick < top + 2 * sx) { const s = pick < top + sx ? 1 : -1; p.set(s * a, y, z); n.set(s, 0, 0); }
        else { const s = pick < top + 2 * sx + sz ? 1 : -1; p.set(x, y, s * c); n.set(0, 0, s); }
        // Clipped hedges round off at their edges.
        n.x += Math.sign(p.x) * Math.max(0, Math.abs(p.x) / a - 0.85) * 2;
        n.z += Math.sign(p.z) * Math.max(0, Math.abs(p.z) / c - 0.85) * 2;
        n.y += Math.max(0, p.y / f.h - 0.85) * 2;
        n.normalize();
        centre.set(0, f.h / 2, 0);
        return;
      }
      case 'bed': case 'spill': {
        const t = rand() * Math.PI * 2;
        // A spill also trails over the rim of its pot or box.
        if (f.shape === 'spill' && rand() < 0.38) {
          const drop = Math.pow(rand(), 0.7) * f.h * 2.6, out = 0.96 + rand() * 0.14 + drop * 0.08;
          p.set(Math.cos(t) * a * out, -drop, Math.sin(t) * c * out);
          n.set(Math.cos(t), -0.15, Math.sin(t)).normalize();
          centre.set(0, -drop, 0);
          return;
        }
        const r = Math.sqrt(rand());
        const k = lump(Math.cos(t) * r, 0, Math.sin(t) * r);
        p.set(Math.cos(t) * r * a, f.h * Math.sqrt(Math.max(0, 1 - r * r)) * k * (0.75 + rand() * 0.25), Math.sin(t) * r * c);
        n.set(Math.cos(t) * r * 0.8, 1, Math.sin(t) * r * 0.8).normalize();
        centre.set(0, 0, 0);
        return;
      }
      case 'wall': {
        // Climbs from a root at the foot and fans out as it rises.
        const y = Math.pow(rand(), 0.85) * f.h, spread = a * (0.25 + 0.75 * Math.pow(y / f.h, 0.7));
        const x = (rand() * 2 - 1) * spread * lump(y, 0, 0);
        p.set(x, y, 0.04 + rand() * 0.2);
        n.set((rand() - 0.5) * 0.5, 0.25, 1).normalize();
        centre.set(x, y, -0.4);
        return;
      }
    }
  };
  const area = formArea(f);
  const size = f.leaf * (detail > 1 ? 1 : detail > 0 ? 1.12 : 1.3);
  const count = Math.round(f.cover * area / (4 * size * size) * (detail > 1 ? 1 : detail > 0 ? 0.8 : 0.6));
  let reach = 0;
  const make = (total: number, s: number, inner: number): Card[] => {
    const out: Card[] = [];
    for (let i = 0; i < total; i++) {
      surface();
      // Most sprays sit at the skin; the rest fill the inside, darker the deeper they are.
      const sink = Math.pow(rand(), f.clipped ? 3.2 : 1.8) * inner;
      const q = p.clone().lerp(centre, sink);
      // Wild growth pokes out past the outline.
      if (!f.clipped && rand() < 0.18) q.addScaledVector(n, s * (0.3 + rand() * 0.5));
      const normal = n.clone().multiplyScalar(0.75).add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.5));
      normal.y += 0.15;
      out.push({ p: q, n: normal.normalize(), size: s * (0.8 + 0.45 * rand()), depth: Math.min(1, sink / Math.max(inner, 0.01)) * 0.9 });
      reach = Math.max(reach, Math.hypot(q.x, q.z) + s);
    }
    return out;
  };
  const near = make(count, size, f.clipped ? 0.35 : 0.6);
  const mid = make(Math.max(6, Math.round(count / 3.2)), size * 1.75, f.clipped ? 0.25 : 0.45);
  let top = 0;
  for (const card of near) top = Math.max(top, card.p.y + card.size);
  // A clipped yew stands on a short bare stem.
  if (kind === 'yew') wood.tube([new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, 0.5, 0)], [0.13, 0.11], 7);
  return { wood: wood.build(), leaves: cardGeometry(near), leavesMid: cardGeometry(mid), height: top, radius: reach, trunkRadius: 0, trunkHeight: 0 };
}

export function makeTree(kind: TreeKind, seed: number, detail: number): TreeModel {
  if (kind === 'cypress') return columnar(seed, detail);
  if (kind === 'pine') return conifer(seed, detail);
  const model = broadleaf(seed, kind === 'great', detail);
  if (kind === 'blossom') {
    for (const g of [model.wood, model.leaves, model.leavesMid]) g.scale(0.72, 0.72, 0.72);
    for (const g of [model.leaves, model.leavesMid]) {
      const card = g.attributes.aCard;
      for (let i = 0; i < card.count; i++) card.setX(i, card.getX(i) * 0.72);
    }
    model.height *= 0.72; model.radius *= 0.72; model.trunkRadius *= 0.72; model.trunkHeight *= 0.72;
  }
  return model;
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

/** A painted spray of foliage with a cut-out edge. Red carries the tone; alpha the outline. */
function spray(size: number, seed: number, paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size, seededRandom(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

function leafShape(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, wid: number, tone: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.85, -len * 0.8, 0, -len);
  ctx.bezierCurveTo(-wid * 0.85, -len * 0.8, -wid, -len * 0.25, 0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(-wid, 0, wid, -len);
  const v = (k: number): string => { const c = Math.max(0, Math.min(255, Math.round(tone * k))); return `rgb(${c},${c},${c})`; };
  g.addColorStop(0, v(0.62)); g.addColorStop(0.55, v(1)); g.addColorStop(1, v(1.16));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = v(1.3);
  ctx.lineWidth = Math.max(0.6, len * 0.035);
  ctx.beginPath(); ctx.moveTo(0, -len * 0.08); ctx.lineTo(0, -len * 0.9); ctx.stroke();
  ctx.restore();
}

/** Broad leaves on a handful of twigs, darker behind and lighter in front. */
const paintLeaves: Painter = (ctx, s, rand) => {
  for (let layer = 0; layer < 3; layer++) {
    const tone = 120 + layer * 44;
    for (let t = 0; t < 9; t++) {
      const a = rand() * Math.PI * 2, r = s * (0.05 + rand() * 0.2), tx = s / 2 + Math.cos(a) * r, ty = s / 2 + Math.sin(a) * r;
      const heading = a + (rand() - 0.5) * 1.2, twig = s * (0.14 + rand() * 0.12);
      for (let k = 0; k < 7; k++) {
        const u = k / 6, side = k % 2 ? 1 : -1;
        const x = tx + Math.cos(heading) * twig * u, y = ty + Math.sin(heading) * twig * u;
        leafShape(ctx, x, y, heading + Math.PI / 2 + side * (0.8 + rand() * 0.5), s * (0.085 + rand() * 0.035), s * (0.03 + rand() * 0.012), tone * (0.85 + rand() * 0.3));
      }
    }
  }
};

/** Close-clipped foliage: a dense round mat of tiny leaves with a ragged edge. */
const paintFine: Painter = (ctx, s, rand) => {
  for (let layer = 0; layer < 4; layer++) {
    const count = 260 + layer * 60;
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2, r = s * 0.4 * Math.sqrt(rand()) * (1 - layer * 0.08);
      const tone = (100 + layer * 38) * (0.8 + rand() * 0.35);
      leafShape(ctx, s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, rand() * Math.PI * 2, s * (0.04 + rand() * 0.02), s * (0.016 + rand() * 0.006), tone);
    }
  }
};

/** Petal colour is written with green at zero, so the shader can tell a petal from a leaf. */
const petal = (tone: number): string => `rgb(${Math.max(1, Math.min(255, Math.round(tone)))},0,0)`;
const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, angle: number, tone: number): void => {
  ctx.fillStyle = petal(tone);
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
};
/** A point on the card where flowers may sit: well inside the spray. */
const spot = (s: number, rand: () => number, reach = 0.33): [number, number] => {
  const a = rand() * Math.PI * 2, r = s * reach * Math.sqrt(rand());
  return [s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r];
};

const FLOWERS: Record<'rose' | 'briar' | 'hydrangea' | 'broom' | 'daisy' | 'petunia', Painter> = {
  /** Cupped garden roses: rings of petals tightening to a dark heart. */
  rose: (ctx, s, rand) => {
    for (let k = 0; k < 11; k++) {
      const [x, y] = spot(s, rand), r = s * (0.042 + rand() * 0.016), turn = rand() * 6;
      for (let ring = 0; ring < 3; ring++) {
        const petals = 6 - ring, rr = r * (1 - ring * 0.3);
        for (let i = 0; i < petals; i++) {
          const a = turn + ring * 0.6 + i / petals * Math.PI * 2;
          blob(ctx, x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55, rr * 0.62, rr * 0.5, a, 235 - ring * 40 + rand() * 15);
        }
      }
      blob(ctx, x, y, r * 0.2, r * 0.2, 0, 110);
    }
  },
  /** Flat five-petalled wild roses with a pale eye. */
  briar: (ctx, s, rand) => {
    for (let k = 0; k < 10; k++) {
      const [x, y] = spot(s, rand, 0.34), r = s * (0.05 + rand() * 0.014), turn = rand() * 6;
      for (let i = 0; i < 5; i++) {
        const a = turn + i / 5 * Math.PI * 2;
        blob(ctx, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.56, r * 0.5, a, 220 + rand() * 30);
      }
      blob(ctx, x, y, r * 0.24, r * 0.24, 0, 255);
    }
  },
  /** Round heads made of a great many small four-petalled florets. */
  hydrangea: (ctx, s, rand) => {
    for (let k = 0; k < 3; k++) {
      const [hx, hy] = spot(s, rand, 0.2), head = s * (0.12 + rand() * 0.04);
      for (let i = 0; i < 110; i++) {
        const a = rand() * Math.PI * 2, d = head * Math.sqrt(rand()), x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d;
        const r = s * 0.013, tone = 255 - (d / head) * 70 - rand() * 30, turn = rand() * 2;
        for (let p = 0; p < 4; p++) {
          const pa = turn + p * Math.PI / 2;
          blob(ctx, x + Math.cos(pa) * r * 0.7, y + Math.sin(pa) * r * 0.7, r * 0.75, r * 0.6, pa, tone);
        }
      }
    }
  },
  /** Little pea flowers in loose clusters among the green. */
  broom: (ctx, s, rand) => {
    for (let t = 0; t < 9; t++) {
      const [cx, cy] = spot(s, rand, 0.3), spread = s * (0.05 + rand() * 0.05);
      for (let k = 0; k < 22; k++) {
        const a = rand() * Math.PI * 2, d = spread * Math.sqrt(rand());
        blob(ctx, cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d, s * (0.014 + rand() * 0.008), s * (0.01 + rand() * 0.005), rand() * 3, 200 + rand() * 55);
      }
    }
  },
  /** A cottage border: daisies with dark eyes and a few spires of small flowers. */
  daisy: (ctx, s, rand) => {
    for (let k = 0; k < 4; k++) {
      const [x, y] = spot(s, rand, 0.25), heading = -Math.PI / 2 + (rand() - 0.5) * 0.8, len = s * (0.16 + rand() * 0.1);
      for (let i = 0; i < 14; i++) {
        const u = i / 13, r = s * 0.024 * (1.1 - u * 0.5);
        blob(ctx, x + Math.cos(heading) * len * u + (rand() - 0.5) * r, y + Math.sin(heading) * len * u, r, r * 0.8, rand() * 3, 200 + rand() * 50);
      }
    }
    for (let k = 0; k < 12; k++) {
      const [x, y] = spot(s, rand, 0.36), r = s * (0.048 + rand() * 0.016), petals = 12, turn = rand();
      for (let i = 0; i < petals; i++) {
        const a = turn + i / petals * Math.PI * 2;
        blob(ctx, x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58, r * 0.48, r * 0.17, a, 235 + rand() * 20);
      }
      blob(ctx, x, y, r * 0.26, r * 0.26, 0, 95);
    }
  },
  /** Trumpet flowers: five soft lobes shading to a deep throat. */
  petunia: (ctx, s, rand) => {
    for (let k = 0; k < 13; k++) {
      const [x, y] = spot(s, rand, 0.38), r = s * (0.036 + rand() * 0.012), turn = rand() * 6;
      for (let i = 0; i < 5; i++) {
        const a = turn + i / 5 * Math.PI * 2;
        blob(ctx, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.6, r * 0.55, a, 240);
      }
      blob(ctx, x, y, r * 0.45, r * 0.45, 0, 175);
      blob(ctx, x, y, r * 0.18, r * 0.18, 0, 95);
    }
  },
};
export type BloomPaint = keyof typeof FLOWERS;

/** Two sprays side by side: leaves alone on the left, the same leaves in flower on the right. */
function bloomSpray(size: number, seed: number, leaves: Painter, flowers: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let half = 0; half < 2; half++) {
    ctx.save();
    ctx.translate(half * size, 0);
    ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
    leaves(ctx, size, seededRandom(seed));
    if (half) flowers(ctx, size, seededRandom(seed + 1));
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}
export const bloomTexture = (paint: BloomPaint, fine = false): THREE.CanvasTexture =>
  bloomSpray(512, 90 + Object.keys(FLOWERS).indexOf(paint) * 3, fine ? paintFine : paintLeaves, FLOWERS[paint]);

/** Fans of needles along drooping twigs. */
function paintNeedles(ctx: CanvasRenderingContext2D, s: number, rand: () => number): void {
  ctx.lineCap = 'round';
  for (let layer = 0; layer < 3; layer++) {
    for (let t = 0; t < 30; t++) {
      const a = rand() * Math.PI * 2, r = s * rand() * 0.22, tx = s / 2 + Math.cos(a) * r, ty = s / 2 + Math.sin(a) * r;
      const heading = a + (rand() - 0.5) * 1.1, twig = s * (0.12 + rand() * 0.12);
      for (let k = 0; k < 46; k++) {
        const u = k / 45, x = tx + Math.cos(heading) * twig * u, y = ty + Math.sin(heading) * twig * u;
        const turn = heading + (k % 2 ? 1 : -1) * (0.6 + rand() * 0.4), len = s * (0.022 + rand() * 0.012) * (1.15 - u * 0.5);
        const c = Math.round((95 + layer * 55) * (0.8 + rand() * 0.4));
        ctx.strokeStyle = `rgb(${c},${c},${c})`;
        ctx.lineWidth = s * 0.0048;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(turn) * len, y + Math.sin(turn) * len); ctx.stroke();
      }
    }
  }
}

export const sprayTextures = {
  leaf: (): THREE.CanvasTexture => spray(512, 71, paintLeaves),
  fine: (): THREE.CanvasTexture => spray(512, 74, paintFine),
  /** Fans of needles along drooping twigs. */
  needle: (): THREE.CanvasTexture => spray(512, 72, paintNeedles),
  /** Clusters of small round petals with a few leaves among them. */
  blossom: (): THREE.CanvasTexture => spray(512, 73, (ctx, s, rand) => {
    for (let layer = 0; layer < 3; layer++) {
      for (let t = 0; t < 26; t++) {
        const a = rand() * Math.PI * 2, r = s * (0.03 + rand() * 0.3), x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
        const c = Math.round((150 + layer * 40) * (0.85 + rand() * 0.25));
        for (let p = 0; p < 5; p++) {
          const pa = p / 5 * Math.PI * 2 + a, pr = s * 0.022;
          ctx.fillStyle = `rgb(${c},${c},${c})`;
          ctx.beginPath(); ctx.arc(x + Math.cos(pa) * pr, y + Math.sin(pa) * pr, s * 0.021, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }),
};
