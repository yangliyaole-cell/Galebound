import { clamp, lerp, snoise, sstep } from './noise';

/**
 * Surveyed water. The trunk river and its named tributaries are drawn first;
 * the land is then generated around them, and erosion grows every lesser
 * valley as a tributary of this network. All positions are metres, north is -Z.
 */
export interface RiverPoint {
  x: number; z: number;
  /** Water surface height. Never rises downstream. */
  level: number;
  /** Surface width. */
  width: number;
  /** Half-width of the flat valley floor beside the channel. */
  floor: number;
  /** How steeply the valley sides rise beyond the floor (rise / run near the floor). */
  wall: number;
  /** Distance along the river from its source. */
  s: number;
  /** Unit direction of flow. */
  dx: number; dz: number;
  /** True where the water is in free fall. */
  fall: boolean;
  prev: RiverPoint | null; next: RiverPoint | null;
}
export interface River { name: string; pts: RiverPoint[] }

/** [x, z, level, width, valley floor half-width, valley wall steepness, meander amplitude] */
type Control = [number, number, number, number, number, number, number];

export interface Lake {
  name: string; x: number; z: number; rx: number; rz: number; level: number; depth: number; seed: number;
}
export const LAKES: Lake[] = [
  { name: 'mirror', x: -600, z: -180, rx: 195, rz: 128, level: 60, depth: 9, seed: 0.6 },
  { name: 'tarn', x: -1790, z: -1615, rx: 120, rz: 74, level: 290, depth: 7, seed: 2.3 },
  { name: 'plunge', x: -1338, z: -1136, rx: 34, rz: 27, level: 150, depth: 5, seed: 4.1 },
];
/** 1 at the shore, below 1 inside. The outline is a lumpy ellipse. */
export function lakeShape(l: Lake, x: number, z: number): number {
  const dx = (x - l.x) / l.rx, dz = (z - l.z) / l.rz;
  const a = Math.atan2(dz, dx);
  const r = 1 + 0.11 * Math.sin(3 * a + l.seed) + 0.075 * Math.cos(5 * a - 0.7 + l.seed) + 0.04 * Math.sin(8 * a + l.seed * 2);
  return Math.hypot(dx, dz) / r;
}

