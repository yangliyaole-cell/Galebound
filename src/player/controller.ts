import * as THREE from 'three';
import type { Input } from '../core/input';
import { resolveWalls, supportHeight } from '../world/colliders';
import { heightAt, normalAt, sstep, waterLevelAt as surfaceAt } from '../world/heightmap';
import { HALF, WORLD_MARGIN } from '../world/layout';

const EDGE = HALF - WORLD_MARGIN;
/** Water surface here; where the ground is dry, a level safely below it. */
const waterLevelAt = (x: number, z: number): number => {
  const level = surfaceAt(x, z);
  return level === -Infinity ? heightAt(x, z) - 3 : level;
};
import type { Wind } from '../world/wind';
import { Character, type CharacterState, type Motion } from './character';

export type Mode = 'ground' | 'air' | 'glide' | 'swim';

const WALK = 2.7;
const RUN = 7.2;
const SWIM = 2.5;
const JUMP = 8.4;
const GRAVITY = 24;
const STEP = 0.5;
const RADIUS = 0.32;
const HEIGHT = 1.7;
/** A jump press opens the cloths from this far up: a running hop is enough. Only Space opens them. */
const MIN_TAKEOFF_HEIGHT = 0.7;

// Ground feel. Speeds build up and bleed off over a few tenths of a second instead of snapping,
// and the body can only swing round so fast, so turns carve an arc and reversals skid.
/** Push-off from a standstill, m/s^2; it tapers as the stride lengthens. */
const ACCEL = 21;
/** Braking when the stick is released or pulled back, m/s^2. */
const BRAKE = 26;
/** Heading turn rate at a stroll and at a full run, rad/s. */
const TURN_SLOW = 15;
const TURN_FAST = 6.2;
/** Beyond this angle at running speed the body plants its feet and skids round. */
const SKID_ANGLE = 2.2;
/** Jump presses this early before landing still count. */
const JUMP_BUFFER = 0.16;
/** Leaving a ledge still allows a jump for this long. */
const COYOTE = 0.14;

