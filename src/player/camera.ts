import * as THREE from 'three';
import { solidAt } from '../world/colliders';
import { heightAt } from '../world/heightmap';
import { WATER_LEVEL } from '../world/layout';
import type { Player } from './controller';

/** Third-person camera that orbits the player and stays out of walls and hills. */
export class FollowCamera {
  yaw = 0;
  pitch = 0.2;
  distance = 6;
  private current = 6;
  /** Wanted distance, eased: a glide's extra 3 m pulls out and back in smoothly instead of snapping. */
  private reach = 6;
  private idle = 10;
  private readonly target = new THREE.Vector3();
  private readonly targetVel = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private fov = 55;
  private started = false;

  constructor(readonly camera: THREE.PerspectiveCamera, public autoFollow: boolean) {}

  look(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx === 0 && dy === 0) return;
    this.yaw -= dx;
    this.pitch = Math.max(-0.75, Math.min(1.3, this.pitch + dy));
    this.idle = 0;
  }

  zoom(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.distance = Math.max(2.2, Math.min(16, this.distance * (1 + delta)));
  }

  update(dt: number, player: Player): void {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    // Public fields can also be set by URL/debug controls; keep lookAt away from poles.
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    if (Math.abs(this.yaw) > Math.PI) this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Number.isFinite(this.pitch) ? Math.max(-0.75, Math.min(1.3, this.pitch)) : 0.2;
    this.distance = Number.isFinite(this.distance) ? Math.max(2.2, Math.min(16, this.distance)) : 6;
    this.idle += dt;
    const gliding = player.gliding;
    // Swing round behind the player when they fly, or run on a touch screen.
    const follow = gliding ? 1.8 : this.autoFollow && player.speed > 4 ? 0.7 : 0;
    // Recentring fades in after the player lets go of the view, rather than kicking in at once.
    const settle = Math.min(1, Math.max(0, (this.idle - 1.4) / 1.2));
    if (follow > 0 && settle > 0) {
      const behind = player.yaw + Math.PI;
      const diff = Math.atan2(Math.sin(behind - this.yaw), Math.cos(behind - this.yaw));
      this.yaw += diff * Math.min(1, dt * follow * settle * settle);
      if (gliding) this.pitch += (0.32 - this.pitch) * Math.min(1, dt * 0.8 * settle);
    }
    if (Math.abs(this.yaw) > Math.PI) this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    const eye = gliding ? 0.9 : player.mode === 'swim' ? 1.5 : 1.45;
    const tx = player.pos.x;
    const ty = player.pos.y + eye;
    const tz = player.pos.z;
    if (!this.started || Math.hypot(tx - this.target.x, ty - this.target.y, tz - this.target.z) > 6) {
      // First frame or a teleport: no lag to recover from.
      this.target.set(tx, ty, tz);
      this.targetVel.set(0, 0, 0);
      this.started = true;
    }
    // The look-at point trails the body on a critically damped spring: starts and stops feel
    // weighted, steps and stairs are smoothed, and the lag is capped so the hero stays framed.
    const w = 9;
    this.targetVel.x += (w * w * (tx - this.target.x) - 2 * w * this.targetVel.x) * dt;
    this.targetVel.z += (w * w * (tz - this.target.z) - 2 * w * this.targetVel.z) * dt;
    this.targetVel.y += (w * w * (ty - this.target.y) - 2 * w * this.targetVel.y) * dt;
    this.target.addScaledVector(this.targetVel, dt);
    const lagX = this.target.x - tx, lagZ = this.target.z - tz, lag = Math.hypot(lagX, lagZ);
    if (lag > 0.35) {
      this.target.x = tx + lagX * 0.35 / lag;
      this.target.z = tz + lagZ * 0.35 / lag;
    }
    this.target.y = ty + Math.max(-0.6, Math.min(0.6, this.target.y - ty));

    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.reach += (this.distance + (gliding ? 3 : 0) - this.reach) * (1 - Math.exp(-dt * 2.5));
    if (!Number.isFinite(this.reach)) this.reach = this.distance;
    const wanted = this.reach;

    // Walk outward from the player and stop at the first thing in the way. Obstacles pull the
    // camera in at once (never see through a wall); it eases back out once the way is clear.
    let clear = wanted;
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const d = (wanted * i) / steps;
      if (solidAt(this.target.x + this.dir.x * d, this.target.y + this.dir.y * d, this.target.z + this.dir.z * d)) {
        clear = Math.max(0.8, (wanted * (i - 1)) / steps - 0.15);
        break;
      }
    }
    if (clear < this.current) this.current = clear;
    else this.current += (clear - this.current) * (1 - Math.exp(-dt * 4));

    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, this.current);
    if (cam.position.y < WATER_LEVEL + 0.25) cam.position.y = WATER_LEVEL + 0.25;
    // The ray is sampled; a bump between samples could still swallow the lens.
    const ground = heightAt(cam.position.x, cam.position.z) + 0.3;
    if (Number.isFinite(ground) && cam.position.y < ground) cam.position.y = ground;
    cam.lookAt(this.target);

    // A tall, narrow screen needs a wider lens to see as much to the sides.
    const base = cam.aspect < 1 ? 55 + Math.min(20, (1 - cam.aspect) * 40) : 55;
    const fov = gliding ? base + Math.min(20, Math.max(0, player.speed - 8) * 0.65) : base;
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
