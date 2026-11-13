import type { Tier } from '../../core/quality';

/** Independent of postprocessing/exposure. No PBR work is allocated on low. */
export const PBR_TIERS = {
  low: { layers: 0, triplanar: false, environmentSize: 0, environmentIntensity: 0, cascades: 0, shadowSize: 0, shadowFar: 0, contactSize: 0 },
  medium: { layers: 3, triplanar: true, environmentSize: 128, environmentIntensity: 0.16, cascades: 2, shadowSize: 2048, shadowFar: 240, contactSize: 1024 },
  high: { layers: 5, triplanar: true, environmentSize: 512, environmentIntensity: 0.2, cascades: 3, shadowSize: 4096, shadowFar: 720, contactSize: 2048 },
} as const;
let tier: Tier = 'low';
export const configurePbr = (value: Tier): void => { tier = value; };
export const pbrTier = (): Tier => tier;
