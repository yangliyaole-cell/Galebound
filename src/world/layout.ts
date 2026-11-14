import * as THREE from 'three';
import { GALE, LAKES, coastZ, lakeShape, nearestRiver } from './gen/hydro';
import { sfbm } from './gen/noise';

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
/**
 * Hightown. `wall` is the mean radius of the curtain wall; `plateau` the flat crown the
 * castle stands on, `foot` where its rock face meets the town, `top` the crown's height
 * and `fall` how far the town descends from the foot of the crown to the wall.
 */
export const CITY = { x: 560, z: -380, wall: 345, plateau: 88, foot: 106, top: 160, fall: 52 };
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
/** `level` is a fallback: bridges read the water level of the river they cross once the land is generated. */
export interface BridgeSpec { x: number; z: number; length: number; width: number; dirX: number; dirZ: number; level: number; arches: number; name: string }
/** Every stone bridge. The village bridge runs north-south; the two footbridges follow their roads. */
export const BRIDGES: BridgeSpec[] = [
  { ...BRIDGE, dirX: 0, dirZ: 1, arches: 3, name: 'village' },
  { x: -154, z: -205, length: 22, width: 3.4, dirX: -0.58, dirZ: -0.82, level: 65.3, arches: 1, name: 'north-beck' },
  { x: -256, z: 288, length: 20, width: 3.2, dirX: -0.81, dirZ: -0.59, level: 56.3, arches: 1, name: 'wood-brook' },
];
export const VILLAGE = { x: 150, z: 345, r: 150 };
/** On Mirror Lake's north-east shore: the deck stands in the water, its gangway runs south to the bank. */
export const PIER = { x: -484, z: -100 };
/** Where the Gale leaves its hanging valley: the lip of Cloudfall and the flow direction there. */
export const SCARP = { x: -1376, z: -1186, ux: 0.6, uz: 0.8, rise: 140 };

export type Pt = [number, number];

/** The same boundary drives wall masonry, terrain, paving, NPCs and scatter. */
export const SOUTH_GATE_ANGLE = Math.PI / 2;
export const EAST_GATE_ANGLE = Math.PI / 5;
export const WALL_SEGMENTS = 40;
// An irregular oval, longest towards the south-west where the town spills down towards the vale.
const rawCityRadius = (a: number): number => CITY.wall *
  (1 + 0.11 * Math.sin(a * 2 + 0.6) + 0.07 * Math.sin(a * 3 - 1.1) + 0.03 * Math.sin(a * 5 + 2) + 0.06 * Math.cos(a - 2.2));
const wallAngles = Array.from({ length: WALL_SEGMENTS }, (_, i) => i / WALL_SEGMENTS * Math.PI * 2 + 0.02 * Math.sin(i * 3.7))
  .filter((a) => [SOUTH_GATE_ANGLE, EAST_GATE_ANGLE].every((g) => Math.abs(a - g) > 0.1));
wallAngles.push(SOUTH_GATE_ANGLE - 0.06, SOUTH_GATE_ANGLE + 0.06, EAST_GATE_ANGLE - 0.06, EAST_GATE_ANGLE + 0.06);
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
export const CITY_MAX_RADIUS = Math.max(...cityWallPolygon.map(([x, z]) => Math.hypot(x - CITY.x, z - CITY.z)));
export function cityEdgeDistance(x: number, z: number): number {
  return Math.hypot(x - CITY.x, z - CITY.z) - cityRadiusAt(Math.atan2(z - CITY.z, x - CITY.x));
}
export const insideCity = (x: number, z: number, inset = 0): boolean => cityEdgeDistance(x, z) < -inset;
/** 0 at the foot of the castle crag, 1 at the curtain wall (beyond 1 outside it). */
export function cityTerraceMetric(x: number, z: number): number {
  const r = Math.hypot(x - CITY.x, z - CITY.z);
  return (r - CITY.foot) / Math.max(30, cityRadiusAt(Math.atan2(z - CITY.z, x - CITY.x)) - CITY.foot);
}
/** The point at angle `a` and terrace metric `t` (see cityTerraceMetric). */
export function cityShelfPoint(a: number, t: number): Pt {
  const r = CITY.foot + (cityRadiusAt(a) - CITY.foot) * t;
  return [CITY.x + Math.cos(a) * r, CITY.z + Math.sin(a) * r];
}
export function cityGate(a: number): { x: number; z: number } {
  // The two vertices deliberately bracketing the gate form one complete wall segment.
  const p = cityWallPolygon[wallAngles.indexOf(a - 0.06)];
  const q = cityWallPolygon[wallAngles.indexOf(a + 0.06)];
  return { x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2 };
}
export const SOUTH_GATE = cityGate(SOUTH_GATE_ANGLE);
export const EAST_GATE = cityGate(EAST_GATE_ANGLE);
/** On a natural shelf of the scarp top, above Cloudfall, looking south-east over the vale.
 * Its road was routed by scripts/route-road.mjs and switches back up the scarp. */
