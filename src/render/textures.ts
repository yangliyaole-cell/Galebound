import * as THREE from 'three';
import { seededRandom } from '../world/noise';

/**
 * Tiling textures painted on a canvas at load time. They are kept near white
 * so each building can tint them through its vertex colours.
 */
function make(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const grey = (v: number, warm = 0): string =>
  `rgb(${Math.round(Math.min(255, v + warm))},${Math.round(Math.min(255, v))},${Math.round(Math.max(0, v - warm))})`;

function speckle(ctx: CanvasRenderingContext2D, s: number, rand: () => number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha * rand()})` : `rgba(255,255,255,${alpha * rand()})`;
    const r = 1 + rand() * 3;
    ctx.fillRect(rand() * s, rand() * s, r, r);
  }
}

/** Courses of cut stone, every other course offset by half a block. */
export const stoneTexture = (): THREE.CanvasTexture =>
  make(256, (ctx, s) => {
    const rand = seededRandom(21);
    ctx.fillStyle = grey(150, 6);
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const blocks = r % 2 ? 3 : 2;
      const bw = s / blocks;
      const offset = r % 2 ? bw * 0.35 : 0;
      for (let b = -1; b <= blocks; b++) {
        const v = 208 + rand() * 40;
        ctx.fillStyle = grey(v, 4 + rand() * 8);
        const x = b * bw + offset + 2;
        ctx.beginPath();
        ctx.roundRect(x, r * rh + 2, bw - 4, rh - 4, 5);
        ctx.fill();
        // Light catches the top edge, shade gathers at the bottom.
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x + 3, r * rh + 3, bw - 10, 3);
        ctx.fillStyle = 'rgba(60,60,80,0.16)';
        ctx.fillRect(x + 3, (r + 1) * rh - 8, bw - 10, 4);
      }
    }
    speckle(ctx, s, rand, 500, 0.08);
  });

/** Lime plaster: almost flat, with faint blotches and a few hairline cracks. */
export const plasterTexture = (): THREE.CanvasTexture =>
  make(256, (ctx, s) => {
    const rand = seededRandom(22);
    ctx.fillStyle = grey(244, 2);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(rand() * s, rand() * s, 0, rand() * s, rand() * s, 30 + rand() * 60);
      g.addColorStop(0, `rgba(${rand() < 0.5 ? '170,150,120' : '255,255,255'},0.07)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    speckle(ctx, s, rand, 300, 0.05);
    ctx.strokeStyle = 'rgba(120,105,90,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = rand() * s;
      let y = rand() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rand() - 0.5) * 26;
        y += rand() * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

/** Overlapping rows of rounded clay tiles. */
export const roofTexture = (): THREE.CanvasTexture =>
  make(256, (ctx, s) => {
    const rand = seededRandom(23);
    ctx.fillStyle = grey(150);
    ctx.fillRect(0, 0, s, s);
    const rows = 6;
    const cols = 6;
    const rh = s / rows;
    const cw = s / cols;
    // Draw from the top down so each row overlaps the one above.
    for (let r = -1; r <= rows; r++) {
      const y = s - (r + 1) * rh;
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + (r % 2 ? cw / 2 : 0);
        const v = 205 + rand() * 50;
        ctx.fillStyle = grey(v);
        ctx.beginPath();
        ctx.moveTo(x + 1, y - 2);
        ctx.lineTo(x + cw - 1, y - 2);
        ctx.lineTo(x + cw - 1, y + rh * 0.55);
        ctx.quadraticCurveTo(x + cw / 2, y + rh * 1.2, x + 1, y + rh * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,30,30,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x + cw * 0.3, y + 2, cw * 0.14, rh * 0.55);
      }
    }
  });

/** Upright planks with grain. */
export const woodTexture = (): THREE.CanvasTexture =>
  make(256, (ctx, s) => {
    const rand = seededRandom(24);
    const planks = 5;
    const pw = s / planks;
    for (let p = 0; p < planks; p++) {
      const v = 200 + rand() * 45;
      ctx.fillStyle = grey(v, 3);
      ctx.fillRect(p * pw, 0, pw, s);
      ctx.strokeStyle = 'rgba(60,40,25,0.16)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 7; g++) {
        const x = p * pw + 3 + rand() * (pw - 6);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + 4, s * 0.3, x - 4, s * 0.7, x, s);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,20,10,0.4)';
      ctx.fillRect(p * pw, 0, 2, s);
    }
  });

// ---------------------------------------------------------------------------
// Painted cut-outs: foliage and grass. Brightness is stored in the colour
// channels and the silhouette in alpha, so the edges never pick up a dark rim.