// The Gale: glacier, hanging valley, Cloudfall, gorge, Mirror Lake, the vale, the sea.
const TRUNK: Control[] = [
  [-3700, -4300, 930, 5, 60, 0.75, 0],
  [-3300, -3700, 780, 5, 70, 0.75, 0],
  [-2950, -3150, 650, 6, 80, 0.7, 0],
  [-2600, -2600, 500, 7, 70, 0.7, 0],
  [-2250, -2150, 372, 8, 60, 0.65, 0],
  [-1990, -1830, 300, 9, 70, 0.55, 0],
  [-1880, -1690, 290, 10, 90, 0.5, 0],
  [-1700, -1530, 290, 10, 90, 0.5, 0],
  [-1575, -1362, 279, 10, 60, 0.55, 10],
  [-1445, -1262, 262, 11, 40, 0.6, 0],
  [-1376, -1186, 251, 12, 26, 0.9, 0],
  [-1350, -1152, 151, 12, 30, 1.3, 0],
  [-1325, -1118, 150, 12, 34, 1.2, 0],
  [-1236, -1010, 136, 11, 26, 1.1, 12],
  [-1190, -850, 118, 11, 30, 0.9, 18],
  [-1020, -700, 96, 12, 44, 0.6, 22],
  [-930, -490, 76, 12, 70, 0.4, 26],
  [-800, -350, 62, 13, 90, 0.3, 14],
  [-735, -262, 60, 14, 100, 0.25, 0],
  [-412, -168, 60, 15, 110, 0.2, 0],
  [-295, -92, 58, 15, 120, 0.16, 34],
  [-200, 36, 56, 16, 150, 0.14, 0],
  [-92, 158, 54, 16, 170, 0.13, 60],
  [22, 262, 51, 17, 170, 0.13, 0],
  [96, 322, 49.2, 17, 170, 0.13, 0],
  [150, 330, 48.5, 17, 170, 0.13, 0],
  [206, 332, 47.8, 17, 170, 0.13, 0],
  [300, 352, 47, 17, 180, 0.12, 44],
  [440, 404, 45, 18, 200, 0.11, 84],
  [680, 352, 42, 18, 210, 0.11, 90],
  [930, 268, 39, 19, 210, 0.11, 86],
  [1180, 332, 36, 20, 210, 0.11, 0],
  [1380, 560, 30, 21, 200, 0.12, 80],
  [1500, 860, 23, 22, 190, 0.12, 84],
  [1560, 1180, 15, 23, 180, 0.13, 76],
  [1490, 1480, 7, 26, 170, 0.13, 50],
  [1430, 1700, 1.5, 36, 160, 0.12, 16],
  [1450, 1900, 0, 60, 150, 0.1, 0],
  [1470, 2150, 0, 90, 150, 0.1, 0],
];
// North Beck: out of the northern range, round the west foot of the city crag.
const NORTH_BECK: Control[] = [
  [760, -2900, 610, 3, 30, 0.7, 0],
  [600, -2400, 430, 4, 30, 0.65, 0],
  [420, -1950, 300, 4, 36, 0.55, 0],
  [220, -1500, 205, 5, 44, 0.42, 8],
  [40, -1100, 138, 5, 56, 0.3, 14],
  [-70, -760, 100, 6, 64, 0.22, 20],
  [-120, -440, 78, 6, 70, 0.18, 22],
  [-150, -200, 65, 7, 76, 0.16, 18],
  [-185, -50, 58, 7, 80, 0.15, 6],
  [-200, 36, 56, 8, 90, 0.14, 0],
];
// Mill Brook: off the eastern highlands, joining below the mill.
const MILL_BROOK: Control[] = [
  [2700, -1900, 420, 3, 30, 0.6, 0],
  [2300, -1400, 300, 4, 36, 0.5, 0],
  [1980, -1000, 205, 4, 44, 0.42, 8],
  [1700, -640, 130, 5, 52, 0.32, 14],
  [1480, -330, 84, 5, 60, 0.22, 18],
  [1300, -60, 55, 6, 70, 0.16, 18],
  [1215, 180, 40, 6, 80, 0.13, 8],
  [1180, 332, 36, 7, 90, 0.11, 0],
];
// Wood Brook: from the south-western downs through Whisperwood.
const WOOD_BROOK: Control[] = [
  [-2500, 1150, 230, 3, 30, 0.5, 0],
  [-2050, 1000, 165, 3, 36, 0.4, 6],
  [-1600, 880, 118, 4, 44, 0.3, 12],
  [-1200, 720, 90, 4, 50, 0.22, 16],
  [-820, 540, 72, 5, 56, 0.18, 18],
  [-480, 380, 61, 5, 62, 0.15, 16],
  [-200, 270, 55, 6, 70, 0.13, 8],
  [22, 262, 51, 6, 80, 0.13, 0],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Dense polyline through the controls, with meanders swung across the valley floor. */
function trace(name: string, controls: Control[], spacing: number, seed: number): River {
  const raw: number[][] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[Math.max(0, i - 1)], b = controls[i], c = controls[i + 1], d = controls[Math.min(controls.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      // Position follows the spline; attributes interpolate linearly so that levels cannot overshoot.
      raw.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t),
        lerp(b[2], c[2], t), lerp(b[3], c[3], t), lerp(b[4], c[4], t), lerp(b[5], c[5], t),
        // Meanders die away toward every surveyed point with zero amplitude.
        lerp(b[6], c[6], t) * Math.min(1, (b[6] === 0 ? t : 1) * (c[6] === 0 ? 1 - t : 1) * 4)]);
    }
  }
  raw.push([...controls[controls.length - 1]]);
  // Sine-generated meanders: wavelength about twelve channel widths, amplitude wandering.
  let phase = seed * 7.1, s = 0;
  const pts: RiverPoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i], q = raw[Math.min(raw.length - 1, i + 1)], o = raw[Math.max(0, i - 1)];
    let tx = q[0] - o[0], tz = q[1] - o[1];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    if (i > 0) {
      const step = Math.hypot(p[0] - o[0], p[1] - o[1]);
      s += step;
      phase += step / Math.max(170, p[3] * 15) * Math.PI * 2 * (0.75 + 0.5 * snoise(s / 600 + seed, seed * 3.3));
    }
    const swing = p[6] * (0.6 + 0.5 * snoise(s / 380 + seed * 9, 4.2)) * Math.sin(phase) + p[6] * 0.5 * snoise(s / 260 + seed * 5, 9.4);
    pts.push({ x: p[0] - tz * swing, z: p[1] + tx * swing, level: p[2], width: p[3], floor: p[4], wall: p[5], s, dx: tx, dz: tz, fall: false, prev: null, next: null });
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    b.level = Math.min(b.level, a.level);
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    b.dx = (b.x - a.x) / run; b.dz = (b.z - a.z) / run;
    b.s = a.s + run;
    b.fall = (a.level - b.level) / run > 0.7;
    a.next = b; b.prev = a;
  }
  pts[0].dx = pts[1].dx; pts[0].dz = pts[1].dz;
  return { name, pts };
}