export const ABBEY = { x: -1535, z: -1477, floor: 283, halfWidth: 18, halfLength: 37, entranceZ: -1440, tower: 308 };

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
  /** A town lane too steep to ramp: drawn as a flight of steps. */
  stairs?: boolean;
}
export function road(id: string, kind: Road['kind'], width: number, controls: Pt[], bridge = false): Road {
  const pts = bridge ? controls : smooth(controls);
  return { id, kind, width, pts, bridge, widths: pts.map((_, i) => {
    const t = i / (pts.length - 1);
    return Math.max(2, Math.min(6, width * (1 + 0.19 * Math.sin(t * 17 + id.length) + 0.11 * Math.sin(t * 39))));
  }) };
}
/**
 * Hightown's squares. Each is paved level at `level` metres below the castle crown
 * fraction given by the town's own slope (see city-plan.ts); `rot` turns its long side.
 */
export interface CitySquare { id: string; kind: 'market' | 'forecourt' | 'cathedral' | 'well'; x: number; z: number; rx: number; rz: number; rot: number }
const square = (id: CitySquare['kind'] | string, kind: CitySquare['kind'], a: number, t: number, rx: number, rz: number): CitySquare => {
  const [x, z] = cityShelfPoint(a, t);
  // Long side along the contour.
  return { id, kind, x, z, rx, rz, rot: Math.PI / 2 - a };
};
export const CITY_SQUARES: CitySquare[] = [
  square('market', 'market', 1.70, 0.83, 30, 21),
  square('forecourt', 'forecourt', Math.PI, 0.13, 24, 17),
  square('cathedral', 'cathedral', 2.2, 0.42, 26, 18),
  square('well-east', 'well', 0.22, 0.52, 10, 9),
  square('well-north', 'well', -1.45, 0.31, 10, 8),
  square('well-west', 'well', -2.45, 0.74, 9, 9),
  square('well-south', 'well', 1.15, 0.30, 9, 8),
];
/** Signed distance to a square's rim (negative inside), treating it as a rounded rectangle. */
export function squareDistance(q: CitySquare, x: number, z: number): number {
  const c = Math.cos(q.rot), s = Math.sin(q.rot), dx = x - q.x, dz = z - q.z;
  const u = Math.abs(dx * c - dz * s), v = Math.abs(dx * s + dz * c);
  const round = Math.min(q.rx, q.rz) * 0.45;
  const ox = Math.max(0, u - (q.rx - round)), oz = Math.max(0, v - (q.rz - round));
  return Math.hypot(ox, oz) + Math.min(0, Math.max(u - (q.rx - round), v - (q.rz - round))) - round;
}
export const citySquareAt = (x: number, z: number, pad = 0): CitySquare | undefined => CITY_SQUARES.find((q) => squareDistance(q, x, z) < pad);

