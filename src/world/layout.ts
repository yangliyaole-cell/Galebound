import * as THREE from 'three';

/**
 * The map. North is -Z, east is +X. All distances in metres.
 * Everything that decides where things are lives here.
 */
export const SIZE = 2048;
export const HALF = SIZE / 2;
export const WATER_LEVEL = 0;

export const START = { x: 0, z: 100 };
export const CITY = { x: 120, z: -640, wall: 175, hill: 295, plateau: 78, top: 104 };
export const WINDMILL = { x: 340, z: -80 };
export const LAKE = { x: -430, z: -300, rx: 130, rz: 100 };
export const ISLAND = { x: -452, z: -306 };
export const PLATEAU = { x: 620, z: -450, rx: 160, rz: 260, h: 46 };
export const STONES = { x: 618, z: -400 };
export const FOREST = { x: -430, z: 220, r: 250 };
export const BLOSSOM = { x: -262, z: -28, r: 75 };
export const LIGHTHOUSE = { x: 380, z: 505 };
export const WATCHTOWER = { x: 250, z: 250 };
export const BRIDGE = { x: 20, z: -242, length: 46, width: 5.2 };
export const VILLAGE = { x: 20, z: -230, r: 150 };
export const PIER = { x: -318, z: -282 };

/** Rounded hills added on top of the rolling base terrain. */
export const HILLS = [
  { x: START.x, z: START.z, r: 62, h: 30 },
  { x: WINDMILL.x, z: WINDMILL.z, r: 85, h: 21 },
  { x: WATCHTOWER.x, z: WATCHTOWER.z, r: 80, h: 25 },
  { x: BLOSSOM.x, z: BLOSSOM.z, r: 70, h: 9 },
  { x: -120, z: 260, r: 120, h: 14 },
  { x: -560, z: 40, r: 110, h: 20 },
];
/** Added after the sea and lake are carved, so they rise out of the water. */
export const LATE_HILLS = [
  { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 85, h: 30 },
  { x: ISLAND.x, z: ISLAND.z, r: 26, h: 11 },
  { x: -180, z: 600, r: 60, h: 18 },
];

export type Pt = [number, number];

/** The same boundary drives wall masonry, terrain, paving, NPCs and scatter. */
export const SOUTH_GATE_ANGLE = Math.PI / 2;
export const EAST_GATE_ANGLE = Math.PI / 5;
export const WALL_SEGMENTS = 28;
const rawCityRadius = (a: number): number => CITY.wall *
  (1 + 0.16 * Math.sin(a * 3 + 0.4) + 0.105 * Math.cos(a * 2 - 0.7) + 0.045 * Math.sin(a * 7));
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
export function cityGate(a: number): { x: number; z: number } {
  // The two vertices deliberately bracketing the gate form one complete wall segment.
  const p = cityWallPolygon[wallAngles.indexOf(a - 0.12)];
  const q = cityWallPolygon[wallAngles.indexOf(a + 0.12)];
  return { x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2 };
}
export const SOUTH_GATE = cityGate(SOUTH_GATE_ANGLE);
export const EAST_GATE = cityGate(EAST_GATE_ANGLE);
export const ABBEY = { x: -600, z: -495, floor: 64, halfWidth: 18, halfLength: 37, entranceZ: -458, tower: 89 };

export function smooth(points: Pt[], perSegment = 8): Pt[] {
  const curve = new THREE.SplineCurve(points.map(([x, z]) => new THREE.Vector2(x, z)));
  return curve.getPoints((points.length - 1) * perSegment).map((p) => [p.x, p.y] as Pt);
}

