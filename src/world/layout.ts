import * as THREE from 'three';
import { GALE, LAKES, coastZ, lakeShape, nearestRiver } from './gen/hydro';

/**
 * The map. North is -Z, east is +X. All distances in metres.
 * Everything that decides where things are lives here.
 */
export const SIZE = 4096;
export const HALF = SIZE / 2;
export const WATER_LEVEL = 0;
/** The player is kept this far inside the edge of the detailed terrain. */
export const WORLD_MARGIN = 60;

// The vale lies between the coastal downs (south) and the ranges (north, west).
// From the starting hill the view runs north: village and bridge in the middle
// distance, the walled city on its crag beyond, Cloudfall and the abbey on the
// north-western scarp, and the glaciers behind them.
export const START = { x: 0, z: 1250 };
export const CITY = { x: 560, z: -380, wall: 195, hill: 345, plateau: 78, top: 152, base: 58, step: 10 };
export const WINDMILL = { x: 940, z: 760 };
export const LAKE = { x: -600, z: -180, rx: 195, rz: 128, level: 60 };
export const ISLAND = { x: -634, z: -190 };
export const PLATEAU = { x: 1660, z: -900, rx: 210, rz: 320, h: 60 };
export const STONES = { x: 1656, z: -850 };
export const FOREST = { x: -1050, z: 1050, r: 400 };
export const BLOSSOM = { x: -520, z: 770, r: 90 };
export const LIGHTHOUSE = { x: 700, z: Math.round(coastZ(700) - 80) };
export const WATCHTOWER = { x: 800, z: 1480 };
export const BRIDGE = { x: 150, z: 330, length: 46, width: 5.2, level: 48.5 };
export const VILLAGE = { x: 150, z: 345, r: 150 };
export const PIER = { x: -470, z: -86 };
/** Where the Gale leaves its hanging valley: the lip of Cloudfall and the flow direction there. */
export const SCARP = { x: -1376, z: -1186, ux: 0.6, uz: 0.8, rise: 140 };

export type Pt = [number, number];

/** The same boundary drives wall masonry, terrain, paving, NPCs and scatter. */
export const SOUTH_GATE_ANGLE = Math.PI / 2;
export const EAST_GATE_ANGLE = Math.PI / 5;
export const WALL_SEGMENTS = 28;
const rawCityRadius = (a: number): number => Math.max(129, CITY.wall *
  (1 + 0.32 * Math.sin(a * 3 + 0.4) + 0.16 * Math.cos(a * 2 - 0.7) + 0.055 * Math.sin(a * 7)));
const wallAngles = Array.from({ length: WALL_SEGMENTS }, (_, i) => i / WALL_SEGMENTS * Math.PI * 2 + 0.025 * Math.sin(i * 3.7))
  .filter((a) => [SOUTH_GATE_ANGLE, EAST_GATE_ANGLE].every((g) => Math.abs(a - g) > 0.17));
wallAngles.push(SOUTH_GATE_ANGLE - 0.12, SOUTH_GATE_ANGLE + 0.12, EAST_GATE_ANGLE - 0.12, EAST_GATE_ANGLE + 0.12);
wallAngles.sort((a, b) => a - b);
export const cityWallPolygon: Pt[] = wallAngles.map((a) => [CITY.x + Math.cos(a) * rawCityRadius(a), CITY.z + Math.sin(a) * rawCityRadius(a)]);
/** Intersect a ray with the actual polygon, rather than assuming a circle. */
export function cityRadiusAt(a: number): number {
  const dx = Math.cos(a), dz = Math.sin(a);
  for (let i = 0; i < cityWallPolygon.length; i++) {
    const p = cityWallPolygon[i], q = cityWallPolygon[(i + 1) % cityWallPolygon.length];
    const px = p[0] - CITY.x, pz = p[1] - CITY.z, ex = q[0] - p[0], ez = q[1] - p[1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-8) continue;
    const t = (px * ez - pz * ex) / den;
    const u = (px * dz - pz * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) return t;
  }
  return rawCityRadius(a);
}
export function cityEdgeDistance(x: number, z: number): number {
  return Math.hypot(x - CITY.x, z - CITY.z) - cityRadiusAt(Math.atan2(z - CITY.z, x - CITY.x));
}
export const insideCity = (x: number, z: number, inset = 0): boolean => cityEdgeDistance(x, z) < -inset;
/** Five inhabited shelves rise toward the unchanged palace shelf. */
export const CITY_TERRACE_EDGES = [0.16, 0.34, 0.52, 0.70, 0.88];
export function cityTerraceMetric(x: number, z: number): number {
  const r = Math.hypot(x - CITY.x, z - CITY.z);
  return (r - 90) / Math.max(30, cityRadiusAt(Math.atan2(z - CITY.z, x - CITY.x)) - 90);
}
export function cityShelfPoint(a: number, t: number): Pt {
  const r = 90 + (cityRadiusAt(a) - 90) * t;
  return [CITY.x + Math.cos(a) * r, CITY.z + Math.sin(a) * r];
}
export function cityGate(a: number): { x: number; z: number } {
  // The two vertices deliberately bracketing the gate form one complete wall segment.
  const p = cityWallPolygon[wallAngles.indexOf(a - 0.12)];
  const q = cityWallPolygon[wallAngles.indexOf(a + 0.12)];
  return { x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2 };
}
export const SOUTH_GATE = cityGate(SOUTH_GATE_ANGLE);
export const EAST_GATE = cityGate(EAST_GATE_ANGLE);
/** On the scarp top beside Cloudfall, looking south-east over the vale. */
export const ABBEY = { x: -1180, z: -1480, floor: 262, halfWidth: 18, halfLength: 37, entranceZ: -1443, tower: 287 };

