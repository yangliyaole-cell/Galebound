import type * as THREE from 'three';

export interface ShotStatus {
  phase: 'building' | 'rendering' | 'ready' | 'error';
  completedFrames: number;
  error?: string;
}

/** The world and camera already settle for 90 simulation steps before rendering.
 * The current composer has no temporal history: two complete output frames cover
 * lazy shader compilation/shadow upload without 24 identical expensive redraws. */
export function createShotState(requiredFrames = 2): {
  status: ShotStatus; drew(): void; complete(flush: () => void): boolean; fail(reason: unknown): void;
} {
  const status: ShotStatus = { phase: 'building', completedFrames: 0 }; let drew = false;
  return {
    status,
    drew() { if (status.phase !== 'error' && status.phase !== 'ready') { drew = true; status.phase = 'rendering'; } },
    complete(flush) {
      if (!drew || status.phase === 'error' || status.phase === 'ready') return false;
      drew = false; status.completedFrames++;
      if (status.completedFrames < requiredFrames) return false;
      try { flush(); status.phase = 'ready'; return true; }
      catch (error) { this.fail(error); return false; }
    },
    fail(reason) { status.phase = 'error'; status.error = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason); },
  };
}

let markDraw: ((renderer: THREE.WebGLRenderer) => void) | undefined;

/** Capture-only RAF boundary. Installed from an owned scene module, before boot;
 * no game-loop or render-style file changes. Never active in normal play. */
export function installShotCapture(): void {
  if (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('shot') !== '1') return;
  const debug = window as unknown as Record<string, unknown>;
  if (debug.__galeShotStatus) return;
  const requested = Number(new URLSearchParams(window.location.search).get('shotwarmup') ?? 2);
  const state = createShotState(Number.isFinite(requested) ? Math.max(2, Math.min(24, Math.round(requested))) : 2);
  debug.__galeShotStatus = state.status;
  const nativeRAF = window.requestAnimationFrame;
  let renderer: THREE.WebGLRenderer | undefined, timer: ReturnType<typeof setTimeout>;
  const fail = (reason: unknown): void => {
    state.fail(reason); debug.__galeShotReady = false; debug.__galeShotError = state.status.error;
    window.requestAnimationFrame = nativeRAF; clearTimeout(timer);
  };
  window.addEventListener('error', (event) => fail(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => fail(event.reason));
  window.addEventListener('webglcontextlost', () => fail('WebGL context lost during shot'), true);
  markDraw = (value) => { renderer = value; state.drew(); };
  window.requestAnimationFrame = (callback) => nativeRAF.call(window, (time) => {
    try {
      callback(time);
      if (debug.__galeShotError) { fail(debug.__galeShotError); return; }
      if (state.complete(() => {
        if (!renderer || renderer.getContext().isContextLost()) throw new Error('Shot renderer lost its context');
        renderer.getContext().finish();
      })) {
        debug.__galeShotReady = true;
        window.requestAnimationFrame = nativeRAF; clearTimeout(timer);
      }
      if (state.status.phase === 'error') fail(state.status.error);
    } catch (error) { fail(error); throw error; }
  });
  timer = setTimeout(() => fail(`Shot stalled in ${state.status.phase}, completed frames=${state.status.completedFrames}, hidden=${document.hidden}`), 180_000);
}

export function observeShotDraws(group: THREE.Group): void {
  if (!markDraw) return;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const before = mesh.onBeforeRender;
    mesh.onBeforeRender = function (...args) { before.apply(this, args); markDraw?.(args[0]); };
  });
}