// Glide flight model (path angles in radians, speeds in m/s).
/** Gravity along the flight path; softer than on foot so dives feel floaty. */
const GLIDE_G = 16;
/** Hands-off path angle: about 10:1, so calm air is a long, gentle glide. */
const NEUTRAL_PITCH = -0.1;
const MAX_DIVE = 0.62;
const MAX_CLIMB = 0.55;
/** Below this airspeed the nose drops and climbing is impossible. */
const STALL = 7;
/** Quadratic drag, tuned for a hands-off cruise near 14 m/s. */
const DRAG = 0.0081;
/** Extra push while Shift tucks the arms in. */
const TUCK_PUSH = 4;
const MAX_AIRSPEED = 42;
/** Fraction of gravity and drag felt while climbing. */
const ZOOM = 0.5;
/** Upward m/s per m/s of headwind. */
const HEADWIND_LIFT = 0.42;

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = Math.PI;
  mode: Mode = 'ground';
  readonly character: Character;
  /** Height above whatever is below, refreshed while airborne. */
  clearance = 0;
  /** How well the current heading lines up with the wind, -1..1. */
  alignment = 0;

  onJump: () => void = () => {};
  onLand: (impact: number) => void = () => {};
  onGlide: (started: boolean) => void = () => {};
  onSplash: () => void = () => {};

  private coyote = 0;
  private landTimer = 0;
  /** Animation feed: smoothed turn rate (rad/s), forward acceleration and the last landing. */
  private feel?: { yawRate: number; accel: number; lastYaw: number; lastSpeed: number; buffer: number; skid: number; impact: number };
  private glideLock = 0;
  private glideSpeed = 0;
  private glideTime = 0;
  private turn = 0;
  private dive = 0;
  private lift = 0;
  private pitch = NEUTRAL_PITCH;
  private tuck = 0;
  private readonly normal = new THREE.Vector3();
  private readonly state: CharacterState = {
    motion: 'idle' as Motion, speed: 0, turn: 0, dive: 0, tuck: 0, velocity: this.vel, wind: new THREE.Vector3(),
  };

  constructor(outline: boolean) {
    this.character = new Character(outline);
  }

  teleport(x: number, z: number, yaw = this.yaw, up = 0): void {
    this.pos.set(x, supportHeight(x, z, Infinity, 0) + up, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.mode = up > 0.5 ? 'air' : 'ground';
    this.feel = undefined;
  }

  /** Created lazily so partially constructed players in the headless checks stay valid. */
  private feelState() {
    return this.feel ??= { yawRate: 0, accel: 0, lastYaw: this.yaw, lastSpeed: Math.hypot(this.vel.x, this.vel.z), buffer: 0, skid: 0, impact: 0 };
  }

  /**
   * Ground locomotion with momentum. Speed and heading are separate: speed ramps toward the
   * request with a push-off and a braking rate; heading swings toward the stick at a rate that
   * falls as speed rises, so a run carves an arc rather than snapping sideways. A sharp reversal
   * at speed brakes first (a skid) and then pivots. Facing follows the heading, so feet never slide.
   */
  private groundMove(dt: number, dx: number, dz: number, mag: number, target: number): void {
    const { vel } = this;
    const feel = this.feelState();
    let speed = Math.hypot(vel.x, vel.z);
    let heading = speed > 0.05 ? Math.atan2(vel.x, vel.z) : this.yaw;
    const wanted = mag > 0.05 ? Math.atan2(dx, dz) : heading;
    const diff = Math.atan2(Math.sin(wanted - heading), Math.cos(wanted - heading));
    const runFrac = Math.min(1, speed / RUN);
    if (mag > 0.05) {
      if (speed < 0.6) {
        // From a standstill, set off in the new direction straight away.
        heading = wanted;
        feel.skid = 0;
      } else if (Math.abs(diff) > SKID_ANGLE && speed > 3.2) {
        feel.skid = 1;
      }
      if (feel.skid > 0) {
        // Plant and brake; the body is already turning toward the new direction meanwhile.
        speed = Math.max(0, speed - BRAKE * 1.15 * dt);
        if (speed < 1.2) feel.skid = 0;
      } else {
        const rate = TURN_SLOW + (TURN_FAST - TURN_SLOW) * runFrac;
        heading += Math.max(-rate * dt, Math.min(rate * dt, diff));
        // Hard turns cost speed; a gentle curve keeps it.
        const along = Math.max(0, Math.cos(diff));
        const want = target * (0.45 + 0.55 * along);
        if (want > speed) speed = Math.min(want, speed + ACCEL * (1 - 0.55 * runFrac) * dt);
        else speed = Math.max(want, speed - BRAKE * 0.8 * dt);
      }
    } else {
      feel.skid = 0;
      speed = Math.max(0, speed - BRAKE * dt);
    }
    vel.x = Math.sin(heading) * speed;
    vel.z = Math.cos(heading) * speed;
    // Facing: along the travel heading, or toward the stick while skidding/pivoting.
    const face = feel.skid > 0 || speed < 0.6 ? wanted : heading;
    if (mag > 0.05 || speed > 0.3) this.turnToward(face, dt * (feel.skid > 0 ? 9 : 16));
  }

  private turnToward(target: number, amount: number): void {
    const diff = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += diff * Math.min(1, amount);
  }

  private keepInWorld(): void {
    this.pos.x = Math.max(-EDGE, Math.min(EDGE, this.pos.x));
    this.pos.z = Math.max(-EDGE, Math.min(EDGE, this.pos.z));
  }

  update(dt: number, time: number, input: Input, cameraYaw: number, wind: Wind): void {
    const { pos, vel } = this;
    const WATER_LEVEL = waterLevelAt(pos.x, pos.z);
    const mx = input.moveX;
    const my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    // Movement is relative to where the camera looks.
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    let dx = fx * my + Math.cos(cameraYaw) * mx;
    let dz = fz * my - Math.sin(cameraYaw) * mx;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) {
      dx /= dl;
      dz /= dl;
    }
    const jump = input.takeJump();
    this.glideLock = Math.max(0, this.glideLock - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);

    if (this.mode === 'ground') {
      const terrain = heightAt(pos.x, pos.z);
      const wading = WATER_LEVEL - terrain > 0.3 ? 0.6 : 1;
      const running = input.run && mag > 0.3;
      // Walking speed rises with stick deflection; running is a separate, fuller gait.
      const target = (running ? RUN * Math.min(1, mag * 1.15) : WALK * mag) * wading * (this.landTimer > 0 ? 0.45 : 1);
      // Ground too steep to stand on: no climbing, and a slide downhill.
      normalAt(pos.x, pos.z, this.normal);
      if (pos.y - terrain < 0.2 && this.normal.y < 0.64) {
        let tx = dx * target;
        let tz = dz * target;
        const g = Math.hypot(this.normal.x, this.normal.z) || 1;
        const sx = this.normal.x / g;
        const sz = this.normal.z / g;
        const uphill = tx * sx + tz * sz;
        if (uphill < 0) {
          tx -= uphill * sx;
          tz -= uphill * sz;
        }
        tx += sx * 6;
        tz += sz * 6;
        const k = 1 - Math.exp(-dt * 12);
        vel.x += (tx - vel.x) * k;
        vel.z += (tz - vel.z) * k;
        if (mag > 0.05) this.turnToward(Math.atan2(dx, dz), dt * 12);
      } else {
        this.groundMove(dt, dx, dz, mag, target);
      }
      vel.y = 0;
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      resolveWalls(pos, RADIUS, pos.y, pos.y + HEIGHT, STEP);
      this.keepInWorld();
      const ground = supportHeight(pos.x, pos.z, pos.y, STEP);
      if (ground < pos.y - 0.8) {
        this.mode = 'air';
        this.coyote = COYOTE;
      } else {
        pos.y += (ground - pos.y) * (1 - Math.exp(-dt * 28));
        if (Math.abs(ground - pos.y) < 0.01) pos.y = ground;
      }
      // A press buffered just before touchdown jumps on the first grounded frame.
      const feel = this.feelState();
      const buffered = feel.buffer > 0;
      feel.buffer = 0;
      if ((jump || buffered) && this.mode === 'ground') {
        vel.y = JUMP;
        this.mode = 'air';
        this.coyote = 0;
        this.onJump();
      }
      if (WATER_LEVEL - heightAt(pos.x, pos.z) > 1.3 && pos.y < WATER_LEVEL - 1.0) {
        this.mode = 'swim';
        this.onSplash();
      }
    } else if (this.mode === 'air') {
      const before = pos.y;
      vel.y = Math.max(-42, vel.y - GRAVITY * dt);
      if (mag > 0.05) {
        // In the air W/A/S/D only steer; they never open the cloths (that is Space alone).
        const target = input.run ? RUN : WALK * 1.6;
        const k = 1 - Math.exp(-dt * 2.6);
        vel.x += (dx * target - vel.x) * k;
        vel.z += (dz * target - vel.z) * k;
        this.turnToward(Math.atan2(dx, dz), dt * 8);
      }
      pos.addScaledVector(vel, dt);
      resolveWalls(pos, RADIUS, pos.y, pos.y + HEIGHT, 0.25);
      this.keepInWorld();
      this.coyote -= dt;
      const feel = this.feelState();
      feel.buffer = Math.max(0, feel.buffer - dt);
      let used = false;
      if (jump && this.coyote > 0) {
        vel.y = JUMP;
        this.coyote = 0;
        used = true;
        this.onJump();
      }
      const ground = supportHeight(pos.x, pos.z, Math.max(before, pos.y) + 0.05, 0);
      this.clearance = pos.y - ground;
      if (pos.y <= ground && vel.y <= 0) {
        // Too close to the ground to open the cloths: remember the press for the landing.
        if (jump && !used) feel.buffer = JUMP_BUFFER;
        this.land(ground);
      } else if (pos.y < WATER_LEVEL - 1.15 && heightAt(pos.x, pos.z) < WATER_LEVEL - 1.25) {
        this.mode = 'swim';
        vel.y = 0;
        this.onSplash();
      } else if (jump && !used) {
        if (!this.tryGlide(wind)) feel.buffer = JUMP_BUFFER;
      } else {
        this.updateAlignment(wind);
      }
    } else if (this.mode === 'glide') {
      this.glide(dt, input, wind, jump);
    } else {
      const k = 1 - Math.exp(-dt * 5);
      vel.x += (dx * mag * SWIM - vel.x) * k;
      vel.z += (dz * mag * SWIM - vel.z) * k;
      vel.y = 0;
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      resolveWalls(pos, RADIUS, pos.y, pos.y + 1.2, 0.2);
      this.keepInWorld();
      pos.y += (WATER_LEVEL - 1.2 - pos.y) * (1 - Math.exp(-dt * 6));
      if (mag > 0.05) this.turnToward(Math.atan2(dx, dz), dt * 5);
      const terrain = heightAt(pos.x, pos.z);
      const ground = supportHeight(pos.x, pos.z, pos.y + 0.6, 0.6);
      if (terrain > WATER_LEVEL - 1.05 || ground > pos.y + 0.1) {
        this.mode = 'ground';
        pos.y = Math.max(pos.y, ground);
      }
    }

    // Hand the result to the animated body.
    const horizontal = Math.hypot(vel.x, vel.z);
    const feel = this.feelState();
    if (dt > 0) {
      // Smoothed turn rate and forward acceleration drive lean, bank and the stop/start shifts.
      const yawStep = Math.atan2(Math.sin(this.yaw - feel.lastYaw), Math.cos(this.yaw - feel.lastYaw));
      const blend = 1 - Math.exp(-dt * 10);
      feel.yawRate += (Math.max(-12, Math.min(12, yawStep / dt)) - feel.yawRate) * blend;
      feel.accel += (Math.max(-40, Math.min(40, (horizontal - feel.lastSpeed) / dt)) - feel.accel) * blend;
    }
    feel.lastYaw = this.yaw;
    feel.lastSpeed = horizontal;
    const s = this.state;
    s.speed = horizontal;
    s.yawRate = feel.yawRate;
    s.accel = this.mode === 'ground' ? feel.accel : 0;
    s.skid = feel.skid;
    s.vy = vel.y;
    s.grounded = this.mode === 'ground';
    s.impact = feel.impact;
    feel.impact = 0;
    s.airspeed = this.mode === 'glide' ? this.glideSpeed : horizontal;
    s.clearance = this.mode === 'ground' ? 0 : this.clearance;
    s.glideTime = this.mode === 'glide' ? this.glideTime : 0;
    s.turn = this.turn;
    s.dive = this.dive;
    s.tuck = this.mode === 'glide' ? this.tuck || 0 : 0;
    s.wind.copy(wind.velocity);
    if (this.mode === 'glide') s.motion = 'glide';
    else if (this.mode === 'swim') s.motion = 'swim';
    else if (this.mode === 'air') s.motion = vel.y > 1.5 ? 'jump' : 'fall';
    else if (this.landTimer > 0) s.motion = 'land';
    else s.motion = horizontal > 4.3 ? 'run' : horizontal > 0.35 ? 'walk' : 'idle';
    const root = this.character.root;
    root.position.copy(pos);
    root.rotation.y = this.yaw;
    this.character.update(dt, time, s, heightAt);
  }

  private land(ground: number): void {
    const impact = -this.vel.y;
    this.pos.y = ground;
    this.vel.y = 0;
    if (this.mode === 'glide') this.onGlide(false);
    this.mode = 'ground';
    this.turn = this.dive = this.tuck = 0;
    if (impact > 11) this.landTimer = 0.24;
    this.feelState().impact = impact;
    this.onLand(impact);
  }

  private updateAlignment(wind: Wind): void {
    const { vel } = this;
    const speed = Math.hypot(vel.x, vel.z);
    const hx = speed > 1 ? vel.x / speed : Math.sin(this.yaw);
    const hz = speed > 1 ? vel.z / speed : Math.cos(this.yaw);
    this.alignment = hx * wind.dir.x + hz * wind.dir.y;
  }

  /**
   * Open the cloths. Only a jump press in the air does this (from a small hop upward);
   * falling, steering or a gust never open them by themselves. Returns false when too low.
   */
  private tryGlide(wind: Wind): boolean {
    const { vel } = this;
    const speed = Math.hypot(vel.x, vel.z);
    const hx = speed > 1 ? vel.x / speed : Math.sin(this.yaw);
    const hz = speed > 1 ? vel.z / speed : Math.cos(this.yaw);
    this.alignment = hx * wind.dir.x + hz * wind.dir.y;
    // A short lock after folding stops a double tap from snapping the cloths straight open again.
    if (this.clearance <= MIN_TAKEOFF_HEIGHT || this.glideLock > 0) return false;
    this.mode = 'glide';
    this.yaw = Math.atan2(hx, hz);
    // Airspeed carries over from the run-up; a running jump is enough to fly.
    this.glideSpeed = Math.max(speed, 9);
    this.pitch = NEUTRAL_PITCH;
    this.tuck = 0;
    this.lift = 0;
    this.glideTime = 0;
    // Snapping the cloths open catches a breath of air: a small take-off kick.
    vel.y = Math.max(vel.y, 4.5);
    this.onGlide(true);
    return true;
  }

  /**
   * Energy glide. Airspeed and height trade against each other: pitch down to
   * build speed, pull up to spend it on height. Wind then moves the whole air
   * mass: a tailwind carries you fast over the ground, a headwind slows you
   * but its updraft over the cloths lifts you quickly.
   */
  private glide(dt: number, input: Input, wind: Wind, jump: boolean): void {
    const { pos, vel } = this;
    const WATER_LEVEL = waterLevelAt(pos.x, pos.z);
    const ease = 1 - Math.exp(-dt * 4);
    this.glideTime += dt;
    this.turn += (input.moveX - this.turn) * ease;
    // Forward is usually still held from the run-up, so pitch input eases in.
    this.dive += (input.moveY * Math.min(1, this.glideTime / 0.8) - this.dive) * ease;
    // Shift tucks the arms in a little: less drag, more speed, a bit more sink.
    const boost = !!input.boost;
    this.tuck += ((boost ? 1 : 0) - this.tuck) * (1 - Math.exp(-dt * 5));
    // Turning right swings the heading clockwise seen from above; tucked arms turn less sharply.
    this.yaw -= this.turn * (1.35 - this.tuck * 0.35) * dt;
    const hx = Math.sin(this.yaw);
    const hz = Math.cos(this.yaw);
    this.alignment = hx * wind.dir.x + hz * wind.dir.y;

    // Flight path angle: W noses down, S pulls up. Too slow and the nose drops (stall).
    const V = this.glideSpeed;
    const climbLimit = NEUTRAL_PITCH + (MAX_CLIMB - NEUTRAL_PITCH) * sstep(STALL, STALL + 9, V);
    let wanted = NEUTRAL_PITCH;
    if (this.dive > 0) wanted -= this.dive * MAX_DIVE;
    else wanted += -this.dive * (MAX_CLIMB - NEUTRAL_PITCH);
    wanted = Math.min(wanted, climbLimit);
    if (V < STALL) wanted = Math.min(wanted, NEUTRAL_PITCH - 0.35 * (1 - V / STALL));
    this.pitch += (wanted - this.pitch) * (1 - Math.exp(-dt * 3));
    const sinP = Math.sin(this.pitch);
    const cosP = Math.cos(this.pitch);

    // Speed: gravity along the path, drag against it, a little push while tucked.
    // Pulling up out of a dive is a zoom: the cloths turn speed into height
    // efficiently, so a dive-and-pull nearly wins back what the dive spent.
    const zoom = this.pitch > 0 ? ZOOM : 1;
    const drag = DRAG * (1 - this.tuck * 0.4) * zoom;
    const accel = -GLIDE_G * sinP * zoom - drag * V * V + this.tuck * TUCK_PUSH;
    this.glideSpeed = Math.max(4, Math.min(MAX_AIRSPEED, V + accel * dt));

    // Wind relative to the heading: + is a tailwind, - a headwind.
    const along = wind.velocity.x * hx + wind.velocity.z * hz;
    const sideX = wind.velocity.x - along * hx;
    const sideZ = wind.velocity.z - along * hz;
    const head = Math.max(0, -along);
    // Headwind slows the ground track (never pushing you backwards); tailwind adds in full.
    const carry = along >= 0 ? along : along * 0.55;
    // Headwind banks up under the cloths; spread arms catch more of it.
    const updraft = head * HEADWIND_LIFT * (1 - this.tuck * 0.5) * sstep(5, 10, this.glideSpeed);
    this.lift += (updraft - this.lift) * (1 - Math.exp(-dt * 2));

    const track = this.glideSpeed * cosP + carry;
    vel.x = hx * track + sideX * 0.5;
    vel.z = hz * track + sideZ * 0.5;
    const targetY = this.glideSpeed * sinP + this.lift - this.tuck * 0.3;
    vel.y += (targetY - vel.y) * (1 - Math.exp(-dt * 4));

    const beforeX = pos.x;
    const beforeZ = pos.z;
    const beforeY = pos.y;
    pos.addScaledVector(vel, dt);
    const blocked = resolveWalls(pos, RADIUS, pos.y, pos.y + 0.9, 0.3);
    this.keepInWorld();
    const support = supportHeight(pos.x, pos.z, Math.max(beforeY, pos.y) + 0.05, 0);
    this.clearance = pos.y - support;
    if (pos.y <= support) {
      this.land(support);
      return;
    }
    if (pos.y < WATER_LEVEL - 0.6 && heightAt(pos.x, pos.z) < WATER_LEVEL - 1.25) {
      this.mode = 'swim';
      this.turn = this.dive = this.tuck = 0;
      this.onGlide(false);
      this.onSplash();
      return;
    }
    // Flying into a wall, or choosing to drop, folds the cloths.
    const moved = Math.hypot(pos.x - beforeX, pos.z - beforeZ);
    const stalled = blocked && moved < Math.hypot(vel.x, vel.z) * dt * 0.4;
    if (jump || stalled) {
      this.mode = 'air';
      this.glideLock = 0.3;
      this.turn = this.dive = this.tuck = 0;
      vel.x *= 0.5;
      vel.z *= 0.5;
      this.onGlide(false);
    }
  }

  get gliding(): boolean {
    return this.mode === 'glide';
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}
