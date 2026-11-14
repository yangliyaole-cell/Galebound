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
      this.idx.push(a, c, b, b, c, d);
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
  const pos: number[] = [], nor: number[] = [], corner: number[] = [], data: number[] = [], idx: number[] = [];
  cards.forEach((c, i) => {
    const seed = (Math.sin(i * 91.7 + c.p.x * 13.1) * 43758.5453) % 1;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(c.p.x, c.p.y, c.p.z);
      nor.push(c.n.x, c.n.y, c.n.z);
      corner.push(cx, cy);
      data.push(c.size, Math.abs(seed), c.depth);
    }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(data, 3));
  g.setIndex(idx);
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

export const sprayTextures = {
  /** Broad leaves on a handful of twigs, darker behind and lighter in front. */
  leaf: (): THREE.CanvasTexture => spray(512, 71, (ctx, s, rand) => {
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
  }),
  /** Fans of needles along drooping twigs. */
  needle: (): THREE.CanvasTexture => spray(512, 72, (ctx, s, rand) => {
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
  }),
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