type Painter = (ctx: CanvasRenderingContext2D, mask: boolean) => void;

function cutout(size: number, background: number, paint: Painter): THREE.DataTexture {
  const layer = (mask: boolean): Uint8ClampedArray => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = mask ? '#000' : grey(background);
    ctx.fillRect(0, 0, size, size);
    paint(ctx, mask);
    return ctx.getImageData(0, 0, size, size).data;
  };
  const colour = layer(false);
  const mask = layer(true);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Canvas rows run downward; texture rows run upward.
    const src = (size - 1 - y) * size * 4;
    const dst = y * size * 4;
    for (let x = 0; x < size * 4; x += 4) {
      data[dst + x] = colour[src + x];
      data[dst + x + 1] = colour[src + x + 1];
      data[dst + x + 2] = colour[src + x + 2];
      data[dst + x + 3] = mask[src + x];
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, wid: number, v: number, mask: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.85, -len * 0.8, 0, -len);
  ctx.bezierCurveTo(-wid * 0.85, -len * 0.8, -wid, -len * 0.25, 0, 0);
  ctx.closePath();
  if (mask) {
    ctx.fillStyle = '#fff';
    ctx.fill();
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, grey(v * 0.72));
    g.addColorStop(1, grey(Math.min(255, v * 1.08)));
    ctx.fillStyle = g;
    ctx.strokeStyle = grey(v * 0.8);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    // Midrib, and a lit edge on one side.
    ctx.strokeStyle = `rgba(0,0,0,0.16)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -len * 0.92);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(wid * 0.35, -len * 0.2);
    ctx.quadraticCurveTo(wid * 0.75, -len * 0.55, wid * 0.2, -len * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

/** A spray of broad leaves, dark ones behind and light ones in front. */
export const leafTexture = (seed = 41): THREE.DataTexture =>
  cutout(256, 150, (ctx, mask) => {
    const rand = seededRandom(seed);
    const n = 46;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 84;
      const x = 128 + Math.cos(a) * r;
      const y = 134 + Math.sin(a) * r * 0.92;
      // Leaves point outward from the middle, and droop a little.
      const out = Math.atan2(Math.cos(a), -Math.sin(a)) + (rand() - 0.5) * 1.3;
      const len = 42 + rand() * 24;
      const v = 120 + (i / n) * 110 + rand() * 25;
      leaf(ctx, x, y, out, len, len * (0.3 + rand() * 0.1), v, mask);
    }
  });

/** Clusters of five-petalled flowers with a few leaves between them. */
export const blossomTexture = (): THREE.DataTexture =>
  cutout(256, 205, (ctx, mask) => {
    const rand = seededRandom(43);
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 88;
      leaf(ctx, 128 + Math.cos(a) * r, 132 + Math.sin(a) * r, rand() * 6.28, 34 + rand() * 14, 11, 105 + rand() * 30, mask);
    }
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 92;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r;
      const size = 9 + rand() * 6;
      const turn = rand() * 6.28;
      const v = 205 + rand() * 50;
      for (let p = 0; p < 5; p++) {
        const pa = turn + (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(pa) * size * 0.75, y + Math.sin(pa) * size * 0.75, size * 0.72, size * 0.5, pa, 0, Math.PI * 2);
        ctx.fillStyle = mask ? '#fff' : grey(v);
        ctx.fill();
      }
      if (!mask) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = grey(150);
        ctx.fill();
      }
    }
  });

/** Sprays of conifer needles along drooping twigs. */
export const needleTexture = (): THREE.DataTexture =>
  cutout(256, 140, (ctx, mask) => {
    const rand = seededRandom(44);
    ctx.lineCap = 'round';
    for (let t = 0; t < 9; t++) {
      const a0 = -Math.PI / 2 + (t - 4) * 0.42 + (rand() - 0.5) * 0.2;
      const len = 92 + rand() * 26;
      const v = 125 + t * 9 + rand() * 40;
      for (let k = 0; k < 15; k++) {
        const f = (k + 1) / 15;
        // Twigs fan out from low centre and sag toward their tips.
        const x = 128 + Math.cos(a0) * len * f;
        const y = 196 + Math.sin(a0) * len * f + f * f * 26;
        for (const side of [1, -1]) {
          const na = a0 + side * (0.9 - f * 0.3) + f * 0.3;
          ctx.strokeStyle = mask ? '#fff' : grey(v + f * 55);
          ctx.lineWidth = mask ? 5.5 : 7;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(na) * 21 * (1.15 - f * 0.5), y + Math.sin(na) * 21 * (1.15 - f * 0.5));
          ctx.stroke();
        }
      }
    }
  });

/** A tuft of grass: curved blades of mixed height, dark at the root, pale at the tip. */
export const grassTexture = (): THREE.DataTexture =>
  cutout(256, 170, (ctx, mask) => {
    const rand = seededRandom(45);
    if (!mask) {
      const g = ctx.createLinearGradient(0, 256, 0, 0);
      g.addColorStop(0, grey(105));
      g.addColorStop(1, grey(240));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    const blades = 19;
    for (let i = 0; i < blades; i++) {
      const bx = 128 + (rand() - 0.5) * 190;
      const h = 110 + rand() * 140;
      const lean = (bx - 128) * 0.28 + (rand() - 0.5) * 70;
      const w = 7 + rand() * 6;
      const front = i / blades;
      ctx.beginPath();
      ctx.moveTo(bx - w, 258);
      ctx.quadraticCurveTo(bx - w * 0.6 + lean * 0.3, 256 - h * 0.6, bx + lean, 256 - h);
      ctx.quadraticCurveTo(bx + w * 0.8 + lean * 0.35, 256 - h * 0.55, bx + w, 258);
      ctx.closePath();
      if (mask) {
        ctx.fillStyle = '#fff';
      } else {
        const g = ctx.createLinearGradient(0, 256, 0, 256 - h);
        const lift = 0.8 + front * 0.3;
        g.addColorStop(0, grey(92 * lift));
        g.addColorStop(0.55, grey(175 * lift));
        g.addColorStop(1, grey(Math.min(255, 245 * lift)));
        ctx.fillStyle = g;
        ctx.strokeStyle = 'rgba(40,50,30,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fill();
    }
  });

/**
 * Brushwork for the ground, one kind per channel, all tiling:
 * red is short dabs for turf, green is pebbles for paths, blue is cracked rock.
 */
export function groundDetailTexture(): THREE.CanvasTexture {
  const size = 512;
  const channel = (paint: (ctx: CanvasRenderingContext2D) => void): Uint8ClampedArray => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = grey(128);
    ctx.fillRect(0, 0, size, size);
    paint(ctx);
    return ctx.getImageData(0, 0, size, size).data;
  };
  // Draw at all four wrapped positions so the texture repeats without a seam.
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void): void => {
    for (const ox of [0, -size]) for (const oy of [0, -size]) draw(x + ox, y + oy);
  };
  const dabs = channel((ctx) => {
    const rand = seededRandom(61);
    for (let i = 0; i < 2600; i++) {
      const light = rand() < 0.5;
      const len = 7 + rand() * 20;
      const wid = 2 + rand() * 4.5;
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.1;
      ctx.fillStyle = light ? `rgba(255,255,255,${0.1 + rand() * 0.22})` : `rgba(0,0,0,${0.08 + rand() * 0.2})`;
      wrapped(rand() * size, rand() * size, (x, y) => {
        ctx.beginPath();
        ctx.ellipse(x, y, len, wid, a, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  const pebbles = channel((ctx) => {
    const rand = seededRandom(62);
    for (let i = 0; i < 900; i++) {
      const r = 2 + rand() * rand() * 13;
      const v = 95 + rand() * 130;
      const squash = 0.6 + rand() * 0.4;
      const turn = rand() * 3.14;
      wrapped(rand() * size, rand() * size, (x, y) => {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(x + 1.5, y + 2, r, r * squash, turn, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = grey(v);
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * squash, turn, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * squash * 0.4, turn, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  const rock = channel((ctx) => {
    const rand = seededRandom(63);
    // Flat facets of light and shade, then dark cracks across them.
    for (let i = 0; i < 260; i++) {
      const v = rand() < 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.06 + rand() * 0.16})`;
      const n = 4 + Math.floor(rand() * 3);
      const r = 18 + rand() * 60;
      const turn = rand() * 6.28;
      const stretch = 0.35 + rand() * 0.5;
      wrapped(rand() * size, rand() * size, (x, y) => {
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const a = turn + (k / n) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r * stretch;
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      });
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const steps = 3 + Math.floor(rand() * 4);
      const pts: [number, number][] = [[0, 0]];
      for (let k = 0; k < steps; k++) pts.push([pts[k][0] + (rand() - 0.3) * 46, pts[k][1] + (rand() - 0.5) * 30]);
      ctx.strokeStyle = `rgba(0,0,0,${0.25 + rand() * 0.3})`;
      ctx.lineWidth = 1 + rand() * 2;
      wrapped(rand() * size, rand() * size, (x, y) => {
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
        ctx.stroke();
      });
    }
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size * 4; i += 4) {
    image.data[i] = dabs[i];
    image.data[i + 1] = pebbles[i];
    image.data[i + 2] = rock[i];
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
