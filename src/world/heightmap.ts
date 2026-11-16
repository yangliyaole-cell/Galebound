import * as THREE from 'three';
import { clamp, lerp, ridged, sfbm, smax, sstep } from './gen/noise';
import { buildMacro, macroHeight, macroSlope } from './gen/macro';
import { LAKES, channelDepth, lakeShape, nearestRiver, waterSurfaceAt } from './gen/hydro';
import { GORGE, PLUNGE, VIADUCT, ABBEY, CITY, CITY_MAX_RADIUS, CITY_STREETS, EAST_GATE_ANGLE, FIELDS, HALF, ISLAND, LAKE, ROADS, SIZE, SOUTH_GATE_ANGLE, START, cityRadiusAt, insideCity } from './layout';
import { cityBase, cityGround } from './city-plan';
import { shelfWeight } from './abbey-plan';

export { clamp, lerp, sstep };

const angleBetween = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * The walkable land at full detail: the eroded landscape, plus everything too
 * small for the coarse grid to hold. River channels, lake beds, the city's crag
 * and terraces, and the abbey's shelf are cut here.
 */
function detailHeight(x: number, z: number): number {
  let h = macroHeight(x, z);
  // Detail fades out at the rim so this grid meets the coarse landscape beyond it.
  const rim = sstep(0, 160, Math.min(HALF - Math.abs(x), HALF - Math.abs(z)));
  const rough = sstep(0.22, 0.7, macroSlope(x, z));
  h += rim * ((1.3 + 5 * rough) * sfbm(x / 96 + 7.3, z / 96 - 2.9, 3) + (0.32 + 1.5 * rough) * sfbm(x / 23 + 1.7, z / 23 + 8.8, 3)
    + rough * 10 * (ridged(x / 150 + 4.1, z / 150 + 0.3, 3) - 0.45));

  // The city: castle crown, the town's slope with its streets cut in, then a crag falling to the vale.
  const r = Math.hypot(x - CITY.x, z - CITY.z);
  if (r < CITY_MAX_RADIUS + 260) {
    const a = Math.atan2(z - CITY.z, x - CITY.x);
    const edge = cityRadiusAt(a), out = r - edge;
    if (out > 0) {
      const shelf = cityBase(CITY.x + Math.cos(a) * edge, CITY.z + Math.sin(a) * edge);
      // Broad spurs carry the gate roads up; elsewhere the rock breaks away in a face and a scree apron.
      const gate = 1 - sstep(0.1, 0.42, Math.min(angleBetween(a, SOUTH_GATE_ANGLE), angleBetween(a, EAST_GATE_ANGLE)));
      const jag = sfbm(x / 36 + 3, z / 36 - 5, 3);
      const face = (22 + 12 * sfbm(a * 2.1 + 4, 1.7, 2)) * sstep(1.5, 20 + 9 * jag, out);
      const crag = shelf - face - 0.42 * Math.max(0, out - 16) * (1 + 0.25 * jag);
      const spur = shelf - 0.13 * out - 4 * sstep(0, 70, out) + 1.5 * jag;
      h = smax(h, lerp(crag, spur, gate), 6);
    } else h = cityGround(x, z);
  }

  // The abbey's shelf on the scarp top.
  if (Math.abs(x - ABBEY.x) < 160 && Math.abs(z - ABBEY.z) < 160) {
    const shelf = shelfWeight(x - ABBEY.x, z - ABBEY.z);
    if (shelf > 0) h = lerp(h, ABBEY.floor, shelf);
  }

  h = gorgeCut(x, z, h);
  // Under the viaduct the ground stands clear of the deck, and its far end meets a level pad.
  if (x < VIADUCT.ax + 12 && x > VIADUCT.bx - 14 && z > VIADUCT.az - 12 && z < VIADUCT.bz + 14) {
    const dx = VIADUCT.bx - VIADUCT.ax, dz = VIADUCT.bz - VIADUCT.az;
    const t = clamp(((x - VIADUCT.ax) * dx + (z - VIADUCT.az) * dz) / (dx * dx + dz * dz), 0, 0.985);
    const d = Math.hypot(x - VIADUCT.ax - dx * t, z - VIADUCT.az - dz * t) - VIADUCT.width / 2;
    if (d < 3) h = Math.min(h, lerp(ABBEY.floor - 1.6, h, sstep(0.4, 3, d)));
    const pad = Math.hypot(x - VIADUCT.bx - dx / 172 * 5, z - VIADUCT.bz - dz / 172 * 5);
    h = lerp(ABBEY.floor + 0.02, h, sstep(3.6, 11, pad));
  }

  // River channels: a bed below the surface, a low bank, then the valley floor.
  const river = nearestRiver(x, z, 170);
  let riverNear = false;
  if (river.found && rim > 0.02) {
    // The channel is cut at least as wide as the water drawn over it, and never narrower than the grid can hold.
    const half = Math.max(river.width * 0.5 + 0.9, cell * 1.1), d = river.distance;
    if (river.fall) {
      // The fall has cut a recess back into the cliff, rounded at its sides.
      const recess = half + 5;
      if (d < recess + 8) h = lerp(Math.min(h, river.level - 0.8), h, sstep(recess, recess + 8, d));
    } else {
      const channel = d < half ? river.level - channelDepth(half * 2, d)
        : river.level + 0.25 + 0.75 * sstep(half, half + 4.5, d) + (d - half) * 0.022;
      const end = half + Math.min(120, Math.max(22, river.floor * 0.45));
      // Beyond the bank the ground is the land's own, lifted clear of the water where it dips.
      const natural = h + Math.max(0, river.level + 0.9 + (d - half) * 0.015 - h) * sstep(end + 30, end, d);
      h = lerp(h, lerp(channel, natural, sstep(half + 3, end, d)), rim);
      riverNear = d < half + 4;
    }
  }
  for (const l of LAKES) {
    if (Math.abs(x - l.x) > l.rx * 1.9 || Math.abs(z - l.z) > l.rz * 1.9) continue;
    const s = lakeShape(l, x, z);
    if (s < 1) h = l.level - 0.25 - l.depth * Math.pow(1 - s * s, 0.8);
    else if (s < 1.6) {
      const shore = lerp(l.level + 0.3 + (s - 1) * Math.min(l.rx, l.rz) * 0.1, Math.max(h, l.level + 0.8), sstep(1, 1.6, s));
      h = riverNear ? Math.min(h, shore) : shore;
    }
  }
  // A small wooded island in Mirror Lake carries the pavilion: a low dome with a shelving shore.
  const island = Math.hypot((x - ISLAND.x) / 1.15, z - ISLAND.z) + 3 * sfbm(x / 14, z / 14, 2);
  if (island < 40) h = Math.max(h, LAKE.level + 3.4 - 0.004 * island * island - 6 * sstep(20, 40, island));
  return h;
}

