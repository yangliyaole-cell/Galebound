import * as THREE from 'three';
import { fbm, seededRandom } from './noise';
import { macroSlope } from './gen/macro';
import { nearestRiver } from './gen/hydro';
import { heightAt, normalAt, sstep } from './heightmap';
import {
  BLOSSOM, CITY, FIELDS, FOREST, HALF, PLATEAU, PLAZAS, ROADS, SIZE, START, STONES, VILLAGE, WINDMILL,
  WATCHTOWER, LIGHTHOUSE, ABBEY, cityWallPolygon, cityEdgeDistance, fieldPolygon, inPolygon, roadClearance, type Field,
} from './layout';

let splatSize = 0;
let splatData: Uint8ClampedArray = new Uint8ClampedArray(0);

/**
 * Paints roads (red), cobbles (green) and fields (blue) into one texture
 * covering the whole map. The terrain shader and placement code both read it.
 */
export function buildSplat(size: number): THREE.CanvasTexture {
  splatSize = size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const s = size / SIZE;
  const px = (v: number): number => (v + HALF) * s;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Inside the walls the ground is trodden earth and worn setts, with a few
  // gardens left green between the houses.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  cityWallPolygon.forEach(([x, z], i) => i ? ctx.lineTo(px(x), px(z)) : ctx.moveTo(px(x), px(z)));
  ctx.closePath(); ctx.clip();
  ctx.fillStyle = 'rgb(150,140,0)';
  ctx.fillRect(0, 0, size, size);
  const rand = seededRandom(208);
  for (let i = 0; i < 160; i++) {
    const x = CITY.x + (rand() - 0.5) * 600, z = CITY.z + (rand() - 0.5) * 600, r = 4 + rand() * 7;
    const g = ctx.createRadialGradient(px(x), px(z), 0, px(x), px(z), r * s);
    g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.7, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(px(x - r), px(z - r), r * 2 * s, r * 2 * s);
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgb(0,255,0)';
  for (const [x, z, r] of PLAZAS) {
    ctx.beginPath();
    ctx.arc(px(x), px(z), r * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Blue carries each parcel's furrow direction, as a fraction of a half turn.
  for (const f of FIELDS) {
    const turn = ((f.rot % Math.PI) + Math.PI) % Math.PI;
    ctx.fillStyle = `rgb(0,0,${Math.round(turn / Math.PI * 255)})`;
    ctx.beginPath();
    fieldPolygon(f).forEach(([x, z], i) => i ? ctx.lineTo(px(x), px(z)) : ctx.moveTo(px(x), px(z)));
    ctx.closePath();
    ctx.fill();
  }

  for (const road of ROADS) {
    ctx.strokeStyle = road.kind === 'dirt' ? 'rgb(255,0,0)' : 'rgb(0,255,0)';
    for (let i = 0; i < road.pts.length - 1; i++) {
      ctx.lineWidth = Math.max(1.3, (road.widths[i] + road.widths[i + 1]) * 0.5 * s);
      ctx.beginPath();
      ctx.moveTo(px(road.pts[i][0]), px(road.pts[i][1]));
      ctx.lineTo(px(road.pts[i + 1][0]), px(road.pts[i + 1][1]));
      ctx.stroke();
    }
  }

  splatData = ctx.getImageData(0, 0, size, size).data;
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export const CROP_COLORS: Record<Field['crop'], number> = { wheat: 0xd6be5e, tilled: 0x9a7556, cabbage: 0x6fa857, lavender: 0x9a86b8, hay: 0xb7c95c };
/** Crop colour of every parcel, with the parcel outline in alpha. */
export function buildFields(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = size / SIZE;
  const px = (v: number): number => (v + HALF) * s;
  for (const f of FIELDS) {
    ctx.fillStyle = `#${CROP_COLORS[f.crop].toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    fieldPolygon(f).forEach(([x, z], i) => i ? ctx.lineTo(px(x), px(z)) : ctx.moveTo(px(x), px(z)));
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function splat(x: number, z: number, channel: number): number {
  const s = splatSize / SIZE;
  const i = Math.min(splatSize - 1, Math.max(0, Math.round((x + HALF) * s)));
  const j = Math.min(splatSize - 1, Math.max(0, Math.round((z + HALF) * s)));
  return splatData[(j * splatSize + i) * 4 + channel] / 255;
}
export const roadAt = (x: number, z: number): number => splatSize ? splat(x, z, 0) : 1 - sstep(-0.7, 1, roadClearance(x, z, 'dirt'));
export const cobbleAt = (x: number, z: number): number => splatSize ? splat(x, z, 1) : Math.max(
  1 - sstep(-0.7, 1, roadClearance(x, z, 'cobble')),
  ...PLAZAS.map(([px, pz, r]) => 1 - sstep(r - 1, r + 1, Math.hypot(x - px, z - pz))));
let fieldCells: Map<number, Field[]> | null = null;
export function fieldAt(x: number, z: number): number {
  // Indexed on first use, after the land has had its say about which parcels survive.
  if (!fieldCells) {
    fieldCells = new Map();
    for (const f of FIELDS) {
      const key = Math.floor(f.x / 96) * 4096 + Math.floor(f.z / 96);
      fieldCells.set(key, [...(fieldCells.get(key) ?? []), f]);
    }
  }
  const ix = Math.floor(x / 96), iz = Math.floor(z / 96);
  for (let j = iz - 1; j <= iz + 1; j++) for (let i = ix - 1; i <= ix + 1; i++) {
    for (const f of fieldCells.get(i * 4096 + j) ?? []) if (inPolygon(x, z, fieldPolygon(f))) return 1;
  }
  return 0;
}

const dist = (x: number, z: number, p: { x: number; z: number }): number => Math.hypot(x - p.x, z - p.z);

export function blossomDensity(x: number, z: number): number {
  return 1 - sstep(0.45, 1.0, dist(x, z, BLOSSOM) / BLOSSOM.r);
}

/** 0..1 chance of a tree at this spot. */
export function forestDensity(x: number, z: number): number {
  const h = heightAt(x, z);
  if (h < 2.5) return 0;
  const slope = macroSlope(x, z);
  // Woods keep to slopes and hilltops that the plough leaves alone; the valley floor is farmed.
  // Woods come in stands with clear edges: inside a stand the canopy closes, outside it is open pasture.
  // Steep ground that cannot be grazed is more often wooded.
  const stand = fbm(x / 230 + 40, z / 230 - 13, 4) + 0.18 * (fbm(x / 55 + 3, z / 55 + 7, 2) - 0.5) + Math.min(slope, 0.5) * 0.55;
  let d = sstep(0.55, 0.6, stand) * (0.86 + 0.14 * fbm(x / 20, z / 20, 2));
  const wood = dist(x, z, FOREST) / FOREST.r + (fbm(x / 60, z / 60, 2) - 0.5) * 0.3;
  d = Math.max(d, 1 - sstep(0.72, 1.0, wood));
  // Alders and willows follow the water; copses stand along the lanes.
  const river = nearestRiver(x, z, 60);
  if (river.found) d = Math.max(d, 0.5 * sstep(river.width * 0.5 + 26, river.width * 0.5 + 6, river.distance) * sstep(0.35, 0.6, fbm(x / 38, z / 38, 2)));
  d = Math.max(d, 0.34 * sstep(16, 5, roadClearance(x, z, 'dirt')) * sstep(0.56, 0.7, fbm(x / 30 + 5, z / 30, 2)));
  d *= sstep(8, 70, cityEdgeDistance(x, z));
  d *= sstep(52, 95, dist(x, z, ABBEY));
  // Keep the first view of the city clear of random trees.
  if (z < START.z && z > START.z - 420 && Math.abs(x - START.x - (CITY.x - START.x) * (START.z - z) / (START.z - CITY.z)) < 34) d = 0;
  d *= 0.08 + 0.92 * sstep(VILLAGE.r * 0.55, VILLAGE.r, dist(x, z, VILLAGE));
  d *= sstep(26, 70, dist(x, z, START));
  d *= sstep(28, 70, dist(x, z, WINDMILL));
  d *= sstep(20, 50, dist(x, z, WATCHTOWER));
  d *= sstep(20, 50, dist(x, z, LIGHTHOUSE));
  d *= sstep(30, 60, dist(x, z, STONES));
  d *= sstep(0.75, 1.1, dist(x, z, BLOSSOM) / BLOSSOM.r);
  d *= 1 - fieldAt(x, z);
  d *= 1 - sstep(520, 760, h);
  return d;
}

export function flowerDensity(x: number, z: number): number {
  let d = sstep(0.54, 0.74, fbm(x / 60 + 11, z / 60 + 5, 3));
  d = Math.max(d, 1 - sstep(0.5, 1.1, dist(x, z, BLOSSOM) / BLOSSOM.r));
  d = Math.max(d, 0.8 * (1 - sstep(20, 75, dist(x, z, START))));
  return d;
}

export function dryness(x: number, z: number): number {
  const pd = Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz);
  let d = 0.75 * (1 - sstep(0.6, 1.0, pd));
  d = Math.max(d, sstep(0.58, 0.8, fbm(x / 300 - 4, z / 300 + 9, 2)) * 0.6);
  d = Math.max(d, sstep(190, 420, heightAt(x, z)) * 0.8);
  return d;
}

/** Low-resolution map of forest (R), flowers (G), dryness (B) and flatness (A). */
export function buildBiome(): THREE.DataTexture {
  const size = 512;
  const bytes = new Uint8Array(size * size * 4);
  const normal = new THREE.Vector3();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * SIZE - HALF;
      const z = ((j + 0.5) / size) * SIZE - HALF;
      const o = (j * size + i) * 4;
      bytes[o] = forestDensity(x, z) * 255;
      bytes[o + 1] = flowerDensity(x, z) * 255;
      bytes[o + 2] = dryness(x, z) * 255;
      bytes[o + 3] = normalAt(x, z, normal).y * 255;
    }
  }
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
