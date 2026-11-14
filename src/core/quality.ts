/** Detail level that every subsystem (PBR, cape, sky, structures) understands. */
export type Tier = 'low' | 'medium' | 'high';
/** What the player picks. Ultra is the uncompromised picture; high keeps it but trims the costliest work. */
export type QualityName = Tier | 'ultra';
export const QUALITY_NAMES: QualityName[] = ['low', 'medium', 'high', 'ultra'];

export interface Quality {
  name: QualityName;
  /** Subsystem detail level: ultra and high both build the high-detail world. */
  tier: Tier;
  /** Cloth points on the hero's cape. */
  cape: Tier;
  /** Upper bound for the device pixel ratio. */
  pixelRatio: number;
  antialias: boolean;
  terrainCell: number;
  /** A terrain patch is replaced by four finer ones within this many of its own widths. */
  terrainSplit: number;
  splatSize: number;
  shadowSize: number;
  shadowRange: number;
  grassNear: number;
  grassFar: number;
  flowers: number;
  propRange: number;
  viewRange: number;
  outline: boolean;
  particles: number;
}

export const TIERS: Record<QualityName, Quality> = {
  // Lowest: runs anywhere; keeps a pleasant picture but nothing more.
  low: {
    name: 'low', tier: 'low', cape: 'low', pixelRatio: 1, antialias: false, terrainCell: 8, terrainSplit: 1.7, splatSize: 1024, shadowSize: 0,
    shadowRange: 0, grassNear: 7000, grassFar: 9000, flowers: 1200,
    propRange: 260, viewRange: 3200, outline: false, particles: 60,
  },
  // Smoothness first (phones included), then as much of the picture as fits.
  medium: {
    name: 'medium', tier: 'medium', cape: 'low', pixelRatio: 1.25, antialias: true, terrainCell: 4, terrainSplit: 2.3, splatSize: 2048, shadowSize: 1024,
    shadowRange: 55, grassNear: 12000, grassFar: 17000, flowers: 2600,
    propRange: 400, viewRange: 4500, outline: true, particles: 90,
  },
  // The high-detail world, with the costliest per-frame work trimmed: a lighter cape
  // solver (the main CPU cost), a lower render scale and somewhat less grass.
  high: {
    name: 'high', tier: 'high', cape: 'medium', pixelRatio: 1.5, antialias: true, terrainCell: 2, terrainSplit: 3.2, splatSize: 4096, shadowSize: 2048,
    shadowRange: 75, grassNear: 20000, grassFar: 28000, flowers: 5000,
    propRange: 600, viewRange: 9000, outline: true, particles: 150,
  },
  // Everything at full: only the optimisations needed to get in and keep moving.
  ultra: {
    name: 'ultra', tier: 'high', cape: 'high', pixelRatio: 2, antialias: true, terrainCell: 2, terrainSplit: 3.2, splatSize: 4096, shadowSize: 2048,
    shadowRange: 75, grassNear: 24000, grassFar: 36000, flowers: 6000,
    propRange: 700, viewRange: 9000, outline: true, particles: 180,
  },
};

const KEY = 'galebound.quality';

const isName = (v: unknown): v is QualityName => QUALITY_NAMES.includes(v as QualityName);

export function storedTier(): QualityName | 'auto' {
  try {
    const v = localStorage.getItem(KEY);
    if (isName(v)) return v;
  } catch {
    // Storage can be unavailable in private windows.
  }
  return 'auto';
}

export function storeTier(tier: QualityName | 'auto'): void {
  try {
    if (tier === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, tier);
  } catch {
    // Ignore: the choice just won't persist.
  }
}

function detect(): Tier {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (coarse) return cores >= 8 && memory >= 6 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export function pickQuality(): Quality {
  const param = new URLSearchParams(location.search).get('q');
  if (isName(param)) return TIERS[param];
  const stored = storedTier();
  return TIERS[stored === 'auto' ? detect() : stored];
}

/**
 * Lowers the render resolution when frames get slow and raises it again
 * when there is headroom.
 */
export class DynamicResolution {
  scale = 1;
  private frames = 0;
  private elapsed = 0;
  private readonly enabled = new URLSearchParams(location.search).get('dr') !== '0';

  constructor(private readonly apply: (scale: number) => void) {}

  tick(dt: number): void {
    if (!this.enabled) return;
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    let next = this.scale;
    if (fps < 42) next = Math.max(0.5, this.scale * 0.88);
    else if (fps > 57 && this.scale < 1) next = Math.min(1, this.scale * 1.07);
    if (next !== this.scale) {
      this.scale = next;
      this.apply(next);
    }
  }
}