/** A town street: steadier width than a country road, optionally a flight of steps. */
function street(id: string, width: number, controls: Pt[], stairs = false): Road {
  const pts = smooth(controls, 10);
  return { id, kind: 'cobble', width, pts, stairs, widths: pts.map((_, i) => width * (1 + 0.08 * Math.sin(i * 0.37 + id.length))) };
}
/** Polar control points: [angle, terrace metric], with a gentle organic wander. */
const arc = (spec: [number, number][]): Pt[] => spec.map(([a, t]) => cityShelfPoint(a, t));
/** A contour street from angle a0 to a1 at metric t, wandering by `wobble`. */
const ring = (a0: number, a1: number, t: number, wobble: number, seed: number): Pt[] => {
  const n = Math.max(3, Math.round(Math.abs(a1 - a0) / 0.22));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (a1 - a0) * i / n;
    return cityShelfPoint(a, t + wobble * Math.sin(a * 2 + seed * 1.7) + wobble * 0.6 * Math.sin(a * 5 - seed) + wobble * 0.3 * Math.sin(a * 9 + seed * 3));
  });
};
const sq = (id: string): Pt => { const q = CITY_SQUARES.find((s) => s.id === id)!; return [q.x, q.z]; };
export const CITY_STREETS: Road[] = [
  // The high road: south gate, through the market, past the cathedral, up to the castle forecourt.
  street('avenue', 7, [[SOUTH_GATE.x, SOUTH_GATE.z], cityShelfPoint(1.6, 0.93), sq('market'), ...arc([[1.86, 0.74], [2.0, 0.6]]), sq('cathedral'),
    ...arc([[2.45, 0.3], [2.75, 0.22], [2.98, 0.14]]), sq('forecourt')]),
  street('east-street', 5.6, [[EAST_GATE.x, EAST_GATE.z], cityShelfPoint(0.6, 0.9), ...arc([[0.48, 0.74], [0.3, 0.6]]), sq('well-east'), ...arc([[0.05, 0.42], [-0.15, 0.31]])]),
  // Contour streets, one per broad shelf of the hill.
  street('castle-ring', 5, ring(-2.86, 2.86, 0.09, 0.015, 1)),
  street('high-street', 6, [...ring(-2.9, 2.05, 0.31, 0.055, 2), sq('cathedral')]),
  street('middle-ring', 5.4, [sq('cathedral'), ...ring(2.35, 2.35 + Math.PI * 2 - 0.62, 0.53, 0.07, 3)]),
  street('lower-ring', 5, [sq('market'), ...ring(1.86, 1.86 + Math.PI * 2 - 0.35, 0.76, 0.06, 4)]),
  street('wall-lane', 3.6, ring(-2.6, 1.2, 0.93, 0.012, 5)),
  street('wall-lane-west', 3.4, ring(2.0, 3.6, 0.93, 0.012, 6)),
  // Steep lanes between the shelves, mostly flights of steps; none lines up with the next.
  street('stair-n1', 3.2, arc([[-1.62, 0.09], [-1.58, 0.18], [-1.52, 0.31]]), true),
  street('stair-n2', 3.4, arc([[-1.35, 0.31], [-1.3, 0.42], [-1.22, 0.53]]), true),
  street('stair-n3', 3.2, arc([[-1.0, 0.53], [-0.94, 0.65], [-0.9, 0.76], [-0.86, 0.93]]), true),
  street('stair-e1', 3.4, arc([[-0.35, 0.09], [-0.4, 0.2], [-0.38, 0.31]]), true),
  street('stair-e2', 3.6, arc([[0.62, 0.31], [0.7, 0.43], [0.76, 0.53]]), true),
  street('stair-e3', 3.2, arc([[-0.2, 0.53], [-0.24, 0.65], [-0.22, 0.76], [-0.26, 0.93]]), true),
  street('stair-s1', 3.4, [...arc([[1.2, 0.09], [1.17, 0.18]]), sq('well-south')], true),
  street('stair-s2', 3.2, arc([[1.28, 0.31], [1.33, 0.42], [1.38, 0.53], [1.44, 0.65], [1.5, 0.76]]), true),
  street('stair-w1', 3.4, arc([[2.0, 0.09], [2.06, 0.18], [2.1, 0.31]]), true),
  street('stair-w2', 3.2, arc([[2.85, 0.31], [2.9, 0.42], [2.94, 0.53]]), true),
  street('stair-w3', 3.4, arc([[2.6, 0.53], [2.55, 0.64], [2.5, 0.76], [2.46, 0.93]]), true),
  street('stair-nw1', 3.2, arc([[-2.45, 0.09], [-2.4, 0.18], [-2.36, 0.31]]), true),
  street('stair-nw2', 3.4, arc([[-2.1, 0.31], [-2.05, 0.42], [-2.0, 0.53]]), true),
  street('stair-nw3', 3.2, arc([[-2.55, 0.53], [-2.5, 0.64], [-2.45, 0.74]]), true),
  street('stair-se', 3.2, arc([[0.95, 0.53], [0.98, 0.65], [1.02, 0.76], [1.0, 0.93]]), true),
];
const B = BRIDGE;
/** The two ends of a bridge's approach ramps, in the direction of travel. */
const ends = (name: string): [Pt, Pt] => {
  const b = BRIDGES.find((q) => q.name === name)!, reach = b.length / 2 + 10;
  return [[b.x - b.dirX * reach, b.z - b.dirZ * reach], [b.x + b.dirX * reach, b.z + b.dirZ * reach]];
};
const [WB0, WB1] = ends('wood-brook'), [NB0, NB1] = ends('north-beck');
/** A country road arriving at a city gate: no control point may stand inside the town or under its crag. */
function approach(controls: Pt[], gate: { x: number; z: number }): Pt[] {
  return [...controls.filter(([x, z], i) => i >= controls.length - 2 || cityEdgeDistance(x, z) > 60), [gate.x, gate.z]];
}
export const ROADS: Road[] = [
  road('start-village', 'dirt', 3.9, [[2, 1242], [-16, 1180], [-52, 1090], [-66, 990], [-30, 880], [34, 770], [70, 650], [88, 540], [132, 440], [B.x, B.z + 46], [B.x, B.z + 23]]),
  road('river-bridge', 'cobble', 4.7, [[B.x, B.z + 23], [B.x, B.z - 23]], true),
  road('village-city', 'dirt', 4.3, approach([[B.x, B.z - 23], [B.x, B.z - 34], [176, 240], [172, 150], [226, 60], [322, -22], [402, -40], [470, 2],
    [SOUTH_GATE.x - 40, SOUTH_GATE.z + 70], [SOUTH_GATE.x - 6, SOUTH_GATE.z + 26]], SOUTH_GATE)),
  road('mill-road', 'dirt', 3.2, [[88, 540], [214, 566], [372, 604], [536, 640], [694, 688], [836, 738], [926, 764]]),
  road('lake-road', 'dirt', 3.0, [[132, 440], [86, 396], [-8, 356], [-110, 318], [-196, 322], [WB0[0] + 14, WB0[1] + 10], WB0]),
  road('wood-brook-bridge', 'cobble', 3.2, [WB0, WB1], true),
  road('lake-road-west', 'dirt', 3.0, [WB1, [WB1[0] - 12, WB1[1] - 9], [-300, 250], [-372, 130], [-420, 20], [-450, -40], [PIER.x + 18, PIER.z + 46], [PIER.x + 18, PIER.z + 29]]),
  road('coastal-trail', 'dirt', 2.8, [[6, 1258], [118, 1292], [262, 1338], [420, 1396], [580, 1446], [736, 1484], [790, 1500], [800, 1600], [752, 1720], [LIGHTHOUSE.x + 6, LIGHTHOUSE.z - 14]]),
  road('grove-trail', 'dirt', 2.4, [[-6, 1250], [-128, 1212], [-262, 1122], [-378, 984], [-470, 852], [-516, 786], [-640, 822], [-782, 920], [-924, 1002], [-1040, 1046]]),
  road('highland-road', 'dirt', 3.0, approach([[1650, -840], [1610, -780], [1540, -660], [1470, -520], [1360, -400], [1200, -330], [1040, -300],
    [EAST_GATE.x + 70 * Math.cos(EAST_GATE_ANGLE - 0.2), EAST_GATE.z + 70 * Math.sin(EAST_GATE_ANGLE - 0.2)], [EAST_GATE.x + 24 * Math.cos(EAST_GATE_ANGLE), EAST_GATE.z + 24 * Math.sin(EAST_GATE_ANGLE)]], EAST_GATE).reverse()),
  road('abbey-pilgrimage', 'dirt', 2.8, [[172, 150], [60, 96], [-40, 10], [-96, -110], [NB0[0] + 6, NB0[1] + 8.5], NB0]),
  road('abbey-pilgrimage-bridge', 'cobble', 3.4, [NB0, NB1], true),
  road('abbey-pilgrimage-upper', 'dirt', 2.8, [NB1, [NB1[0] - 6, NB1[1] - 8.5], [-190, -250], [-330, -360], [-470, -440], [-620, -520], [-740, -640], [-820, -790], [-883, -940], [-891, -988], [-931, -1004], [-979, -1004], [-1027, -1004], [-1075, -1028], [-1107, -1052], [-1115, -1100], [-1107, -1148], [-1107, -1196], [-1139, -1228], [-1195, -1228], [-1243, -1228], [-1291, -1228], [-1339, -1204], [-1315, -1252], [-1283, -1284], [-1251, -1316], [-1219, -1348], [-1187, -1380], [-1163, -1412], [-1147, -1460], [-1147, -1500], [-1171, -1452], [-1211, -1420], [-1259, -1396], [-1227, -1428], [-1203, -1476], [-1203, -1524], [-1203, -1572], [-1227, -1524], [-1251, -1492], [-1291, -1468], [-1339, -1444], [-1387, -1420], [-1435, -1396], [-1483, -1372], [-1499, -1332], [-1523, -1356], [-1539, -1404], [-1535, -1440]]),
  road('field-path', 'dirt', 2.2, [[-8, 356], [-60, 430], [-76, 530], [-40, 640], [34, 770]]),
  ...CITY_STREETS,
];

