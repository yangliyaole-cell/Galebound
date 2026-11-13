import * as THREE from 'three';
import type { Input } from '../core/input';
import { resolveWalls, supportHeight } from '../world/colliders';
import { heightAt, normalAt, sstep } from '../world/heightmap';
import { WATER_LEVEL } from '../world/layout';
import type { Wind } from '../world/wind';
import { Character, type Motion } from './character';

export type Mode = 'ground' | 'air' | 'glide' | 'swim';

const WALK = 2.7;
const RUN = 7.2;
const SWIM = 2.5;
const JUMP = 8.4;
const GRAVITY = 24;
const STEP = 0.5;
const RADIUS = 0.32;
const HEIGHT = 1.7;
/** Gliding starts only when facing within about 50 degrees of the wind. */
const ALIGN = 0.64;
const MIN_GLIDE_HEIGHT = 3;

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
  private glideLock = 0;
  private glideSpeed = 0;
  private turn = 0;
  private dive = 0;
  private lift = 0;
  private readonly normal = new THREE.Vector3();
  private readonly state = {
    motion: 'idle' as Motion, speed: 0, turn: 0, dive: 0, velocity: this.vel, wind: new THREE.Vector3(),
  };

  constructor(outline: boolean) {
    this.character = new Character(outline);
  }

  teleport(x: number, z: number, yaw = this.yaw, up = 0): void {
    this.pos.set(x, supportHeight(x, z, Infinity, 0) + up, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.mode = up > 0.5 ? 'air' : 'ground';
  }

  private turnToward(target: number, amount: number): void {
    const diff = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += diff * Math.min(1, amount);
  }

  private keepInWorld(): void {
    this.pos.x = Math.max(-1000, Math.min(1000, this.pos.x));
    this.pos.z = Math.max(-1000, Math.min(900, this.pos.z));
  }

  update(dt: number, time: number, input: Input, cameraYaw: number, wind: Wind): void {
    const { pos, vel } = this;
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
      const target = mag * (running ? RUN : WALK) * wading * (this.landTimer > 0 ? 0.3 : 1);
      let tx = dx * target;
      let tz = dz * target;
      // Ground too steep to stand on: no climbing, and a slide downhill.
      normalAt(pos.x, pos.z, this.normal);
      if (pos.y - terrain < 0.2 && this.normal.y < 0.64) {
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
      }
      const k = 1 - Math.exp(-dt * 12);
      vel.x += (tx - vel.x) * k;
      vel.z += (tz - vel.z) * k;
      vel.y = 0;
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      resolveWalls(pos, RADIUS, pos.y, pos.y + HEIGHT, STEP);
      this.keepInWorld();
      const ground = supportHeight(pos.x, pos.z, pos.y, STEP);
      if (ground < pos.y - 0.8) {
        this.mode = 'air';
        this.coyote = 0.12;
      } else {
        pos.y += (ground - pos.y) * (1 - Math.exp(-dt * 28));
        if (Math.abs(ground - pos.y) < 0.01) pos.y = ground;
      }
      if (mag > 0.05) this.turnToward(Math.atan2(dx, dz), dt * 12);
      if (jump && this.mode === 'ground') {
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
      if (jump && this.coyote > 0) {
        vel.y = JUMP;
        this.coyote = 0;
        this.onJump();
      }
      const ground = supportHeight(pos.x, pos.z, Math.max(before, pos.y) + 0.05, 0);
      this.clearance = pos.y - ground;
      if (pos.y <= ground && vel.y <= 0) {
        this.land(ground);
      } else if (pos.y < WATER_LEVEL - 1.15 && heightAt(pos.x, pos.z) < WATER_LEVEL - 1.25) {
        this.mode = 'swim';
        vel.y = 0;
        this.onSplash();
      } else {
        this.tryGlide(wind, jump);
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
    const s = this.state;
    s.speed = horizontal;
    s.turn = this.turn;
    s.dive = this.dive;
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
    this.turn = this.dive = 0;
    if (impact > 11) this.landTimer = 0.24;
    this.onLand(impact);
  }

  /** Jump from a height, roughly downwind, during a gust: the cloths catch the air. */
  private tryGlide(wind: Wind, jump: boolean): void {
    const { vel } = this;
    const speed = Math.hypot(vel.x, vel.z);
    const hx = speed > 1 ? vel.x / speed : Math.sin(this.yaw);
    const hz = speed > 1 ? vel.z / speed : Math.cos(this.yaw);
    this.alignment = hx * wind.dir.x + hz * wind.dir.y;
    if (wind.gust < 0.35 || this.clearance < MIN_GLIDE_HEIGHT || this.alignment < ALIGN) return;
    // Automatic once falling; the jump button can also open the cloths early.
    if (!(vel.y < -0.5 && this.glideLock <= 0) && !jump) return;
    this.mode = 'glide';
    this.yaw = Math.atan2(hx, hz);
    this.glideSpeed = Math.max(speed, 8);
    this.lift = 0;
    this.onGlide(true);
  }

  private glide(dt: number, input: Input, wind: Wind, jump: boolean): void {
    const { pos, vel } = this;
    const ease = 1 - Math.exp(-dt * 4);
    this.turn += (input.moveX - this.turn) * ease;
    this.dive += (input.moveY - this.dive) * ease;
    // Turning right swings the heading clockwise seen from above.
    this.yaw -= this.turn * 1.25 * dt;
    const hx = Math.sin(this.yaw);
    const hz = Math.cos(this.yaw);
    this.alignment = hx * wind.dir.x + hz * wind.dir.y;

    // The gust carries you while you stay with it; turn away and you sink.
    const lift = wind.gust * sstep(0.05, 0.75, this.alignment);
    this.lift += (lift - this.lift) * (1 - Math.exp(-dt * 2));
    const diving = Math.max(0, this.dive);
    const flaring = Math.max(0, -this.dive);
    const targetSpeed = 10.5 + this.lift * 3.5 + diving * 6 - flaring * 4;
    this.glideSpeed += (targetSpeed - this.glideSpeed) * (1 - Math.exp(-dt * 1.4));
    let sink = 1.0 + (1 - this.lift) * 5.2 + diving * 5.5 - flaring * 0.6 * sstep(7, 11, this.glideSpeed);
    if (this.glideSpeed < 7.5) sink += (7.5 - this.glideSpeed) * 1.6;
    vel.y += (-Math.max(0.5, sink) - vel.y) * (1 - Math.exp(-dt * 3));
    vel.x = hx * this.glideSpeed + wind.velocity.x * 0.12;
    vel.z = hz * this.glideSpeed + wind.velocity.z * 0.12;

    const beforeX = pos.x;
    const beforeZ = pos.z;
    const beforeY = pos.y;
    pos.addScaledVector(vel, dt);
    const blocked = resolveWalls(pos, RADIUS, pos.y, pos.y + 0.9, 0.3);
    this.keepInWorld();
    const ground = supportHeight(pos.x, pos.z, Math.max(beforeY, pos.y) + 0.05, 0);
    this.clearance = pos.y - ground;
    if (pos.y <= ground) {
      this.land(ground);
      return;
    }
    if (pos.y < WATER_LEVEL - 0.6 && heightAt(pos.x, pos.z) < WATER_LEVEL - 1.25) {
      this.mode = 'swim';
      this.turn = this.dive = 0;
      this.onGlide(false);
      this.onSplash();
      return;
    }
    // Flying into a wall, or choosing to drop, folds the cloths.
    const stalled = blocked && Math.hypot(pos.x - beforeX, pos.z - beforeZ) < this.glideSpeed * dt * 0.4;
    if (jump || stalled) {
      this.mode = 'air';
      this.glideLock = 1.2;
      this.turn = this.dive = 0;
      vel.x *= 0.5;
      vel.z *= 0.5;
      this.onGlide(false);
    }
  }

  get gliding(): boolean {
    return this.mode === 'glide';
  }

  get speed(): number {
    return this.mode === 'glide' ? this.glideSpeed : Math.hypot(this.vel.x, this.vel.z);
  }
}
