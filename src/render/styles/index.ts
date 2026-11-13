import type * as THREE from 'three';
import type { Quality } from '../../core/quality';

export const STYLE_NAMES = ['default', 'ghibli', 'cinematic', 'watercolor', 'lowpoly-dusk'] as const;
export type StyleName = typeof STYLE_NAMES[number];
export const styleName = (name: string | null): StyleName =>
  STYLE_NAMES.includes(name as StyleName) ? name as StyleName : 'default';

export interface StyleContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  sky: THREE.Group;
  quality: Quality;
  heavy: boolean;
}

export interface StylePipeline {
  readonly extraPasses: number;
  apply(name: StyleName): void;
  render(): void;
  resize(): void;
}

/** The default path never imports effects or touches world materials. */
export function createStyleController(context: StyleContext, announce: (name: string) => void) {
  let current: StyleName = 'default';
  let requested: StyleName = current;
  let generation = 0;
  let pipeline: StylePipeline | undefined;
  let loading: Promise<StylePipeline> | undefined;
  return {
    get current() { return current; },
    get pipeline() { return current === 'default' ? undefined : pipeline; },
    get names() { return STYLE_NAMES; },
    async set(value: string, notify = true): Promise<void> {
      const name = styleName(value);
      requested = name;
      const ticket = ++generation;
      if (name !== 'default') {
        loading ??= import('./pipeline').then(({ createPipeline }) => createPipeline(context)).catch((error: unknown) => {
          loading = undefined;
          throw error;
        });
        pipeline = await loading;
      }
      if (ticket !== generation) return;
      if (name !== current) {
        pipeline?.apply(name);
        current = name;
      }
      if (notify) announce(name);
    },
    next(): Promise<void> {
      return this.set(STYLE_NAMES[(STYLE_NAMES.indexOf(requested) + 1) % STYLE_NAMES.length]);
    },
    resize(): void { pipeline?.resize(); },
  };
}
export type StyleController = ReturnType<typeof createStyleController>;
