import * as THREE from 'three';
import { ClothStrip } from './cloth';
import { HERO_STYLE, REST, applyPose, blendPose, buildRig, type Pose, type Rig } from './rig';

export type Motion = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'glide' | 'land' | 'swim';

export interface CharacterState {
  motion: Motion;
  /** Horizontal speed in m/s. */
  speed: number;
  /** Glide steering, -1 (left) to 1 (right). */
  turn: number;
  /** Glide pitch, 1 dives and -1 flares. */
  dive: number;
  velocity: THREE.Vector3;
  wind: THREE.Vector3;
}

const CLOTH = 0x17181d;
const CLOTH_EDGE = 0x6f5c3a;

/** Near-black cloth that fades to dull bronze at the free end. */
const stripColor = (t: number): number => (t > 0.95 ? CLOTH_EDGE : t > 0.5 ? 0x1d1f26 : CLOTH);

export function poseFor(motion: Motion, phase: number, time: number, turn: number, dive: number): Pose {
  const t: Pose = { ...REST };
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  switch (motion) {
    case 'idle': {
      const breath = Math.sin(time * 1.7);
      const shift = Math.sin(time * 0.37);
      t.chestX = 0.02 + 0.014 * breath;
      t.bodyY = -0.004 * breath;
      t.bodyRoll = 0.018 * shift;
      t.spineZ = -0.03 * shift;
      t.armLZ = 0.12 + 0.012 * breath;
      t.armRZ = -t.armLZ;
      t.armLX = 0.04;
      t.armRX = 0.04;
      t.headY = Math.sin(time * 0.43) * 0.32;
      t.headX = Math.sin(time * 0.29 + 1) * 0.07;
      break;
    }
    case 'walk': {
      t.legLX = -0.5 * s;
      t.legRX = 0.5 * s;
      t.kneeL = 0.07 + 0.85 * Math.max(0, c);
      t.kneeR = 0.07 + 0.85 * Math.max(0, -c);
      t.footL = -(t.legLX + t.kneeL) * 0.6;
      t.footR = -(t.legRX + t.kneeR) * 0.6;
      t.armLX = 0.5 * s;
      t.armRX = -0.5 * s;
      t.elbowL = -0.3 - 0.15 * Math.max(0, -s);
      t.elbowR = -0.3 - 0.15 * Math.max(0, s);
      t.bodyYaw = 0.08 * s;
      t.chestY = -0.18 * s;
      t.chestX = 0.05;
      t.bodyRoll = 0.03 * c;
      t.bodyY = -0.02 + 0.018 * Math.cos(2 * phase);
      break;
    }
    case 'run': {
      t.legLX = -1.0 * s - 0.12;
      t.legRX = 1.0 * s - 0.12;
      t.kneeL = 0.3 + 1.6 * Math.max(0, c);
      t.kneeR = 0.3 + 1.6 * Math.max(0, -c);
      t.footL = 0.3 * Math.max(0, c) - 0.2 * Math.max(0, s);
      t.footR = 0.3 * Math.max(0, -c) - 0.2 * Math.max(0, -s);
      t.armLX = 1.1 * s;
      t.armRX = -1.1 * s;
      t.armLZ = 0.2;
      t.armRZ = -0.2;
      t.elbowL = t.elbowR = -1.45;
      t.bodyPitch = 0.2;
      t.chestX = 0.12;
      t.bodyYaw = 0.12 * s;
      t.chestY = -0.3 * s;
      t.headX = -0.2;
      t.bodyY = -0.05 + 0.055 * Math.cos(2 * phase);
      break;
    }
    case 'jump': {
      t.legLX = -0.7;
      t.kneeL = 1.1;
      t.legRX = 0.25;
      t.kneeR = 0.5;
      t.footR = 0.5;
      t.armLX = -0.9;
      t.armRX = -0.5;
      t.armLZ = 0.5;
      t.armRZ = -0.6;
      t.elbowL = t.elbowR = -0.5;
      t.chestX = -0.08;
      t.headX = -0.15;
      break;
    }
    case 'fall': {
      const flail = Math.sin(time * 7);
      t.legLX = -0.3 + 0.08 * flail;
      t.kneeL = 0.5;
      t.legRX = 0.12 - 0.08 * flail;
      t.kneeR = 0.35;
      t.footL = t.footR = 0.4;
      t.armLZ = 1.15 + 0.08 * flail;
      t.armRZ = -1.15 + 0.08 * flail;
      t.armLX = t.armRX = -0.25;
      t.elbowL = t.elbowR = -0.35;
      t.bodyPitch = 0.12;
      t.headX = 0.1;
      break;
    }
    case 'glide': {
      // Prone, arms spread wide like wings, legs trailing.
      const sway = Math.sin(time * 2.3);
      t.bodyPitch = 1.2 + 0.03 * sway + dive * 0.22;
      // When prone the body's long axis is its Y axis, so yaw becomes bank.
      t.bodyYaw = -turn * 0.5;
      t.bodyY = -0.5;
      t.spineX = -0.1;
      t.chestX = -0.1;
      t.headX = -0.82 - dive * 0.1;
      t.headY = -turn * 0.25;
      t.armLZ = 1.5 + 0.035 * Math.sin(time * 3.1) - turn * 0.12;
      t.armRZ = -1.5 - 0.035 * Math.sin(time * 3.1 + 1.3) - turn * 0.12;
      t.armLY = 0.14;
      t.armRY = -0.14;
      t.elbowL = t.elbowR = -0.1;
      t.legLX = 0.1 + 0.05 * Math.sin(time * 4.2);
      t.legRX = 0.1 - 0.05 * Math.sin(time * 4.2);
      t.legLZ = 0.07;
      t.legRZ = -0.07;
      t.kneeL = t.kneeR = 0.18;
      t.footL = t.footR = 0.75;
      break;
    }
    case 'land': {
      t.bodyY = -0.2;
      t.bodyPitch = 0.3;
      t.legLX = -0.85;
      t.legRX = -0.7;
      t.kneeL = 1.45;
      t.kneeR = 1.3;
      t.footL = -0.5;
      t.footR = -0.45;
      t.armLX = -0.4;
      t.armRX = -0.4;
      t.armLZ = 0.55;
      t.armRZ = -0.55;
      t.elbowL = t.elbowR = -0.6;
      t.headX = -0.2;
      break;
    }
    case 'swim': {
      const p = time * 3.2;
      t.bodyPitch = 1.22;
      t.bodyY = 0.05 + 0.03 * Math.sin(p);
      t.headX = -0.95;
      t.armLZ = 0.9 + 0.5 * Math.sin(p);
      t.armRZ = -0.9 - 0.5 * Math.sin(p);
      t.armLX = t.armRX = -1.2 + 0.7 * Math.cos(p);
      t.elbowL = t.elbowR = -0.5 - 0.4 * Math.cos(p);
      t.legLX = 0.1 + 0.3 * Math.sin(p * 2);
      t.legRX = 0.1 - 0.3 * Math.sin(p * 2);
      t.kneeL = t.kneeR = 0.3;
      t.footL = t.footR = 0.7;
      break;
    }
  }
  return t;
}

