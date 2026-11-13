/**
 * Keyboard, mouse, touch and gamepad folded into one set of controls.
 * Touch: the left side of the screen is a floating joystick, the rest looks around.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  run = false;
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
  private padJump = false;
  private pinch = 0;

  private readonly base = document.createElement('div');
  private readonly knob = document.createElement('div');

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.base.className = 'stick-base';
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => {
      this.zoomDelta += e.deltaY * 0.004;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.mouseDown = true;
      // Locking the pointer gives proper mouse-look; dragging still works without it.
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
      return;
    }
    this.touch = true;
    if (this.stickId < 0 && e.clientX < window.innerWidth * 0.45 && e.clientY > window.innerHeight * 0.25) {
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
      this.pinch = 0;
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement === this.canvas || this.mouseDown) {
        this.lookX += e.movementX * 0.0026;
        this.lookY += e.movementY * 0.0026;
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
    if (this.lookPointers.size === 2) {
      // Two fingers: pinch to zoom.
      const [a, b] = [...this.lookPointers.values()];
      p.x = e.clientX;
      p.y = e.clientY;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.zoomDelta -= (d - this.pinch) * 0.012;
      this.pinch = d;
      return;
    }
    this.lookX += (e.clientX - p.x) * 0.0052;
    this.lookY += (e.clientY - p.y) * 0.0052;
    p.x = e.clientX;
    p.y = e.clientY;
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
    this.lookPointers.delete(e.pointerId);
    this.pinch = 0;
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
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let run = k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle;

    if (this.stickId >= 0) {
      x = this.stickX;
      y = this.stickY;
      // Pushing the stick to its edge runs.
      if (Math.hypot(x, y) > 0.92) run = true;
    }

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const dead = (v: number): number => (Math.abs(v) < 0.16 ? 0 : v);
      const ax = dead(pad.axes[0] ?? 0);
      const ay = dead(pad.axes[1] ?? 0);
      if (ax || ay) {
        x = ax;
        y = -ay;
      }
      this.lookX += dead(pad.axes[2] ?? 0) * dt * 2.6;
      this.lookY += dead(pad.axes[3] ?? 0) * dt * 1.8;
      if (pad.buttons[7]?.pressed || pad.buttons[5]?.pressed || pad.buttons[10]?.pressed) run = true;
      const jump = !!pad.buttons[0]?.pressed;
      if (jump && !this.padJump) this.jumpQueued = true;
      this.padJump = jump;
    }

    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.moveX = x;
    this.moveY = y;
    this.run = run;
  }

  takeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  takeLook(): [number, number] {
    const out: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return out;
  }

  takeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }
}
