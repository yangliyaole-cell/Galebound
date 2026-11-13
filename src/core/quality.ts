export type Tier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: Tier;
  /** Upper bound for the device pixel ratio. */
  pixelRatio: number;
  antialias: boolean;
  terrainCell: number;
  splatSize: number;
  shadowSize: number;
  shadowRange: number;
  grassNear: number;
  grassFar: number;
  flowers: number;
  treeDetailRange: number;
  propRange: number;
  viewRange: number;
  outline: boolean;
  particles: number;
}

const TIERS: Record<Tier, Quality> = {
  low: {
    tier: 'low', pixelRatio: 1, antialias: false, terrainCell: 8, splatSize: 1024, shadowSize: 0,
    shadowRange: 0, grassNear: 7000, grassFar: 9000, flowers: 1200, treeDetailRange: 120,
    propRange: 260, viewRange: 1100, outline: false, particles: 60,
  },
  medium: {
    tier: 'medium', pixelRatio: 1.5, antialias: true, terrainCell: 4, splatSize: 2048, shadowSize: 1024,
    shadowRange: 55, grassNear: 14000, grassFar: 20000, flowers: 3000, treeDetailRange: 220,
    propRange: 420, viewRange: 1500, outline: true, particles: 110,
  },
  high: {
    tier: 'high', pixelRatio: 2, antialias: true, terrainCell: 4, splatSize: 2048, shadowSize: 2048,
    shadowRange: 75, grassNear: 24000, grassFar: 36000, flowers: 6000, treeDetailRange: 340,
    propRange: 600, viewRange: 1800, outline: true, particles: 180,
  },
};

const KEY = 'galebound.quality';

export function storedTier(): Tier | 'auto' {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    // Storage can be unavailable in private windows.
  }
  return 'auto';
}

export function storeTier(tier: Tier | 'auto'): void {
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
  if (param === 'low' || param === 'medium' || param === 'high') return TIERS[param];
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
