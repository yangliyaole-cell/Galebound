/**
 * Keyboard, mouse, touch and gamepad folded into one set of controls.
 * Touch: the left side of the screen is a floating joystick, the rest looks around.
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
  private runToggle = false;

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
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
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
    this.pinch = 0;
    this.rebaseLook = false;
    this.padJump = this.padReady = false;
    this.moveX = this.moveY = 0;
    this.run = this.boost = false;
    this.base.style.display = 'none';
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
    if (e.clientX < window.innerWidth * 0.45 && e.clientY > window.innerHeight * 0.25) {
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
    } else {
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
      return;
    }
    const p = this.lookPointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
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
      this.base.style.display = 'none';
    }
    if (this.lookPointers.delete(e.pointerId)) {
      this.pinch = this.pinchDistance();
      this.rebaseLook = this.lookPointers.size === 1;
    }
  }

  pressJump(): void {
    this.jumpQueued = true;
  }

  toggleRun(): boolean {
    this.runToggle = !this.runToggle;
    return this.runToggle;
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
    let run = boost || this.runToggle;

    if (this.stickId >= 0) {
      x = this.stickX;
      y = this.stickY;
      // Pushing the stick to its edge runs.
      if (Math.hypot(x, y) > 0.92) run = true;
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
    const out: [number, number] = [this.lookX * scale, this.lookY * scale];
    this.lookX = this.lookY = 0;
    return out;
  }

  takeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }
}