export class Character {
  /** Feet are at the origin of this group; it faces +Z before rotation. */
  readonly root: THREE.Group;
  /** Cloth lives in world space; add this to the scene, not to the character. */
  readonly cloth = new THREE.Group();
  readonly rig: Rig;

  private readonly stripL = new ClothStrip(0.22, 0.105, 12, stripColor, 0);
  private readonly stripR = new ClothStrip(0.22, 0.105, 12, stripColor, 2.1);
  private readonly scarf = new ClothStrip(0.085, 0.07, 8, (t) => (t > 0.85 ? 0x6f2421 : 0x8f2f2b), 4.4);
  private readonly pose: Pose = { ...REST };
  private phase = 0;
  private blink = 2;

  private readonly pinA = new THREE.Vector3();
  private readonly pinB = new THREE.Vector3();
  private readonly air = new THREE.Vector3();

  constructor(outline: boolean) {
    this.rig = buildRig(HERO_STYLE, true, outline);
    this.root = this.rig.root;
    this.cloth.add(this.stripL.mesh, this.stripR.mesh, this.scarf.mesh);
  }

  update(dt: number, time: number, state: CharacterState, groundAt: (x: number, z: number) => number): void {
    // Stride follows distance covered, so the feet do not slide.
    const stride = 1.45 + (3.5 - 1.45) * Math.min(1, Math.max(0, (state.speed - 2.6) / 4.4));
    if (state.motion === 'walk' || state.motion === 'run') {
      this.phase += (dt * Math.PI * 2 * Math.max(state.speed, 0.8)) / stride;
    }

    const target = poseFor(state.motion, this.phase, time, state.turn, state.dive);
    const rate = state.motion === 'land' ? 22 : state.motion === 'glide' ? 7 : 12;
    blendPose(this.pose, target, 1 - Math.exp(-dt * rate));
    applyPose(this.rig, this.pose);

    this.blink -= dt;
    if (this.rig.eyes) {
      this.rig.eyes.scale.y = this.blink < 0.1 ? 0.12 : 1;
      if (this.blink < 0) this.blink = 2.5 + Math.random() * 3;
    }

    this.root.updateMatrixWorld(true);
    this.air.copy(state.wind).sub(state.velocity);
    const rp = this.root.position;
    // The body cylinder only makes sense while upright.
    const collider =
      this.pose.bodyPitch < 0.5 ? { x: rp.x, z: rp.z, bottom: rp.y, top: rp.y + 1.3, radius: 0.2 } : null;
    const { armL, armR, chest } = this.rig;
    for (const [arm, strip] of [[armL, this.stripL], [armR, this.stripR]] as const) {
      arm.localToWorld(this.pinA.set(0, -0.045, -0.06));
      arm.localToWorld(this.pinB.set(0, -0.25, -0.052));
      strip.update(dt, time, this.pinA, this.pinB, this.air, groundAt, collider);
    }
    chest.localToWorld(this.pinA.set(0.02, 0.29, -0.1));
    chest.localToWorld(this.pinB.set(0.095, 0.29, -0.075));
    this.scarf.update(dt, time, this.pinA, this.pinB, this.air, groundAt, collider);
  }
}
