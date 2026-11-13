import * as THREE from 'three';
import { solidAt } from '../world/colliders';
import { WATER_LEVEL } from '../world/layout';
import type { Player } from './controller';

/** Third-person camera that orbits the player and stays out of walls and hills. */
export class FollowCamera {
  yaw = 0;
  pitch = 0.2;
  distance = 6;
  private current = 6;
  private idle = 10;
  private readonly target = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private fov = 55;
  private started = false;

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly autoFollow: boolean) {}

  look(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.yaw -= dx;
    this.pitch = Math.max(-0.75, Math.min(1.3, this.pitch + dy));
    this.idle = 0;
  }

  zoom(delta: number): void {
    this.distance = Math.max(2.2, Math.min(16, this.distance * (1 + delta)));
  }

  update(dt: number, player: Player): void {
    this.idle += dt;
    const gliding = player.gliding;
    // Swing round behind the player when they fly, or run on a touch screen.
    const follow = gliding ? 1.8 : this.autoFollow && player.speed > 4 ? 0.7 : 0;
    if (follow > 0 && this.idle > 1.4) {
      const behind = player.yaw + Math.PI;
      const diff = Math.atan2(Math.sin(behind - this.yaw), Math.cos(behind - this.yaw));
      this.yaw += diff * Math.min(1, dt * follow);
      if (gliding) this.pitch += (0.32 - this.pitch) * Math.min(1, dt * 0.8);
    }

    const eye = gliding ? 0.9 : player.mode === 'swim' ? 1.5 : 1.45;
    const tx = player.pos.x;
    const ty = player.pos.y + eye;
    const tz = player.pos.z;
    if (!this.started) {
      this.target.set(tx, ty, tz);
      this.started = true;
    }
    this.target.x = tx;
    this.target.z = tz;
    this.target.y += (ty - this.target.y) * (1 - Math.exp(-dt * 12));

    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const wanted = this.distance + (gliding ? 3 : 0);

    // Walk outward from the player and stop at the first thing in the way.
    let clear = wanted;
    const steps = 14;
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
    cam.lookAt(this.target);

    const fov = gliding ? 55 + Math.min(13, Math.max(0, player.speed - 6) * 1.5) : 55;
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
