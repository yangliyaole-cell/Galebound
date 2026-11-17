/** Keys the game uses; with Ctrl held, their browser shortcuts (save, bookmark, select all…) are blocked. */
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** A Ctrl press shorter than this, with no other key, toggles walking. */
const CTRL_TAP_MS = 280;
/** Touch: a right-side touch released this quickly without travelling is a tap (jump / fly). */
const TAP_MS = 260;
const TAP_TRAVEL = 10;
/** Stick deflection (0..1) beyond which the gait changes from walk to run. */
const RUN_PUSH = 0.62;

/**
 * Keyboard, mouse, touch and gamepad folded into one set of controls.
 * Desktop: WASD runs; hold Ctrl to walk, tap Ctrl to keep walking (tap again to run).
 * Touch, with no on-screen buttons: a finger on the left half becomes a floating stick where it
 * lands (a short push walks, a long push runs); on the right half a tap jumps (and in the air
 * opens the cloths), a swipe turns the view and two fingers pinch to zoom.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  run = false;
  /** Held Shift (or a shoulder trigger): in a glide, tuck the arms in and fly faster. */
  boost = false;
  /** True once any touch has been seen, so the HUD can show touch buttons. */
  touch = window.matchMedia('(pointer: coarse)').matches;

  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;
  /** Walking gait locked on by a Ctrl tap (or the title-screen preference). */
  private walkLock = false;
  private ctrlDown = false;
  private ctrlAt = 0;
  private ctrlUsed = false;
  /** Stick gait, with a little hysteresis so it does not flicker at the threshold. */
  private stickRun = false;
  /** Look-pointer taps: start time, travel and whether it ever joined a pinch. */
  private readonly taps = new Map<number, { t: number; travel: number; pinched: boolean }>();
  /** Multiplier on mouse/touch look speed (set from the title screen). */
  lookSpeed = 1;
  /** Called when a Ctrl tap toggles the walking gait. */
  onWalkToggle: (walking: boolean) => void = () => {};

  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private readonly lookPointers = new Map<number, { x: number; y: number }>();
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private rebaseMouse = false;
  private rebaseLook = false;
  private active = !document.hidden;
  private padJump = false;
  private padReady = false;
  private pinch = 0;

  private readonly base = document.createElement('div');
  private readonly knob = document.createElement('div');

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.base.className = 'stick-base';
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      // Walking with Ctrl held must not save the page, bookmark it or select everything.
      // (Ctrl+W itself is reserved by browsers; the unload guard below catches it.)
      if (e.ctrlKey && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        if (!this.ctrlDown) {
          this.ctrlDown = true;
          this.ctrlAt = performance.now();
          this.ctrlUsed = false;
        }
      } else if (this.ctrlDown) {
        this.ctrlUsed = true;
      }
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        if (this.ctrlDown && !this.ctrlUsed && performance.now() - this.ctrlAt < CTRL_TAP_MS && this.active) {
          this.walkLock = !this.walkLock;
          this.onWalkToggle(this.walkLock);
        }
        this.ctrlDown = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
      }
    });
    // While Ctrl is held for walking, a stray W would close the tab (browsers reserve Ctrl+W).
    // Ask before leaving in that case only, so normal reloads stay silent.
    window.addEventListener('beforeunload', (e) => {
      if (this.ctrlDown && this.active) e.preventDefault();
    });
    // In fullscreen, Chromium lets a page keep W/T/N even with Ctrl held.
    document.addEventListener('fullscreenchange', () => {
      const keyboard = (navigator as Navigator & { keyboard?: { lock?: (codes: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
      if (document.fullscreenElement) keyboard?.lock?.(['KeyW', 'KeyT', 'KeyN', 'KeyA', 'KeyS', 'KeyD'])?.catch?.(() => {});
      else keyboard?.unlock?.();
    });
    window.addEventListener('blur', () => {
      this.active = false;
      this.reset();
    });
    window.addEventListener('focus', () => { this.active = !document.hidden; });
    document.addEventListener('visibilitychange', () => {
      this.active = !document.hidden && document.hasFocus();
      this.reset();
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouseDown = false;
      this.lookX = this.lookY = 0;
      // Chrome may report a warp on the first event after a lock transition.
      this.rebaseMouse = true;
    });

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('lostpointercapture', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => {
      this.zoomDelta += e.deltaY * 0.004;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private reset(): void {
    this.keys.clear();
    this.jumpQueued = false;
    this.lookX = this.lookY = this.zoomDelta = 0;
    this.mouseDown = false;
    this.rebaseMouse = true;
    this.stickId = -1;
    this.stickX = this.stickY = 0;
    this.lookPointers.clear();
    this.taps.clear();
    this.ctrlDown = false;
    this.stickRun = false;
    this.pinch = 0;
    this.rebaseLook = false;
    this.padJump = this.padReady = false;
    this.moveX = this.moveY = 0;
    this.run = this.boost = false;
    this.base.style.display = 'none';
    this.base.className = 'stick-base';
  }

  private addLook(dx: number, dy: number): void {
    // Reject coordinate warps, rather than turning them into a large capped turn.
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) > 1.5) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  private pinchDistance(): number {
    if (this.lookPointers.size < 2) return 0;
    const [a, b] = this.lookPointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private down(e: PointerEvent): void {
    if (!this.active) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.rebaseMouse = false;
      this.canvas.setPointerCapture(e.pointerId);
      // Locking the pointer gives proper mouse-look; dragging still works without it.
      if (document.pointerLockElement !== this.canvas) {
        try {
          this.canvas.requestPointerLock?.()?.catch(() => {});
        } catch {
          // Browsers may reject pointer lock; absolute-coordinate dragging still works.
        }
      }
      return;
    }
    this.touch = true;
    this.canvas.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.5 && e.clientY > window.innerHeight * 0.1) {
      // A second finger in the stick region must not become a look finger.
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      this.stickX = this.stickY = 0;
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.stickRun = false;
      this.base.className = 'stick-base';
    } else {
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.taps.set(e.pointerId, { t: performance.now(), travel: 0, pinched: this.lookPointers.size > 1 });
      if (this.lookPointers.size > 1) for (const tap of this.taps.values()) tap.pinched = true;
      this.pinch = this.pinchDistance();
      this.rebaseLook = false;
    }
  }

  private move(e: PointerEvent): void {
    if (!this.active) return;
    if (e.pointerType === 'mouse') {
      const locked = document.pointerLockElement === this.canvas;
      if (locked || this.mouseDown) {
        const dx = locked ? e.movementX : e.clientX - this.mouseX;
        const dy = locked ? e.movementY : e.clientY - this.mouseY;
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        if (this.rebaseMouse) {
          this.rebaseMouse = false;
          return;
        }
        this.addLook(dx * 0.0026, dy * 0.0026);
      }
      return;
    }
    if (e.pointerId === this.stickId) {
      const max = 56;
      let dx = e.clientX - this.stickOriginX;
      let dy = e.clientY - this.stickOriginY;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx *= max / d;
        dy *= max / d;
      }
      this.stickX = dx / max;
      this.stickY = -dy / max;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const push = Math.min(1, d / max);
      const run = this.stickRun ? push > RUN_PUSH - 0.06 : push > RUN_PUSH;
      if (run !== this.stickRun) {
        this.stickRun = run;
        this.base.className = run ? 'stick-base run' : 'stick-base';
      }
      return;
    }
    const p = this.lookPointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const tap = this.taps.get(e.pointerId);
    if (tap && Number.isFinite(dx) && Number.isFinite(dy)) tap.travel += Math.hypot(dx, dy);
    if (this.lookPointers.size >= 2) {
      // Keep every pointer's baseline current; extra fingers never rotate the view.
      const d = this.pinchDistance();
      if (this.pinch > 0) this.zoomDelta -= (d - this.pinch) * 0.012;
      this.pinch = d;
      return;
    }
    if (this.rebaseLook) {
      this.rebaseLook = false;
      return;
    }
    this.addLook(dx * 0.0052, dy * 0.0052);
  }

  private up(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.mouseDown = false;
      return;
    }
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.stickX = this.stickY = 0;
      this.stickRun = false;
      this.base.style.display = 'none';
      this.base.className = 'stick-base';
    }
    const tap = this.taps.get(e.pointerId);
    this.taps.delete(e.pointerId);
    // A quick, still touch on the right is a tap: jump, or open the cloths in the air.
    // Only a real lift-off counts; cancelled or captured-away pointers never jump.
    if (tap && e.type === 'pointerup' && this.active && !tap.pinched && tap.travel < TAP_TRAVEL
      && performance.now() - tap.t < TAP_MS) this.jumpQueued = true;
    if (this.lookPointers.delete(e.pointerId)) {
      this.pinch = this.pinchDistance();
      this.rebaseLook = this.lookPointers.size === 1;
    }
  }

  pressJump(): void {
    this.jumpQueued = true;
  }

  /** Keyboard walking gait, toggled by a Ctrl tap; also set from the title-screen preference. */
  get walking(): boolean {
    return this.walkLock;
  }

  set walking(on: boolean) {
    this.walkLock = on;
  }

  /** Call once per frame before reading the controls. */
  poll(dt: number): void {
    if (!this.active || document.hidden) {
      this.reset();
      return;
    }
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let boost = k.has('ShiftLeft') || k.has('ShiftRight');
    // Running is the default; Ctrl (held, or locked by a tap) walks. Shift always runs.
    let run = boost || !(this.ctrlDown || this.walkLock);

    if (this.stickId >= 0) {
      // A short push walks at a speed that follows the push; past the threshold it runs.
      const push = Math.hypot(this.stickX, this.stickY);
      if (push < 0.08) {
        x = y = 0;
        run = false;
      } else if (this.stickRun) {
        x = this.stickX / push;
        y = this.stickY / push;
        run = true;
      } else {
        const scale = Math.min(1, push / RUN_PUSH) / push;
        x = this.stickX * scale;
        y = this.stickY * scale;
        run = false;
      }
    }

    const pad = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected && p.mapping === 'standard');
    if (pad) {
      const dead = (v: number): number => Number.isFinite(v)
        ? Math.sign(v) * Math.max(0, Math.min(1, (Math.abs(v) - 0.16) / 0.84)) : 0;
      const ax = dead(pad.axes[0] ?? 0);
      const ay = dead(pad.axes[1] ?? 0);
      if (ax || ay) {
        x = ax;
        y = -ay;
        // Same as touch: a light push walks, a full push runs.
        run = Math.hypot(ax, ay) > 0.75;
      }
      this.lookX += dead(pad.axes[2] ?? 0) * dt * 2.6;
      this.lookY += dead(pad.axes[3] ?? 0) * dt * 1.8;
      if (pad.buttons[7]?.pressed || pad.buttons[5]?.pressed || pad.buttons[10]?.pressed) run = boost = true;
      const jump = !!pad.buttons[0]?.pressed;
      if (jump && !this.padJump && this.padReady) this.jumpQueued = true;
      this.padJump = jump;
      this.padReady = true;
    } else {
      this.padJump = this.padReady = false;
    }

    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.moveX = x;
    this.moveY = y;
    this.run = run;
    this.boost = boost;
  }

  takeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  takeLook(): [number, number] {
    // Bound a whole frame too: many individually valid events can arrive after a stall.
    const length = Math.hypot(this.lookX, this.lookY);
    const scale = length > 0.35 ? 0.35 / length : 1;
    const speed = Number.isFinite(this.lookSpeed) ? Math.max(0.3, Math.min(2.5, this.lookSpeed)) : 1;
    const out: [number, number] = [this.lookX * scale * speed, this.lookY * scale * speed];
    this.lookX = this.lookY = 0;
    return out;
  }

  takeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }
}
