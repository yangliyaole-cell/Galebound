import { ABBEY, CITY, FOREST, LIGHTHOUSE } from '../world/layout';

/**
 * The way into the game. The title is drawn over the live world: the traveller stands in the
 * foreground looking out at a chosen vista, the camera low behind one shoulder. Choosing another
 * vista swings the view (and the traveller) round to it. Setting off eases the camera from that
 * framing into the normal follow view, so the title dissolves into play without a cut, and the
 * traveller starts out facing the place they were looking at.
 */

export interface Vista {
  id: string;
  name: string;
  sub: string;
  /** A short line shown under the title while this vista is chosen. */
  line: string;
  x: number;
  z: number;
}

export const VISTAS: Vista[] = [
  { id: 'city', name: '高城', sub: 'Hightown', line: '石阶层叠，城头的钟声随风而来。', x: CITY.x, z: CITY.z },
  { id: 'abbey', name: '云瀑修道院', sub: 'Cloudfall Abbey', line: '崖顶的尖塔，守着云里落下的水。', x: ABBEY.x, z: ABBEY.z },
  { id: 'cape', name: '望海岬', sub: 'Lighthouse Cape', line: '海风从岬角吹来，带着盐和远方。', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z },
  { id: 'wood', name: '低语林', sub: 'Whisperwood', line: '林间的叶子，彼此说着悄悄话。', x: FOREST.x, z: FOREST.z },
];

export interface EntryPrefs {
  vista: string;
  /** Start in the walking gait instead of running. */
  walk: boolean;
  /** Look sensitivity multiplier. */
  look: number;
}

const PREFS_KEY = 'galebound.entry';
const DEFAULTS: EntryPrefs = { vista: 'city', walk: false, look: 1 };

export function loadPrefs(): EntryPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<EntryPrefs>;
    return {
      vista: VISTAS.some((v) => v.id === raw.vista) ? raw.vista! : DEFAULTS.vista,
      walk: typeof raw.walk === 'boolean' ? raw.walk : DEFAULTS.walk,
      look: typeof raw.look === 'number' && Number.isFinite(raw.look) ? Math.max(0.5, Math.min(2, raw.look)) : DEFAULTS.look,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: EntryPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
}

interface Lens {
  aspect: number;
  setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void;
  clearViewOffset(): void;
}
interface Follow { yaw: number; pitch: number; distance: number; camera: Lens }
interface Body { pos: { x: number; z: number }; yaw: number }

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class EntryDirector {
  private vista: Vista;
  private time = 0;
  private intro = -1;
  private from = { yaw: 0, pitch: 0, distance: 0 };
  private to = { pitch: 0.16, distance: 6 };
  /** Where the traveller sits on screen, as a fraction of the frame (0,0 = centre; +x right, +y down). */
  private shift = { x: 0, y: 0 };
  private shiftFrom = { x: 0, y: 0 };

  /**
   * Off-centre framing. The follow camera always looks straight at the traveller; shifting the
   * projection window instead keeps that, but lets the figure stand to one side of the title
   * (desktop: left of the setup panel; phone portrait: between the title and the bottom sheet).
   */
  /** The screen's aspect, not the camera's (which a view offset overwrites). */
  private aspect(lens: Lens): number {
    const screen = typeof window === 'undefined' ? 0 : window.innerWidth / Math.max(1, window.innerHeight);
    return Number.isFinite(screen) && screen > 0 ? screen : lens.aspect;
  }

  private frame(lens: Lens, x: number, y: number): void {
    this.shift.x = x;
    this.shift.y = y;
    if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) {
      lens.clearViewOffset();
      return;
    }
    // Moving the projection window one way moves the picture (and the traveller) the other.
    // setViewOffset also sets aspect = fullWidth / fullHeight, so the full frame must keep the
    // screen's own proportions (main.ts resets aspect on resize; this re-applies every frame).
    const h = 1000, w = h * this.aspect(lens);
    lens.setViewOffset(w, h, -x * w, -y * h, w, h);
  }

  constructor(vistaId: string) {
    this.vista = VISTAS.find((v) => v.id === vistaId) ?? VISTAS[0];
  }

  choose(vistaId: string): void {
    this.vista = VISTAS.find((v) => v.id === vistaId) ?? this.vista;
  }

  /** Heading from the traveller to the chosen vista (the game's yaw: 0 faces +Z). */
  private heading(body: Body): number {
    return Math.atan2(this.vista.x - body.pos.x, this.vista.z - body.pos.z);
  }

  /** Title framing: low over the shoulder, the traveller turned toward the vista. */
  title(dt: number, follow: Follow, body: Body, setup: boolean): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 1.6);
    const portrait = this.aspect(follow.camera) < 1;
    // x right, y down; the figure stands clear of the title and the setup panel.
    const want = portrait ? { x: 0, y: setup ? -0.2 : 0.15 } : { x: setup ? -0.2 : -0.18, y: 0.1 };
    this.frame(follow.camera, this.shift.x + (want.x - this.shift.x) * k, this.shift.y + (want.y - this.shift.y) * k);
    const face = this.heading(body);
    body.yaw += wrap(face - body.yaw) * (1 - Math.exp(-dt * 2.2));
    // Behind and a little to the right of the traveller, drifting slowly like a held breath.
    const yaw = face + Math.PI + 0.42 + Math.sin(this.time * 0.11) * 0.1;
    follow.yaw += wrap(yaw - follow.yaw) * k;
    follow.pitch += (0.03 + Math.sin(this.time * 0.07) * 0.02 - follow.pitch) * k;
    // A tall phone screen pulls back a little so the figure fits above the setup sheet.
    follow.distance += ((portrait ? 5.4 : 4.3) - follow.distance) * k;
  }

  /** Begin the hand-over to play. The traveller keeps facing the vista. */
  depart(follow: Follow, gameplay: { pitch: number; distance: number }): void {
    this.intro = 0;
    this.from = { yaw: follow.yaw, pitch: follow.pitch, distance: follow.distance };
    this.shiftFrom = { ...this.shift };
    this.to = gameplay;
  }

  /** While the camera settles behind the traveller. Returns false once play has the camera. */
  settle(dt: number, follow: Follow, body: Body, looked: boolean): boolean {
    if (this.intro < 0) return false;
    if (looked) {
      // The player took the view: hand it over at once, wherever it is.
      this.intro = -1;
      this.frame(follow.camera, 0, 0);
      return false;
    }
    this.intro += dt / 1.9;
    const t = ease(this.intro);
    this.frame(follow.camera, this.shiftFrom.x * (1 - t), this.shiftFrom.y * (1 - t));
    const behind = body.yaw + Math.PI;
    follow.yaw = this.from.yaw + wrap(behind - this.from.yaw) * t;
    follow.pitch = this.from.pitch + (this.to.pitch - this.from.pitch) * t;
    follow.distance = this.from.distance + (this.to.distance - this.from.distance) * t;
    if (this.intro >= 1) this.intro = -1;
    return this.intro >= 0;
  }

  get current(): Vista {
    return this.vista;
  }
}