export function smooth(points: Pt[], perSegment = 8): Pt[] {
  const curve = new THREE.SplineCurve(points.map(([x, z]) => new THREE.Vector2(x, z)));
  return curve.getPoints((points.length - 1) * perSegment).map((p) => [p.x, p.y] as Pt);
}

/** The Gale as a polyline, for placement tests. */
export const RIVER: Pt[] = GALE.pts.filter((_, i) => i % 3 === 0).map((p) => [p.x, p.z] as Pt);
export function lakeMetric(x: number, z: number): number {
  return lakeShape(LAKES[0], x, z);
}
export const riverWidthAt = (x: number, z: number): number => { const r = nearestRiver(x, z, 160); return r.found ? r.width : 12; };

export interface Road {
  id: string;
  kind: 'dirt' | 'cobble';
  width: number;
  widths: number[];
  pts: Pt[];
  bridge?: boolean;
}
export function road(id: string, kind: Road['kind'], width: number, controls: Pt[], bridge = false): Road {
  const pts = bridge ? controls : smooth(controls);
  return { id, kind, width, pts, bridge, widths: pts.map((_, i) => {
    const t = i / (pts.length - 1);
    return Math.max(2, Math.min(6, width * (1 + 0.19 * Math.sin(t * 17 + id.length) + 0.11 * Math.sin(t * 39))));
  }) };
}
const cp = (x: number, z: number): Pt => [CITY.x + x, CITY.z + z];
export const CITY_STREETS: Road[] = [
  road('ascent', 'cobble', 5.2, [[SOUTH_GATE.x, SOUTH_GATE.z], cp(23, 147), cp(83, 120), cp(124, 57), cp(120, -22), cp(76, -98), cp(5, -126), cp(-75, -111), cp(-126, -64), cp(-121, -13), cp(-90, 0), cp(-76, 0)]),
  road('market-lane', 'cobble', 4.4, [cp(23, 147), cp(-33, 119), cp(-76, 105), cp(-109, 61), cp(-121, -13)]),
  road('east-lane', 'cobble', 4.5, [[EAST_GATE.x, EAST_GATE.z], cp(124, 57), cp(102, 89), cp(58, 110), cp(20, 122), cp(-33, 119)]),
  road('north-alley', 'cobble', 2.4, [cp(120, -22), cp(147, -65), cp(115, -114), cp(59, -143), cp(5, -126)]),
  road('west-alley', 'cobble', 2.5, [cp(-76, 105), cp(-144, 96), cp(-165, 42), cp(-156, -10), cp(-126, -64)]),
  road('east-ridge', 'cobble', 3.0, [cp(124, 57), cityShelfPoint(0.4, 0.82), cityShelfPoint(0.02, 0.8), cityShelfPoint(-0.35, 0.84), cityShelfPoint(-0.7, 0.77), cp(76, -98)]),
  road('west-ridge', 'cobble', 2.7, [cp(-76, 105), cityShelfPoint(2.3, 0.80), cityShelfPoint(2.6, 0.84), cityShelfPoint(2.95, 0.76), cityShelfPoint(3.3, 0.84), cityShelfPoint(3.6, 0.8), cp(-126, -64)]),
  road('north-ridge', 'cobble', 2.8, [cp(-75, -111), cityShelfPoint(4.0, 0.77), cityShelfPoint(4.4, 0.83), cityShelfPoint(4.8, 0.80), cityShelfPoint(5.2, 0.83), cp(115, -114)]),
];
// Trim switchbacks to the shared irregular ridge. The gate approaches keep their
// exact endpoints; the market occupies a separate parcel beside the lanes.
for (const street of CITY_STREETS) {
  street.pts = street.pts.map(([x, z]) => {
    let dx = x - CITY.x, dz = z - CITY.z;
    const a = Math.atan2(dz, dx), r = Math.hypot(dx, dz);
    const gateDistance = Math.min(Math.hypot(x - SOUTH_GATE.x, z - SOUTH_GATE.z), Math.hypot(x - EAST_GATE.x, z - EAST_GATE.z));
    const limit = cityRadiusAt(a) - Math.min(12, gateDistance * 0.5);
    if (r > limit) { dx *= limit / r; dz *= limit / r; }
    x = CITY.x + dx; z = CITY.z + dz;
    return [x, z];
  });
}
const B = BRIDGE;
export const ROADS: Road[] = [
  road('start-village', 'dirt', 3.9, [[2, 1242], [-16, 1180], [-52, 1090], [-66, 990], [-30, 880], [34, 770], [70, 650], [88, 540], [132, 440], [B.x, B.z + 46], [B.x, B.z + 23]]),
  road('river-bridge', 'cobble', 4.7, [[B.x, B.z + 23], [B.x, B.z - 23]], true),
  road('village-city', 'dirt', 4.3, [[B.x, B.z - 23], [B.x, B.z - 34], [176, 240], [172, 150], [226, 60], [322, -22], [402, -92], [470, -128], [530, -152], [SOUTH_GATE.x, SOUTH_GATE.z]]),
  road('mill-road', 'dirt', 3.2, [[88, 540], [214, 566], [372, 604], [536, 640], [694, 688], [836, 738], [926, 764]]),
  road('lake-road', 'dirt', 3.0, [[132, 440], [86, 396], [-8, 356], [-110, 318], [-196, 322], [-300, 250], [-372, 130], [-420, 20], [-462, -52], [PIER.x, PIER.z + 14]]),
  road('coastal-trail', 'dirt', 2.8, [[6, 1258], [118, 1292], [262, 1338], [420, 1396], [580, 1446], [736, 1484], [790, 1500], [800, 1600], [752, 1720], [LIGHTHOUSE.x + 6, LIGHTHOUSE.z - 14]]),
  road('grove-trail', 'dirt', 2.4, [[-6, 1250], [-128, 1212], [-262, 1122], [-378, 984], [-470, 852], [-516, 786], [-640, 822], [-782, 920], [-924, 1002], [-1040, 1046]]),
  road('highland-road', 'dirt', 3.0, [[EAST_GATE.x, EAST_GATE.z], [EAST_GATE.x + 20 * Math.cos(EAST_GATE_ANGLE), EAST_GATE.z + 20 * Math.sin(EAST_GATE_ANGLE)], [880, -250], [1040, -300], [1200, -330], [1360, -400], [1470, -520], [1540, -660], [1610, -780], [1650, -840]]),
  road('abbey-pilgrimage', 'dirt', 2.8, [[172, 150], [60, 96], [-40, 10], [-96, -110], [-190, -250], [-330, -360], [-470, -440], [-620, -520], [-740, -640], [-820, -790], [-880, -940], [-950, -1090], [-1010, -1230], [-1060, -1350], [-1120, -1410], [-1180, -1424], [-1180, -1443]]),
  road('field-path', 'dirt', 2.2, [[-8, 356], [-60, 430], [-76, 530], [-40, 640], [34, 770]]),
  ...CITY_STREETS,
];