/** Cobbled squares: [x, z, radius]. */
export const PLAZAS: [number, number, number][] = [
  [VILLAGE.x - 4, VILLAGE.z + 34, 11], [CITY.x, CITY.z, CITY.plateau - 3],
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
  crop: 'wheat' | 'tilled' | 'cabbage' | 'lavender' | 'hay';
  /** Outlying parcels are painted on the land and hedged, without fences or standing crops. */
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
  // The rest of the vale: blocks of parcels on a loose lattice, wherever the land is farmed.
  const OUTLYING: Field['crop'][] = ['hay', 'wheat', 'hay', 'cabbage', 'wheat', 'hay', 'tilled', 'hay', 'wheat', 'lavender'];
  for (let bz = -1150; bz <= 1560; bz += 236) for (let bx = -1250; bx <= 1850; bx += 236) {
    k += 40;
    const cx = bx + jitter(k) * 90, cz = bz + jitter(k + 7) * 90;
    if (sfbm(cx / 640 + 3.1, cz / 640 + 9.4, 2) < -0.2) continue;
    if (FIELD_BLOCKS.some(([fx, fz]) => Math.hypot(fx - cx, fz - cz) < 210)) continue;
    const rot = jitter(k + 13) * 1.5, c = Math.cos(rot), s = Math.sin(rot);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) {
      k++;
      const w = 52 + jitter(k) * 18, d = 36 + jitter(k + 500) * 12;
      const u = (i - 1.5) * 57 + jitter(k + 90) * 6, v = (j - 2) * 41 + jitter(k + 190) * 5;
      const x = cx + u * c - v * s, z = cz + u * s + v * c;
      if (jitter(k + 900) > 0.3) continue;
      if (nearestRiver(x, z, 80).found || roadClearance(x, z) < 30 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 150) continue;
      if (LAKES.some((l) => lakeShape(l, x, z) < 1.4) || cityEdgeDistance(x, z) < 90 || Math.hypot(x - START.x, z - START.z) < 150) continue;
      if (Math.abs(x) > HALF - 150 || Math.abs(z) > HALF - 150) continue;
      FIELDS.push({ x, z, w, d, rot: rot + jitter(k + 300) * 0.1, crop: OUTLYING[k % OUTLYING.length], scenic: true });
    }
  }
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
  { name: '高城', sub: 'Hightown', x: CITY.x, z: CITY.z, r: CITY_MAX_RADIUS + 30 },
  { name: '镜湖', sub: 'Mirror Lake', x: LAKE.x, z: LAKE.z, r: 240 },
  { name: '低语林', sub: 'Whisperwood', x: FOREST.x, z: FOREST.z, r: 340 },
  { name: '花谷', sub: 'Petal Hollow', x: BLOSSOM.x, z: BLOSSOM.z, r: 100 },
  { name: '望海岬', sub: 'Lighthouse Cape', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 120 },
  { name: '旧瞭望塔', sub: 'The Old Watch', x: WATCHTOWER.x, z: WATCHTOWER.z, r: 90 },
  { name: '石阵高地', sub: 'Standing Stones', x: PLATEAU.x, z: PLATEAU.z, r: 260 },
];