/**
 * The Cloudfall gorge and the amphitheatre of the great fall. A fall retreats upstream, leaving
 * a slot with stepped walls: a talus foot, a cliff in the hard bed, a bench where a softer bed
 * has weathered back, a second cliff, and a rounded brow. Gullies break the upper cliff; spurs
 * and alcoves alternate along it. The land is only ever lowered to this profile.
 */
function gorgeCut(x: number, z: number, h: number): number {
  if (x < -1800 || x > -1240 || z < -1580 || z > -1040) return h;
  let best = Infinity, along = 0, level = 0, run = 0;
  for (let i = 0; i < GORGE.length - 1; i++) {
    const a = GORGE[i], b = GORGE[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (len * len), 0, 1);
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) { best = d; along = run + t * len; level = lerp(a[2], b[2], t); }
    run += len;
  }
  const warp = 8 * sfbm(x / 64 + 3.1, z / 64 - 8.2, 3) + 3.2 * sfbm(x / 17 + 9.4, z / 17 + 2.2, 2) + 0.8 * sfbm(x / 5 + 1.2, z / 5 - 6.7, 2);
  const wall = (e: number, k: number, floor: number): number => {
    // Bed thicknesses and the gullies in the upper cliff change along the gorge.
    const n1 = sfbm(k / 70 + 4.4, 1.3, 2), n2 = sfbm(k / 46 + 9.7, 5.1, 2), gully = sstep(0.12, 0.5, sfbm(k / 21 + 2.2, 8.8, 2));
    const talus = 7 + 2 * n1, lower = 16 + 4 * n2, bench = 3.4, upper = 18 - 4 * n2 + 3 * n1;
    const p = talus * Math.pow(clamp(e / 9, 0, 1), 1.3)
      + lower * sstep(9, 12 + 1.5 * gully, e)
      + bench * clamp((e - 12) / 11, 0, 1)
      + upper * sstep(23 - 3 * gully, 26.5 + 7 * gully, e)
      + 0.5 * Math.max(0, e - 27);
    return floor + 0.5 + p + (e < 9 ? 0.9 * sfbm(x / 3.4, z / 3.4, 2) * clamp(e / 3 + 0.3, 0, 1) : 0);
  };
  if (best < 130) {
    const s = along / run;
    // Wide under the upper fall, where its spray has undercut the head; narrowest in mid-gorge.
    const floor = lerp(25, 14, sstep(0, 0.26, s)) + 4 * sstep(0.82, 1, s);
    h = Math.min(h, wall(best + warp - floor, along, level));
  }
  // The great fall's amphitheatre, open to the vale on its lower side.
  const r = Math.hypot(x - PLUNGE.x, z - PLUNGE.z);
  if (r < 150) {
    const a = Math.atan2(z - PLUNGE.z, x - PLUNGE.x);
    const e = r + warp * 0.8 - 36;
    const n2 = sfbm(a * 2.3 + 1.7, 3.3, 2), gully = sstep(0.1, 0.5, sfbm(a * 5.1 + 7, 1.1, 2));
    const p = 7 * Math.pow(clamp(e / 11, 0, 1), 1.3) + (30 + 6 * n2) * sstep(11, 14.5 + 2 * gully, e) + 4 * clamp((e - 14) / 9, 0, 1)
      + (30 - 6 * n2) * sstep(23 - 2 * gully, 27 + 6 * gully, e) + 1.5 * Math.max(0, e - 28);
    h = Math.min(h, PLUNGE.level + 0.8 + p + (e < 11 ? 1.1 * sfbm(x / 3.6, z / 3.6, 2) * clamp(e / 4 + 0.3, 0, 1) : 0));
  }
  return h;
}

