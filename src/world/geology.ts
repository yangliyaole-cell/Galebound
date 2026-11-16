import * as THREE from 'three';
import { fbm } from './noise';
import { coastZ } from './gen/hydro';
import { heightAt, sstep } from './heightmap';
import { ABBEY, CITY, CITY_MAX_RADIUS, HALF, LIGHTHOUSE, PLATEAU, SCARP, SIZE } from './layout';

/**
 * Which rock the land is made of, region by region. Each place that shows bare rock has its own
 * stone, as a real country does: the crag under Hightown is pale jointed limestone, the scarp
 * the abbey stands on is granite, the coast is columnar basalt and the Standing Stones' mesa is
 * bedded red sandstone. High ground anywhere is schist (worked out in the shader from height),
 * and whatever is left is a grey-brown gritstone.
 */
export const ROCK_KINDS = ['limestone', 'granite', 'basalt', 'sandstone', 'schist', 'gritstone'] as const;
export type RockKind = (typeof ROCK_KINDS)[number];

/** Weights of the four regional rocks at a point; gritstone or schist make up the rest. */
export function geologyAt(x: number, z: number): [number, number, number, number] {
  const jitter = (fbm(x / 260 + 5.1, z / 260 - 2.7, 3) - 0.5) * 140;
  const lime = 1 - sstep(CITY_MAX_RADIUS + 60, CITY_MAX_RADIUS + 240, Math.hypot(x - CITY.x, z - CITY.z) + jitter);
  // The scarp's upland side, and everything round the abbey.
  const sd = (x - SCARP.x) * SCARP.ux + (z - SCARP.z) * SCARP.uz;
  const granite = Math.max(sstep(160, -60, sd + jitter), 1 - sstep(650, 1000, Math.hypot(x - ABBEY.x, z - ABBEY.z) + jitter));
  const sea = z - coastZ(x);
  const coast = sstep(-260, -110, sea + jitter * 0.6) * (1 - sstep(70, 130, heightAt(x, z)));
  const basalt = Math.max(coast, 1 - sstep(220, 360, Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) + jitter));
  const pd = Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz) + jitter / 400;
  const sand = 1 - sstep(1.15, 1.7, pd);
  const w: [number, number, number, number] = [lime, granite, basalt, sand];
  const sum = w[0] + w[1] + w[2] + w[3];
  if (sum > 1) for (let i = 0; i < 4; i++) w[i] /= sum;
  return w;
}

/** Limestone (R), granite (G), basalt (B), sandstone (A) over the playable map. */
export function buildGeology(): THREE.DataTexture {
  const size = 256;
  const bytes = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * SIZE - HALF;
      const z = ((j + 0.5) / size) * SIZE - HALF;
      const w = geologyAt(x, z), o = (j * size + i) * 4;
      for (let c = 0; c < 4; c++) bytes[o + c] = Math.round(w[c] * 255);
    }
  }
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
