import * as THREE from 'three';

/**
 * The map. North is -Z, east is +X. All distances in metres.
 * Everything that decides where things are lives here.
 */
export const SIZE = 2048;
export const HALF = SIZE / 2;
export const WATER_LEVEL = 0;

export const START = { x: 0, z: 100 };
export const CITY = { x: 120, z: -640, wall: 175, hill: 250, plateau: 38, top: 68 };
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
  { x: START.x, z: START.z, r: 95, h: 22 },
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

type Pt = [number, number];

function smooth(points: Pt[], perSegment = 10): Pt[] {
  const curve = new THREE.SplineCurve(points.map(([x, z]) => new THREE.Vector2(x, z)));
  return curve.getPoints((points.length - 1) * perSegment).map((p) => [p.x, p.y] as Pt);
}

/** The river runs from the lake eastward, then south to the sea. */
export const RIVER: Pt[] = smooth([
  [-335, -300], [-200, -262], [-80, -238], [20, -242], [140, -228], [260, -215],
  [400, -190], [520, -120], [600, 0], [640, 160], [612, 330], [600, 480], [605, 660],
]);

export interface Road {
  kind: 'dirt' | 'cobble';
  width: number;
  pts: Pt[];
}

function cityStreets(): Road[] {
  const { x, z, wall } = CITY;
  // Main street spirals from the south gate up to the castle gate on the west side.
  const spiral: Pt[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = Math.PI / 2 + t * Math.PI * 2.5;
    const r = wall - 4 - t * (wall - 4 - 44);
    spiral.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  const ring: Pt[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([x + Math.cos(a) * 118, z + Math.sin(a) * 118]);
  }
  const eastGate: Pt = [x + Math.cos(0.52) * wall, z + Math.sin(0.52) * wall];
  return [
    { kind: 'cobble', width: 6, pts: spiral },
    { kind: 'cobble', width: 4.5, pts: ring },
    { kind: 'cobble', width: 6, pts: [[x, z + wall + 6], [x, z + 108]] },
    { kind: 'cobble', width: 5, pts: [eastGate, [x + Math.cos(0.52) * 112, z + Math.sin(0.52) * 112]] },
  ];
}

export const EAST_GATE_ANGLE = 0.52;
export const SOUTH_GATE_ANGLE = Math.PI / 2;

export const ROADS: Road[] = [
  { kind: 'dirt', width: 3.6, pts: smooth([[2, 92], [6, 40], [-12, -20], [2, -90], [12, -150], [20, -205], [20, -220]]) },
  { kind: 'cobble', width: 5, pts: [[20, -218], [20, -266]] },
  { kind: 'dirt', width: 3.6, pts: smooth([[20, -264], [28, -300], [52, -350], [92, -410], [116, -450], [120, -472]]) },
  { kind: 'dirt', width: 3, pts: smooth([[12, -150], [80, -150], [160, -128], [250, -105], [318, -88], [334, -84]]) },
  { kind: 'dirt', width: 3, pts: smooth([[18, -200], [-50, -208], [-140, -216], [-230, -238], [-296, -264], [-316, -280]]) },
  { kind: 'dirt', width: 2.6, pts: smooth([[6, 90], [60, 130], [140, 190], [215, 235], [246, 250], [300, 330], [350, 430], [376, 492]]) },
  { kind: 'dirt', width: 2.6, pts: smooth([[-6, 92], [-70, 70], [-160, 20], [-240, -20], [-300, 40], [-360, 120], [-420, 200]]) },
  { kind: 'dirt', width: 3, pts: smooth([[272, -553], [330, -520], [400, -480], [470, -455], [540, -430], [608, -410]]) },
  ...cityStreets(),
];

/** Cobbled squares: [x, z, radius]. */
export const PLAZAS: [number, number, number][] = [
  [16, -196, 11],
  [CITY.x, CITY.z + 108, 16],
  [CITY.x, CITY.z, CITY.plateau + 2],
];

export interface Field {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  crop: 'wheat' | 'tilled' | 'cabbage';
}

export const FIELDS: Field[] = [
  { x: -96, z: -166, w: 46, d: 30, rot: 0.12, crop: 'wheat' },
  { x: -152, z: -160, w: 40, d: 34, rot: 0.12, crop: 'tilled' },
  { x: -104, z: -122, w: 50, d: 26, rot: 0.08, crop: 'cabbage' },
  { x: 268, z: -52, w: 60, d: 40, rot: -0.2, crop: 'wheat' },
  { x: 300, z: -146, w: 50, d: 30, rot: 0.3, crop: 'wheat' },
  { x: 398, z: -48, w: 36, d: 36, rot: 0.1, crop: 'tilled' },
  { x: -62, z: -332, w: 44, d: 30, rot: -0.2, crop: 'wheat' },
];

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
  { name: '高城', sub: 'Hightown', x: CITY.x, z: CITY.z, r: CITY.wall + 10 },
  { name: '镜湖', sub: 'Mirror Lake', x: LAKE.x, z: LAKE.z, r: 170 },
  { name: '低语林', sub: 'Whisperwood', x: FOREST.x, z: FOREST.z, r: 210 },
  { name: '花谷', sub: 'Petal Hollow', x: BLOSSOM.x, z: BLOSSOM.z, r: 80 },
  { name: '望海岬', sub: 'Lighthouse Cape', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 95 },
  { name: '旧瞭望塔', sub: 'The Old Watch', x: WATCHTOWER.x, z: WATCHTOWER.z, r: 70 },
  { name: '石阵高地', sub: 'Standing Stones', x: PLATEAU.x, z: PLATEAU.z, r: 190 },
];