let cell = 4;
let n = SIZE / cell;
let data = new Float32Array(0);

export function buildHeightmap(cellSize: number, onProgress?: (fraction: number) => void): void {
  cell = cellSize;
  n = SIZE / cell;
  const row = n + 1;
  buildMacro((f) => onProgress?.(f * 0.6));
  // The abbey stands on whatever shelf the scarp offers.
  ABBEY.floor = Math.round(macroHeight(ABBEY.x, ABBEY.z));
  ABBEY.tower = ABBEY.floor + 25;
  // Nobody ploughs a hillside: parcels drawn across steep or high ground are dropped.
  for (let i = FIELDS.length - 1; i >= 0; i--) {
    const f = FIELDS[i];
    if (f.scenic && (macroSlope(f.x, f.z) > 0.13 || macroHeight(f.x, f.z) > 170)) FIELDS.splice(i, 1);
  }
  data = new Float32Array(row * row);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      data[j * row + i] = detailHeight(i * cell - HALF, j * cell - HALF);
    }
  }
  gradeRoadbeds();
  onProgress?.(1);
}

/** Water surface over a point: sea, lake or river. -Infinity where the ground is dry. */
export function waterLevelAt(x: number, z: number): number {
  return waterSurfaceAt(x, z, heightAt(x, z));
}

/** Metres of bank per metre of cut or fill beside a road, and the widest bank allowed. */
const BANK_RUN = 4;
const BANK_MAX = 30;

/** Linear-time local earthwork: preserve each crest and ease approaches below a
 * 0.72 grade. Work only in narrow road corridors, never across an open water bed. */