/** Cobbled squares: [x, z, radius]. */
export const PLAZAS: [number, number, number][] = [
  [VILLAGE.x - 4, VILLAGE.z + 34, 11], [CITY.x + 18, CITY.z + 100, 12], [CITY.x, CITY.z, CITY.plateau - 5],
];

// Index short segments once; placement queries only inspect nearby roads.
const roadCells = new Map<string, { r: Road; i: number }[]>();
for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) {
  const a = r.pts[i], b = r.pts[i + 1];
  for (let gx = Math.floor((Math.min(a[0], b[0]) - 24) / 32); gx <= Math.floor((Math.max(a[0], b[0]) + 24) / 32); gx++) {
    for (let gz = Math.floor((Math.min(a[1], b[1]) - 24) / 32); gz <= Math.floor((Math.max(a[1], b[1]) + 24) / 32); gz++) {
      const key = `${gx},${gz}`;
      if (!roadCells.has(key)) roadCells.set(key, []);
      roadCells.get(key)!.push({ r, i });
    }
  }
}
/** Signed distance to a road edge within the local 24m placement neighborhood. */
export function roadClearance(x: number, z: number, kinds?: Road['kind']): number {
  let d = Infinity;
  for (const { r, i } of roadCells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []) {
    if (kinds && r.kind !== kinds) continue;
    const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) - (r.widths[i] + t * (r.widths[i + 1] - r.widths[i])) / 2);
  }
  return d;
}

