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