function gradeRoadbeds(): void {
  const row = n + 1;
  const core = new Set<number>();
  for (const road of ROADS) {
    // Town streets are cut into the hill with the rest of the city (city-plan.ts).
    if (road.bridge || CITY_STREETS.includes(road)) continue;
    const heights = road.pts.map(([x, z]) => heightAt(x, z));
    for (let i = 1; i < heights.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      heights[i] = Math.max(heights[i], heights[i - 1] - 0.72 * Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    for (let i = heights.length - 2; i >= 0; i--) {
      const a = road.pts[i], b = road.pts[i + 1];
      heights[i] = Math.max(heights[i], heights[i + 1] - 0.72 * Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    // The roadbed is level out to `inner`; beyond it a bank eases back to the ground, as wide
    // as the cut or fill is deep (a road-cut a few metres deep in a 4 m ramp is a cliff, and the
    // grid draws it as a row of teeth). The bank always ends by `inner + BANK_MAX`.
    const grades = new Map<number, { d: number; target: number; inner: number }>();
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const inner = Math.max(road.widths[i], road.widths[i + 1]) / 2 + cell + 2;
      const reach = inner + BANK_MAX;
      const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach + HALF) / cell));
      const x1 = Math.min(n, Math.ceil((Math.max(a[0], b[0]) + reach + HALF) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach + HALF) / cell));
      const z1 = Math.min(n, Math.ceil((Math.max(a[1], b[1]) + reach + HALF) / cell));
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) {
        const x = k * cell - HALF, z = j * cell - HALF;
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        const o = j * row + k;
        if (d >= reach || data[o] < waterSurfaceAt(x, z, data[o]) + 0.3 || data[o] < 0.3 || Math.hypot(x - START.x, z - START.z) < 80 || insideCity(x, z)) continue;
        if (d < Math.max(road.widths[i], road.widths[i + 1]) / 2 + cell * 1.5) core.add(o);
        const target = heights[i] + (heights[i + 1] - heights[i]) * t;
        if (d < (grades.get(o)?.d ?? Infinity)) grades.set(o, { d, target, inner });
      }
    }
    for (const [o, g] of grades) {
      const bank = clamp(Math.abs(data[o] - g.target) * BANK_RUN, cell + 2, BANK_MAX);
      data[o] = lerp(data[o], g.target, 1 - sstep(g.inner, g.inner + bank, g.d));
    }
  }
  // At junctions two independently graded lanes must agree. A max-heap propagates
  // the minimum necessary embankment through the road-core grid (O(N log N)).
  const heap: [number, number][] = [];
  const push = (o: number, h: number): void => {
    let i = heap.length; heap.push([o, h]);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][1] >= h) break; heap[i] = heap[p]; i = p; }
    heap[i] = [o, h];
  };
  for (const o of core) push(o, data[o]);
  while (heap.length) {
    const [o, h] = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][1] > heap[c][1]) c++;
        if (heap[c][1] <= last[1]) break; heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    if (h < data[o] - 0.0001) continue;
    for (const q of [o - 1, o + 1, o - row, o + row]) {
      const target = h - cell * 0.52;
      if (core.has(q) && data[q] < target - 0.0001) { data[q] = target; push(q, data[q]); }
    }
  }

}

export function grid(): { cell: number; n: number; data: Float32Array } {
  return { cell, n, data };
}

/** Exact height of the terrain mesh, including its triangle split. */
export function heightAt(x: number, z: number): number {
  const gx = clamp((x + HALF) / cell, 0, n - 1e-4);
  const gz = clamp((z + HALF) / cell, 0, n - 1e-4);
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const row = n + 1;
  const o = j * row + i;
  const a = data[o];
  const b = data[o + 1];
  const c = data[o + row];
  const d = data[o + row + 1];
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

export function normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = cell * 0.6;
  return out
    .set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e))
    .normalize();
}

/**
 * Sample the height grid with the same triangle split as the terrain mesh and
 * heightAt(). Shaders must declare uHeight, uCell and uN.
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
  void terrainSample(vec2 xz, out float height, out vec3 normal) {
    vec2 g = clamp((xz + ${HALF.toFixed(1)}) / uCell, vec2(0.0), vec2(float(uN) - 1e-4));
    ivec2 i = ivec2(floor(g));
    vec2 f = g - vec2(i);
    float a = texelFetch(uHeight, i, 0).r;
    float b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
    float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r;
    float d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
    height = (f.x + f.y <= 1.0)
      ? a + (b - a) * f.x + (c - a) * f.y
      : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
    normal = normalize(f.x + f.y <= 1.0
      ? vec3(a - b, uCell, a - c)
      : vec3(c - d, uCell, b - d));
  }
  float terrainHeight(vec2 xz) {
    float height;
    vec3 normal;
    terrainSample(xz, height, normal);
    return height;
  }
  vec3 terrainNormal(vec2 xz) {
    float height;
    vec3 normal;
    terrainSample(xz, height, normal);
    return normal;
  }
`;

export function heightSamplingUniforms(heightTex: THREE.Texture): {
  uHeight: { value: THREE.Texture };
  uCell: { value: number };
  uN: { value: number };
} {
  return {
    uHeight: { value: heightTex },
    uCell: { value: cell },
    uN: { value: n },
  };
}

/** Height as a texture, so shaders can place grass and shade water depth. */
export function createHeightTexture(): THREE.DataTexture {
  const pixels = new Float32Array(data);
  const tex = new THREE.DataTexture(pixels, n + 1, n + 1, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