export interface Field {
  x: number; z: number; w: number; d: number; rot: number;
  crop: 'wheat' | 'tilled' | 'cabbage' | 'lavender';
  /** Outer parcels keep painted field colour but omit individual crop geometry on low. */
  scenic?: boolean;
}
/** Patchwork farmland: [centre x, centre z, columns, rows, rotation]. Parcels avoid water and roads. */
const FIELD_BLOCKS: [number, number, number, number, number][] = [
  [40, 580, 4, 3, 0.16], [310, 500, 4, 3, -0.2], [590, 520, 4, 2, 0.1], [330, 190, 4, 3, 0.3],
  [640, 130, 4, 3, -0.12], [-20, 70, 3, 2, 0.5], [-220, 440, 4, 3, -0.3], [1010, 560, 3, 2, 0.24],
  [800, 930, 3, 3, -0.16], [930, 40, 4, 3, 0.2], [1440, 170, 3, 2, -0.3], [150, -330, 3, 3, 0.1],
  [-280, 950, 3, 2, 0.2], [340, 960, 4, 2, -0.1], [-520, 180, 3, 2, 0.36], [1120, -80, 3, 2, 0.4],
  [260, -90, 3, 2, -0.4], [860, -520, 3, 2, 0.15], [-380, -420, 3, 2, -0.2], [520, 800, 3, 2, 0.3],
];
const CROPS: Field['crop'][] = ['wheat', 'tilled', 'cabbage', 'wheat', 'lavender', 'wheat', 'cabbage', 'tilled'];
export const FIELDS: Field[] = [];
{
  let k = 0;
  const jitter = (i: number): number => { const v = Math.sin(i * 127.1 + 31.7) * 43758.5453; return v - Math.floor(v) - 0.5; };
  FIELD_BLOCKS.forEach(([cx, cz, cols, rows, rot], block) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      k++;
      const w = 44 + jitter(k) * 16, d = 30 + jitter(k + 500) * 10;
      const u = (i - (cols - 1) / 2) * 50 + jitter(k + 90) * 6, v = (j - (rows - 1) / 2) * 35 + jitter(k + 190) * 5;
      const x = cx + u * c - v * s, z = cz + u * s + v * c;
      if (jitter(k + 900) > 0.34) continue;
      if (nearestRiver(x, z, 90).found || roadClearance(x, z) < 26 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 95) continue;
      if (LAKES.some((l) => lakeShape(l, x, z) < 1.35) || cityEdgeDistance(x, z) < 60) continue;
      FIELDS.push({ x, z, w, d, rot: rot + jitter(k + 300) * 0.16, crop: CROPS[(k + block) % CROPS.length], scenic: block > 4 });
    }
  });
}
/** Deliberately skewed parcels, shared by splat painting, crops and fences. */
export function fieldPolygon(f: Field): Pt[] {
  const outline = [[-0.47, -0.48], [0.24, -0.54], [0.5, -0.31], [0.46, 0.45], [-0.17, 0.51], [-0.52, 0.26]];
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  return outline.map(([u, v]) => [f.x + u * f.w * c - v * f.d * s, f.z + u * f.w * s + v * f.d * c]);
}
export function inPolygon(x: number, z: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToPolyline(x: number, z: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t - x;
    const pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Named regions, used for the title card shown when the player arrives. */
export const ZONES: { name: string; sub: string; x: number; z: number; r: number }[] = [
  { name: '启程丘', sub: 'Setting-Out Hill', x: START.x, z: START.z, r: 110 },
  { name: '河谷村', sub: 'Riverbend Village', x: VILLAGE.x, z: VILLAGE.z, r: 150 },
  { name: '风车丘', sub: 'Windmill Rise', x: WINDMILL.x, z: WINDMILL.z, r: 120 },
  { name: '云瀑修道院', sub: 'Cloudfall Abbey', x: ABBEY.x, z: ABBEY.z, r: 130 },
  { name: '高城', sub: 'Hightown', x: CITY.x, z: CITY.z, r: CITY.wall + 30 },
  { name: '镜湖', sub: 'Mirror Lake', x: LAKE.x, z: LAKE.z, r: 240 },
  { name: '低语林', sub: 'Whisperwood', x: FOREST.x, z: FOREST.z, r: 340 },
  { name: '花谷', sub: 'Petal Hollow', x: BLOSSOM.x, z: BLOSSOM.z, r: 100 },
  { name: '望海岬', sub: 'Lighthouse Cape', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 120 },
  { name: '旧瞭望塔', sub: 'The Old Watch', x: WATCHTOWER.x, z: WATCHTOWER.z, r: 90 },
  { name: '石阵高地', sub: 'Standing Stones', x: PLATEAU.x, z: PLATEAU.z, r: 260 },
];