export const RIVERS: River[] = [
  trace('gale', TRUNK, 6, 1),
  trace('north-beck', NORTH_BECK, 6, 2),
  trace('mill-brook', MILL_BROOK, 6, 3),
  trace('wood-brook', WOOD_BROOK, 6, 4),
];
export const GALE = RIVERS[0];

// Spatial index of river points, so a query only looks at nearby water.
const BIN = 64;
const bins = new Map<number, RiverPoint[]>();
const binKey = (ix: number, iz: number): number => (ix + 512) * 1024 + (iz + 512);
for (const river of RIVERS) for (const p of river.pts) {
  const key = binKey(Math.floor(p.x / BIN), Math.floor(p.z / BIN));
  const list = bins.get(key);
  if (list) list.push(p); else bins.set(key, [p]);
}

export interface RiverSample {
  /** Distance to the centreline; Infinity when no river is within reach. */
  distance: number;
  found: boolean;
  level: number; width: number; floor: number; wall: number; fall: boolean;
  dx: number; dz: number; s: number;
}
const sample: RiverSample = { distance: Infinity, found: false, level: 0, width: 0, floor: 0, wall: 0, fall: false, dx: 1, dz: 0, s: 0 };
/** Nearest point of the river network within `reach` metres. The result object is reused. */
export function nearestRiver(x: number, z: number, reach = 120): RiverSample {
  sample.distance = Infinity; sample.found = false;
  const span = Math.ceil(reach / BIN);
  const ix = Math.floor(x / BIN), iz = Math.floor(z / BIN);
  let best = reach * reach, point: RiverPoint | null = null;
  for (let j = iz - span; j <= iz + span; j++) for (let i = ix - span; i <= ix + span; i++) {
    const list = bins.get(binKey(i, j));
    if (!list) continue;
    for (const p of list) {
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) { best = d; point = p; }
    }
  }
  if (!point) return sample;
  // Refine against the two segments that meet at the nearest vertex.
  let a = point, b = point, t = 0;
  for (const [p, q] of [[point.prev, point], [point, point.next]] as [RiverPoint | null, RiverPoint | null][]) {
    if (!p || !q) continue;
    const ex = q.x - p.x, ez = q.z - p.z;
    const u = clamp(((x - p.x) * ex + (z - p.z) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    const d = (p.x + ex * u - x) * (p.x + ex * u - x) + (p.z + ez * u - z) * (p.z + ez * u - z);
    if (d <= best) { best = d; a = p; b = q; t = u; }
  }
  sample.found = true;
  sample.distance = Math.sqrt(best);
  sample.level = lerp(a.level, b.level, t); sample.width = lerp(a.width, b.width, t);
  sample.floor = lerp(a.floor, b.floor, t); sample.wall = lerp(a.wall, b.wall, t);
  sample.fall = a.fall || b.fall; sample.dx = b.dx; sample.dz = b.dz; sample.s = lerp(a.s, b.s, t);
  return sample;
}

/** Sea level is 0. The coast wanders around z = 1760, with a headland for the lighthouse. */
export function coastZ(x: number): number {
  return 1770 + 150 * snoise(x / 900 + 3.3, 1.7) + 50 * snoise(x / 260 + 8.1, 5.2)
    + 210 * Math.exp(-((x - 700) * (x - 700)) / (170 * 170))
    - 190 * Math.exp(-((x - 1450) * (x - 1450)) / (230 * 230));
}

/**
 * Height of the water surface standing or flowing at a point, or -Infinity
 * where the ground is dry. The sea is 0.
 */
export function waterSurfaceAt(x: number, z: number, ground: number): number {
  for (const l of LAKES) {
    if (Math.abs(x - l.x) < l.rx * 1.3 && Math.abs(z - l.z) < l.rz * 1.3 && lakeShape(l, x, z) < 1.02) return l.level;
  }
  const r = nearestRiver(x, z, 48);
  if (r.found && !r.fall && r.distance < r.width * 0.5 + 1.5 && ground < r.level) return r.level;
  return ground < 0 ? 0 : -Infinity;
}

/** Cross-section of a channel: depth below the surface at a distance from the centreline. */
export function channelDepth(width: number, distance: number): number {
  const half = width * 0.5;
  const t = clamp(distance / half, 0, 1);
  const deep = Math.min(3.2, 0.7 + width * 0.11);
  return deep * (1 - t * t);
}

export { sstep };