/** Alternating broad meanders and tight bends; one surveyed straight crossing at the village. */
export const RIVER: Pt[] = smooth([
  [-335, -300], [-290, -278], [-245, -291], [-192, -258], [-143, -269], [-91, -250],
  [-42, -237], [20, -242], [72, -238], [126, -207], [193, -232], [252, -210],
  [310, -183], [374, -201], [432, -169], [454, -116], [509, -74], [570, -55],
  [603, 8], [572, 75], [602, 151], [654, 207], [646, 271], [599, 333],
  [608, 410], [579, 467], [603, 548], [610, 665],
]);
export function lakeRadiusAt(a: number): number {
  // Eastern shore remains a quiet bay for the existing pier.
  return 1 + 0.11 * Math.sin(3 * a + 0.6) + 0.075 * Math.cos(5 * a - 0.7) + 0.04 * Math.sin(8 * a);
}
export function lakeMetric(x: number, z: number): number {
  const dx = (x - LAKE.x) / LAKE.rx, dz = (z - LAKE.z) / LAKE.rz;
  return Math.hypot(dx, dz) / lakeRadiusAt(Math.atan2(dz, dx));
}
export const riverWidthAt = (x: number, z: number): number =>
  8.3 + 2.1 * Math.sin(x * 0.019 + z * 0.014) + 1.5 * Math.sin(x * 0.043 - z * 0.021);

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
export const ROADS: Road[] = [
  road('start-village', 'dirt', 3.9, [[2, 92], [-17, 50], [-38, 15], [-17, -28], [25, -65], [33, -109], [12, -150], [5, -180], [20, -205], [20, -219]]),
  road('river-bridge', 'cobble', 4.7, [[20, -219], [20, -265]], true),
  road('village-city', 'dirt', 4.3, [[20, -265], [37, -292], [18, -330], [38, -364], [90, -390], [112, -424], [SOUTH_GATE.x, SOUTH_GATE.z]]),
  road('mill-road', 'dirt', 3.2, [[12, -150], [63, -136], [96, -105], [149, -114], [198, -95], [230, -61], [276, -62], [318, -88], [334, -84]]),
  road('lake-road', 'dirt', 3.0, [[5, -180], [-48, -187], [-90, -204], [-147, -205], [-189, -224], [-231, -231], [-260, -257], [-283, -245], [-298, -249], [-300, -261], [-300, -282]]),
  road('coastal-trail', 'dirt', 2.8, [[6, 90], [56, 108], [83, 152], [148, 176], [185, 220], [237, 258], [265, 287], [303, 337], [312, 388], [354, 426], [376, 492]]),
  road('grove-trail', 'dirt', 2.4, [[-6, 92], [-62, 89], [-107, 57], [-165, 39], [-209, -2], [-242, -16], [-288, 14], [-306, 74], [-363, 103], [-386, 160], [-420, 200]]),
  road('highland-road', 'dirt', 3.0, [[EAST_GATE.x, EAST_GATE.z], [309, -506], [340, -473], [393, -490], [444, -465], [471, -417], [527, -397], [579, -420], [608, -410]]),
  road('abbey-pilgrimage', 'dirt', 2.8, [[-300, -282], [-299, -334], [-325, -391], [-383, -426], [-460, -436], [-507, -456], [-535, -486], [-558, -486], [-572, -450], [-600, -450]]),
  road('field-path', 'dirt', 2.2, [[-48, -187], [-59, -157], [-80, -135], [-70, -102], [-37, -71], [-17, -28]]),
  road('north-hamlets', 'dirt', 2.5, [[-626, -713], [-602, -686], [-582, -676], [-561, -641], [-546, -596], [-549, -542], [-540, -490], [-553, -435], [-580, -407], [-600, -411], [-600, -450]]),
  road('west-hamlet', 'dirt', 2.4, [[-770, -400], [-749, -375], [-710, -369], [-678, -343], [-640, -350], [-613, -319], [-603, -263], [-582, -206], [-529, -172], [-465, -157], [-403, -169], [-334, -211], [-300, -249]]),
  road('east-hamlet', 'dirt', 2.3, [[-478, -432], [-495, -448], [-516, -446], [-535, -464], [-535, -486]]),
  ...CITY_STREETS,
];

/** Cobbled squares: [x, z, radius]. */
export const PLAZAS: [number, number, number][] = [
  [16, -196, 11], [CITY.x + 18, CITY.z + 100, 12], [CITY.x, CITY.z, CITY.plateau - 5],
];
export interface Field {
  x: number; z: number; w: number; d: number; rot: number;
  crop: 'wheat' | 'tilled' | 'cabbage' | 'lavender';
}
export const FIELDS: Field[] = [
  { x: -115, z: -157, w: 43, d: 26, rot: 0.19, crop: 'wheat' },
  { x: -164, z: -167, w: 36, d: 32, rot: -0.11, crop: 'tilled' },
  { x: -116, z: -116, w: 42, d: 25, rot: 0.32, crop: 'cabbage' },
  { x: 268, z: -22, w: 52, d: 34, rot: -0.24, crop: 'wheat' },
  { x: 307, z: -139, w: 43, d: 26, rot: 0.37, crop: 'lavender' },
  { x: 398, z: -48, w: 36, d: 36, rot: 0.13, crop: 'tilled' },
  { x: -70, z: -343, w: 40, d: 27, rot: -0.27, crop: 'wheat' },
  { x: 151, z: -158, w: 41, d: 24, rot: -0.08, crop: 'cabbage' },
  { x: 204, z: -155, w: 31, d: 24, rot: 0.35, crop: 'wheat' },
  { x: -200, z: -119, w: 38, d: 25, rot: -0.31, crop: 'lavender' },
  { x: 159, z: -332, w: 36, d: 26, rot: 0.32, crop: 'tilled' },
  { x: 219, z: -308, w: 42, d: 29, rot: -0.18, crop: 'wheat' },
];
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
  { name: '启程丘', sub: 'Setting-Out Hill', x: START.x, z: START.z, r: 80 },
  { name: '河谷村', sub: 'Riverbend Village', x: VILLAGE.x, z: VILLAGE.z, r: 120 },
  { name: '风车丘', sub: 'Windmill Rise', x: WINDMILL.x, z: WINDMILL.z, r: 90 },
  { name: '云瀑修道院', sub: 'Cloudfall Abbey', x: ABBEY.x, z: ABBEY.z, r: 90 },
  { name: '高城', sub: 'Hightown', x: CITY.x, z: CITY.z, r: CITY.wall + 10 },
  { name: '镜湖', sub: 'Mirror Lake', x: LAKE.x, z: LAKE.z, r: 170 },
  { name: '低语林', sub: 'Whisperwood', x: FOREST.x, z: FOREST.z, r: 210 },
  { name: '花谷', sub: 'Petal Hollow', x: BLOSSOM.x, z: BLOSSOM.z, r: 80 },
  { name: '望海岬', sub: 'Lighthouse Cape', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 95 },
  { name: '旧瞭望塔', sub: 'The Old Watch', x: WATCHTOWER.x, z: WATCHTOWER.z, r: 70 },
  { name: '石阵高地', sub: 'Standing Stones', x: PLATEAU.x, z: PLATEAU.z, r: 190 },
];
