import * as THREE from 'three';
import { toon } from '../render/toon';

const GRAVITY = -9.8;
const DRAG = 3.5;
const ITERATIONS = 5;

export interface ClothCollider {
  /** Vertical cylinder the cloth is pushed out of, e.g. the wearer's body. */
  x: number;
  z: number;
  bottom: number;
  top: number;
  radius: number;
}

/**
 * A long rectangular strip of cloth pinned along one short edge.
 * Two columns of points, simulated in world space with Verlet integration.
 */
export class ClothStrip {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private started = false;

  /**
   * @param colorAt colour for a row, given 0 at the pinned edge and 1 at the free end
   */
  constructor(
    private readonly width: number,
    private readonly segment: number,
    private readonly rows: number,
    colorAt: (t: number) => number,
    private readonly phase: number,
  ) {
    this.pos = new Float32Array(rows * 2 * 3);
    this.prev = new Float32Array(rows * 2 * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const colors = new Float32Array(rows * 2 * 3);
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      c.set(colorAt(r / (rows - 1)));
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], r * 6);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      const a = r * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(index);

    this.mesh = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, doubleSided: true, plain: true }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  private reset(pinA: THREE.Vector3, pinB: THREE.Vector3): void {
    for (let r = 0; r < this.rows; r++) {
      const y = r * this.segment;
      this.pos.set([pinA.x, pinA.y - y, pinA.z, pinB.x, pinB.y - y, pinB.z], r * 6);
    }
    this.prev.set(this.pos);
    this.started = true;
  }

  private constrain(i: number, j: number, rest: number, stiffness: number): void {
    const p = this.pos;
    const a = i * 3;
    const b = j * 3;
    const dx = p[b] - p[a];
    const dy = p[b + 1] - p[a + 1];
    const dz = p[b + 2] - p[a + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const k = ((d - rest) / d) * stiffness;
    const pinned = i < 2;
    const wa = pinned ? 0 : 0.5;
    const wb = pinned ? 1 : 0.5;
    p[a] += dx * k * wa;
    p[a + 1] += dy * k * wa;
    p[a + 2] += dz * k * wa;
    p[b] -= dx * k * wb;
    p[b + 1] -= dy * k * wb;
    p[b + 2] -= dz * k * wb;
  }

  /**
   * @param air velocity of the air relative to the wearer
   */
  update(
    dt: number,
    time: number,
    pinA: THREE.Vector3,
    pinB: THREE.Vector3,
    air: THREE.Vector3,
    groundAt: (x: number, z: number) => number,
    collider: ClothCollider | null,
  ): void {
    const p = this.pos;
    const q = this.prev;
    if (!this.started || Math.hypot(p[0] - pinA.x, p[1] - pinA.y, p[2] - pinA.z) > 2) {
      this.reset(pinA, pinB);
    }
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;

    const airSpeed = air.length();
    // Flutter acts across the airflow: sideways and vertically.
    let sx = -air.z;
    let sz = air.x;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const lift = Math.min(1, airSpeed / 6);

    for (let n = 2; n < this.rows * 2; n++) {
      const i = n * 3;
      const row = n >> 1;
      const along = row / (this.rows - 1);
      const vx = (p[i] - q[i]) / dt;
      const vy = (p[i + 1] - q[i + 1]) / dt;
      const vz = (p[i + 2] - q[i + 2]) / dt;
      // A wave running down the strip, faster and stronger in fast air.
      const wave = time * (6 + airSpeed * 0.9) - row * 1.25 + (n & 1) * 0.5 + this.phase;
      const flutter = airSpeed * DRAG * 0.42 * (0.25 + along);
      const side = Math.cos(wave * 0.73 + this.phase) * flutter * 0.55;
      const ax = DRAG * (air.x - vx) + sx * side;
      const ay = GRAVITY * (1 - lift * 0.45) + DRAG * (air.y - vy) + Math.sin(wave) * flutter;
      const az = DRAG * (air.z - vz) + sz * side;
      const nx = p[i] + (p[i] - q[i]) * 0.99 + ax * dt * dt;
      const ny = p[i + 1] + (p[i + 1] - q[i + 1]) * 0.99 + ay * dt * dt;
      const nz = p[i + 2] + (p[i + 2] - q[i + 2]) * 0.99 + az * dt * dt;
      q[i] = p[i];
      q[i + 1] = p[i + 1];
      q[i + 2] = p[i + 2];
      p[i] = nx;
      p[i + 1] = ny;
      p[i + 2] = nz;
    }

    p.set([pinA.x, pinA.y, pinA.z, pinB.x, pinB.y, pinB.z], 0);
    q.set([pinA.x, pinA.y, pinA.z, pinB.x, pinB.y, pinB.z], 0);

    const diagonal = Math.hypot(this.width, this.segment);
    for (let it = 0; it < ITERATIONS; it++) {
      for (let r = 1; r < this.rows; r++) {
        const a = r * 2;
        this.constrain(a - 2, a, this.segment, 1);
        this.constrain(a - 1, a + 1, this.segment, 1);
        this.constrain(a, a + 1, this.width, 1);
        this.constrain(a - 2, a + 1, diagonal, 0.25);
        this.constrain(a - 1, a, diagonal, 0.25);
      }
    }

    for (let n = 2; n < this.rows * 2; n++) {
      const i = n * 3;
      if (collider && p[i + 1] > collider.bottom && p[i + 1] < collider.top) {
        const dx = p[i] - collider.x;
        const dz = p[i + 2] - collider.z;
        const d = Math.hypot(dx, dz);
        if (d < collider.radius && d > 1e-5) {
          p[i] = collider.x + (dx / d) * collider.radius;
          p[i + 2] = collider.z + (dz / d) * collider.radius;
        }
      }
      const floor = groundAt(p[i], p[i + 2]) + 0.03;
      if (p[i + 1] < floor) {
        p[i + 1] = floor;
        // Friction against the ground.
        q[i] = p[i] - (p[i] - q[i]) * 0.5;
        q[i + 2] = p[i + 2] - (p[i + 2] - q[i + 2]) * 0.5;
      }
    }

    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
