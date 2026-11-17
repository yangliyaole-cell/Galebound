import * as THREE from 'three';
import { ClothStrip } from './cloth';
import { capePreviewAt, type CapePreviewMotion, type CapeTier } from './cape-sim';
import { HERO_STYLE, POSE_KEYS, REST, applyPose, buildRig, type Pose, type Rig } from './rig';
import { disposeProceduralHero, loadHeroRig } from './hero-model';

export type Motion = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'glide' | 'land' | 'swim';

export interface CharacterState {
  motion: Motion;
  /** Horizontal speed in m/s. */
  speed: number;
  /** Glide steering, -1 (left) to 1 (right). */
  turn: number;
  /** Glide pitch, 1 dives and -1 flares. */
  dive: number;
  /** 0 with arms spread wide, 1 with them drawn in for speed (Shift while gliding). */
  tuck?: number;
  velocity: THREE.Vector3;
  wind: THREE.Vector3;
  // Optional motion feed from the controller. Staged previews and checks may omit all of these.
  /** Smoothed heading turn rate, rad/s (positive turns toward +X). */
  yawRate?: number;
  /** Forward acceleration along the ground, m/s^2 (negative while braking). */
  accel?: number;
  /** 1 while skidding round a sharp reversal. */
  skid?: number;
  /** Vertical velocity, m/s. */
  vy?: number;
  grounded?: boolean;
  /** Downward speed at touchdown, m/s, on the landing frame only. */
  impact?: number;
  /** Glide airspeed (or ground speed elsewhere), m/s. */
  airspeed?: number;
  /** Height above the ground while airborne, m. */
  clearance?: number;
  /** Seconds since the cloths opened. */
  glideTime?: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function mixPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  const out = { ...a };
  for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

const CLOTH = 0x17181d;
const CLOTH_EDGE = 0x6f5c3a;

/** Near-black cloth that fades to dull bronze at the free end. */
const stripColor = (t: number): number => (t > 0.95 ? CLOTH_EDGE : t > 0.5 ? 0x1d1f26 : CLOTH);

export function poseFor(motion: Motion, phase: number, time: number, turn: number, dive: number, tuck = 0): Pose {
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
      // Tucking draws the arms partway in toward the body, like a swift folding its wings.
      const spread = 1.5 - tuck * 0.65;
      const flutter = 0.035 * (1 - tuck * 0.6);
      t.bodyPitch += tuck * 0.08;
      t.armLZ = spread + flutter * Math.sin(time * 3.1) - turn * 0.12;
      t.armRZ = -spread - flutter * Math.sin(time * 3.1 + 1.3) - turn * 0.12;
      t.armLY = 0.14 + tuck * 0.12;
      t.armRY = -0.14 - tuck * 0.12;
      t.elbowL = t.elbowR = -0.1 - tuck * 0.25;
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
  rig: Rig;
  private modelLoad: Promise<void> | null = null;

  private readonly stripL = new ClothStrip(0.22, 0.105, 12, stripColor, 0);
  private readonly stripR = new ClothStrip(0.22, 0.105, 12, stripColor, 2.1);
  private readonly scarf = new ClothStrip(0.085, 0.07, 8, (t) => (t > 0.85 ? 0x6f2421 : 0x8f2f2b), 4.4);
  private readonly pose: Pose = { ...REST };
  /** Per-channel velocity of the pose spring: transitions ease in and out instead of snapping. */
  private readonly poseVel: Pose = Object.fromEntries(POSE_KEYS.map((k) => [k, 0])) as unknown as Pose;
  private phase = 0;
  /** Landing/launch compression spring (metres of hip drop) and its velocity. */
  private crouch = 0;
  private crouchVel = 0;
  private skid = 0;
  private wasGrounded = true;
  /** Foot planting: blend weight, smoothed hip drop and the ground slope along the facing. */
  private plant = 0;
  private hipDrop = 0;
  private slope = 0;
  private readonly footPos = new THREE.Vector3();
  private blink = 2;
  private capeGlide = 0;
  capeTier: CapeTier = 'medium';

  private readonly pinA = new THREE.Vector3();
  private readonly pinB = new THREE.Vector3();
  private readonly air = new THREE.Vector3();

  constructor(outline: boolean) {
    this.rig = buildRig(HERO_STYLE, true, outline);
    this.root = this.rig.root;
    this.cloth.add(this.stripL.mesh, this.stripR.mesh, this.scarf.mesh);
  }

  /** Preserve the controller's root object, pose state and world-space cloth. */
  loadModel(): Promise<void> {
    return this.modelLoad ??= this.installModel();
  }

  private async installModel(): Promise<void> {
    try {
      const rig = await loadHeroRig(this.capeTier);
      disposeProceduralHero(this.root);
      this.root.clear();
      this.root.add(...rig.root.children);
      this.rig = { ...rig, root: this.root };
      this.cloth.visible = !this.rig.setCapeState;
      applyPose(this.rig, this.pose);
    } catch (error) {
      // The locally generated character remains playable if the asset is missing.
      console.warn('Could not load the detailed traveler; using the procedural hero.', error);
    }
  }

  /** Fixed-step debug take. A staging path keeps every take at the requested world location. */
  prepareCapeShot(params: URLSearchParams, groundAt: (x: number, z: number) => number, camera: THREE.PerspectiveCamera): void {
    const choice = params.get('capemotion') ?? 'idle';
    const sequence: CapePreviewMotion = ['idle', 'run', 'jump', 'glide', 'turn'].includes(choice) ? choice as CapePreviewMotion : 'idle';
    const requested = Number(params.get('capet') ?? 3);
    const seconds = Number.isFinite(requested) ? Math.min(30, Math.max(0, requested)) : 3;
    const origin = this.root.position.clone(), heading = this.root.rotation.y;
    const elevation = origin.y - groundAt(origin.x, origin.z);
    const velocity = new THREE.Vector3(), wind = new THREE.Vector3();
    let lastDistance = 0;
    const step = (time: number): void => {
      const take = capePreviewAt(sequence, time);
      const before = this.root.position.clone();
      // Integrate the run around the turn; stopping never snaps the staging path back.
      const travel = take.distance - lastDistance;
      const yaw = heading + take.yaw;
      this.root.position.x += Math.sin(yaw) * travel;
      this.root.position.z += Math.cos(yaw) * travel;
      this.root.position.y = groundAt(this.root.position.x, this.root.position.z) + elevation + take.height;
      this.root.rotation.y = yaw;
      velocity.copy(this.root.position).sub(before).multiplyScalar(60);
      wind.fromArray(take.wind).applyAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
      this.update(1 / 60, time, { motion: take.motion, speed: take.speed, turn: take.turn, dive: 0, velocity, wind }, groundAt);
      lastDistance = take.distance;
    };
    // Settle the hanging fabric before the sequence. Every capet starts from the same state.
    for (let i = -90; i <= 0; i++) step(i / 60);
    for (let i = 1; i <= Math.round(seconds * 60); i++) step(i / 60);
    this.rig.setBlink?.(false);
    // Camera is fixed in world space after the take, 3.6m off the original rear/side bearing.
    // Keeping the original bearing exposes the actual tail lag during the turn take.
    const angle = Number(params.get('capeangle') ?? -0.55);
    const bearing = heading + Math.PI + (Number.isFinite(angle) ? angle : -0.55);
    const distance = Math.max(2.8, Math.min(8, Number(params.get('dist') ?? 3.6) || 3.6));
    const target = this.root.position.clone().add(new THREE.Vector3(0, 0.95, 0));
    camera.position.copy(target).add(new THREE.Vector3(Math.sin(bearing) * distance, 0.85, Math.cos(bearing) * distance));
    camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 0.6);
    camera.lookAt(target); camera.fov = 48; camera.near = 0.05; camera.updateProjectionMatrix();
    // Retain the requested staging origin for external screenshot notes/debugging.
    this.root.userData.capeShot = { sequence, seconds: Math.round(seconds * 60) / 60, origin: origin.toArray(), heading,
      camera: camera.position.toArray(), target: target.toArray() };
  }

  /** Idle stance, tuned for the imported anatomy when it is loaded. */
  private idlePose(time: number): Pose {
    const target = poseFor('idle', this.phase, time, 0, 0);
    if (this.rig.setMaskVisible) {
      // Relax the new anatomy into a small weight shift, with shoulders back
      // and unequal elbow flexion, rather than a symmetric mannequin stance.
      target.bodyRoll += 0.015;
      target.spineZ -= 0.012;
      target.chestX -= 0.025;
      target.armLZ = 0.075;
      target.armRZ = -0.105;
      target.elbowL = -0.08;
      target.elbowR = -0.16;
    }
    return target;
  }

  /**
   * One blended target pose. Locomotion is parametric: idle, walk and run are mixed by speed
   * on one shared step phase (so blends never cross-step), then lean, bank, skid and the landing
   * spring are layered on top. Air and glide poses follow vertical speed, airspeed and height.
   */
  private targetPose(dt: number, time: number, state: CharacterState): Pose {
    const speed = state.speed;
    const ground = state.motion === 'idle' || state.motion === 'walk' || state.motion === 'run' || state.motion === 'land';
    let target: Pose;
    if (ground) {
      // Walk and run share one phase; stride lengthens with speed, so feet stay planted.
      const gait = smooth(3.0, 5.8, speed);
      const stride = 1.5 + (3.55 - 1.5) * gait;
      if (speed > 0.05) this.phase += (dt * Math.PI * 2 * Math.max(speed, 0.45)) / stride;
      const loco = mixPose(poseFor('walk', this.phase, time, 0, 0), poseFor('run', this.phase, time, 0, 0), gait);
      // A slow shuffle swings the limbs less rather than stepping in place.
      const move = smooth(0.08, 1.4, speed);
      target = mixPose(this.idlePose(time), loco, move);
      // Lean into acceleration, back against braking; bank into turns like a runner.
      const accel = state.accel ?? 0;
      target.bodyPitch += Math.max(-0.2, Math.min(0.16, accel * 0.011)) * move;
      const bank = Math.max(-0.3, Math.min(0.3, -(state.yawRate ?? 0) * speed * 0.02));
      target.bodyRoll += bank;
      target.spineZ -= bank * 0.35;
      // The head leads into the turn and steadies against the stride.
      target.headY += Math.max(-0.3, Math.min(0.3, (state.yawRate ?? 0) * 0.07));
      // Lean into a climb, sit back a little going downhill.
      target.bodyPitch += this.slope * (0.18 + 0.3 * move);
      target.chestX += this.slope * 0.1 * move;
      target.headX -= target.bodyPitch * 0.4;
      // Skid: brace, lean back, arms out for balance.
      this.skid += ((state.skid ?? 0) - this.skid) * (1 - Math.exp(-dt * 12));
      if (this.skid > 0.01) {
        const k = this.skid;
        target = mixPose(target, { ...target, bodyPitch: -0.22, bodyY: -0.09, legLX: -0.65, kneeL: 0.35, footL: 0.2,
          legRX: 0.45, kneeR: 0.75, footR: -0.35, armLZ: 0.75, armRZ: -0.75, armLX: -0.3, armRX: -0.3,
          elbowL: -0.5, elbowR: -0.5, chestX: -0.05, headX: 0.05 }, k * 0.85);
      }
      if (state.motion === 'land') this.crouchVel = Math.min(this.crouchVel, -0.6);
    } else if (state.motion === 'jump' || state.motion === 'fall') {
      // Rising tuck eases into the open-armed fall as vertical speed turns negative.
      const vy = state.vy ?? (state.motion === 'jump' ? 4 : -4);
      target = mixPose(poseFor('jump', this.phase, time, 0, 0), poseFor('fall', this.phase, time, 0, 0), smooth(2.5, -5, vy));
      // A long drop pedals the legs and reaches with the arms a little more.
      const drop = smooth(-6, -20, vy);
      if (drop > 0) {
        const pedal = Math.sin(time * 9);
        target.legLX += 0.25 * pedal * drop;
        target.legRX -= 0.25 * pedal * drop;
        target.armLZ += 0.2 * drop;
        target.armRZ -= 0.2 * drop;
        target.headX += 0.15 * drop;
      }
    } else if (state.motion === 'glide') {
      target = this.glidePose(time, state);
    } else {
      target = poseFor(state.motion, this.phase, time, state.turn, state.dive, state.tuck ?? 0);
    }

    // Landing compression and take-off extension, as a damped spring on the hips.
    const grounded = state.grounded ?? ground;
    const impact = state.impact ?? 0;
    if (impact > 2) this.crouchVel -= Math.min(3.2, impact * 0.2);
    if (this.wasGrounded && !grounded && (state.vy ?? 0) > 4) this.crouchVel += 0.55;
    this.wasGrounded = grounded;
    const w = 11, zeta = 0.6;
    for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.crouchVel += (-w * w * this.crouch - 2 * zeta * w * this.crouchVel) * h;
      this.crouch = Math.max(-0.28, Math.min(0.1, this.crouch + this.crouchVel * h));
    }
    const c = this.crouch;
    if (Math.abs(c) > 1e-4) {
      // Hips drop, thighs fold forward, knees bend; feet stay flat, chest leans over the knees.
      const down = Math.min(0, c);
      target.bodyY += c;
      target.legLX += 1.6 * down;
      target.legRX += 1.6 * down;
      target.kneeL -= 3.2 * down;
      target.kneeR -= 3.2 * down;
      target.footL += 1.6 * down;
      target.footR += 1.6 * down;
      target.bodyPitch -= 0.9 * down;
      target.headX += 0.6 * down;
      target.armLZ -= 0.8 * down;
      target.armRZ += 0.8 * down;
      target.armLX += 0.6 * down;
      target.armRX += 0.6 * down;
    }
    return target;
  }

  /**
   * Flight pose: prone with arms spread; banks and dips the inner arm in turns, flares upright
   * when slow or about to touch down, and sweeps the arms open over the first moments of flight.
   */
  private glidePose(time: number, state: CharacterState): Pose {
    const turn = state.turn, tuck = state.tuck ?? 0;
    const target = poseFor('glide', this.phase, time, turn, state.dive, tuck);
    // Turning: the inner wing drops, the outer lifts, and the head looks into the turn.
    target.armLZ -= turn * 0.22;
    target.armRZ -= turn * 0.22;
    target.armLX += turn * 0.12;
    target.armRX -= turn * 0.12;
    target.headY -= turn * 0.12;
    // Slow flight or the last couple of metres: pitch up, legs swing down to meet the ground.
    const slow = smooth(10.5, 6.5, state.airspeed ?? 14) * 0.75;
    const nearGround = smooth(2.8, 0.7, state.clearance ?? 10) * smooth(1, -1, state.vy ?? -1);
    const flare = Math.max(slow, nearGround);
    if (flare > 0.01) {
      const kick = Math.sin(time * 5.5) * 0.12;
      Object.assign(target, mixPose(target, {
        ...target, bodyPitch: 0.42, bodyY: -0.25, bodyYaw: target.bodyYaw * 0.5, spineX: 0.05, chestX: -0.12, headX: -0.2,
        armLZ: 1.35, armRZ: -1.35, armLX: -0.55, armRX: -0.55, armLY: 0.1, armRY: -0.1, elbowL: -0.35, elbowR: -0.35,
        legLX: -0.55 + kick, legRX: -0.35 - kick, kneeL: 0.55, kneeR: 0.7, footL: 0.15, footR: 0.15, legLZ: 0.05, legRZ: -0.05,
      }, flare));
    }
    // Opening: arms sweep up past the shoulders and stroke down into the spread.
    const opening = clamp01((state.glideTime ?? 1) / 0.5);
    if (opening < 1) {
      const stroke = Math.sin(Math.PI * opening);
      target.armLZ += 0.75 * stroke;
      target.armRZ -= 0.75 * stroke;
      target.armLX -= 0.35 * stroke;
      target.armRX -= 0.35 * stroke;
      target.kneeL += 0.5 * stroke;
      target.kneeR += 0.35 * stroke;
      target.chestX -= 0.12 * stroke;
    }
    return target;
  }

  /**
   * Feet on uneven ground. The cycle is authored for flat ground under the body's centre, so on a
   * slope the uphill foot sank and the downhill one floated. Each foot reads the terrain under it;
   * the hips drop to the lower one and the other leg is shortened with an analytic two-bone solve
   * (knee from the law of cosines, thigh swung to keep the ankle on the same hip-ankle line, foot
   * counter-rotated to stay level). Large steps (stairs, bridges over terrain) are left alone.
   */
  private plantFeet(dt: number, state: CharacterState, groundAt: (x: number, z: number) => number): Pose | null {
    const grounded = (state.grounded ?? true) && (state.motion === 'idle' || state.motion === 'walk'
      || state.motion === 'run' || state.motion === 'land');
    this.plant += ((grounded ? 1 : 0) - this.plant) * (1 - Math.exp(-dt * 10));
    if (this.plant < 0.01) {
      this.hipDrop = 0;
      return null;
    }
    const rig = this.rig, base = this.root.position.y;
    this.root.updateMatrixWorld(true);
    const offset = [rig.footL, rig.footR].map((foot) => {
      foot.getWorldPosition(this.footPos);
      const o = groundAt(this.footPos.x, this.footPos.z) - base;
      return Number.isFinite(o) && Math.abs(o) < 0.4 ? o : 0;
    });
    const drop = Math.max(-0.3, Math.min(0, offset[0], offset[1]));
    this.hipDrop += (drop - this.hipDrop) * (1 - Math.exp(-dt * 14));
    const w = this.plant, p = { ...this.pose };
    p.bodyY += this.hipDrop * w;
    const legs = [['legLX', 'kneeL', 'footL', rig.shinL, rig.footL], ['legRX', 'kneeR', 'footR', rig.shinR, rig.footR]] as const;
    legs.forEach(([hipKey, kneeKey, footKey, shin, foot], i) => {
      const shorten = Math.max(0, offset[i] - this.hipDrop) * w;
      if (shorten < 1e-4) return;
      const a = shin.position.length(), b = foot.position.length();
      const k0 = p[kneeKey], c0 = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(k0));
      const c1 = Math.max(0.55 * (a + b), c0 - shorten);
      const k1 = Math.acos(Math.max(-1, Math.min(1, (c1 * c1 - a * a - b * b) / (2 * a * b))));
      const angle = (k: number, c: number): number => Math.asin(Math.max(-1, Math.min(1, b * Math.sin(k) / c)));
      const swing = -(angle(k1, c1) - angle(k0, c0));
      p[hipKey] += swing;
      p[kneeKey] = k1;
      p[footKey] -= swing + (k1 - k0);
    });
    return p;
  }

  update(dt: number, time: number, state: CharacterState, groundAt: (x: number, z: number) => number): void {
    // Ground slope along the facing (rise over run), ignoring steps the terrain does not know about.
    const yaw = this.root.rotation.y, fx = Math.sin(yaw) * 0.6, fz = Math.cos(yaw) * 0.6, at = this.root.position;
    const rise = (groundAt(at.x + fx, at.z + fz) - groundAt(at.x - fx, at.z - fz)) / 1.2;
    const slope = Number.isFinite(rise) && Math.abs(rise) < 1.2 ? Math.max(-0.5, Math.min(0.5, rise)) : 0;
    this.slope += (slope - this.slope) * (1 - Math.exp(-dt * 6));
    const target = this.targetPose(dt, time, state);
    // Critically damped spring per channel. Stiffer for footwork and landings, softer for flight.
    const omega = state.motion === 'glide' ? 8 : state.motion === 'jump' || state.motion === 'fall' ? 12
      : state.motion === 'swim' ? 7 : state.motion === 'land' ? 22 : 17;
    const pose = this.pose, vel = this.poseVel;
    for (let left = Math.max(0, Math.min(dt, 0.1)); left > 1e-6; left -= 1 / 90) {
      const h = Math.min(left, 1 / 90);
      for (const key of POSE_KEYS) {
        vel[key] += (omega * omega * (target[key] - pose[key]) - 2 * omega * vel[key]) * h;
        pose[key] += vel[key] * h;
      }
    }
    applyPose(this.rig, this.pose);
    const planted = this.plantFeet(dt, state, groundAt);
    if (planted) applyPose(this.rig, planted);
    this.capeGlide += ((state.motion === 'glide' ? 1 : 0) - this.capeGlide) * (1 - Math.exp(-dt * 6));

    this.blink -= dt;
    const closed = this.blink < 0.1;
    if (this.rig.eyes) {
      this.rig.eyes.scale.y = closed ? 0.12 : 1;
    }
    this.rig.setBlink?.(closed);
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3;

    this.root.updateMatrixWorld(true);
    this.rig.updateHair?.(dt, time, state.wind);
    if (this.rig.setCapeState) {
      this.rig.setCapeState(this.capeGlide, dt, time, state.wind, state.velocity, groundAt);
      return;
    }
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

/** teleport() updates Player first; preview must use that pose before its very first cloth step. */
export function prepareCapeShotFromPlayer(
  player: { character: Character; pos: THREE.Vector3; yaw: number }, params: URLSearchParams,
  groundAt: (x: number, z: number) => number, camera: THREE.PerspectiveCamera,
): void {
  player.character.root.position.copy(player.pos);
  player.character.root.rotation.y = player.yaw;
  player.character.prepareCapeShot(params, groundAt, camera);
  player.pos.copy(player.character.root.position);
  player.yaw = player.character.root.rotation.y;
}

/** Shared by the browser ready gate and the Node scene regression; no renderer required. */
export function inspectCapeShotScene(scene: THREE.Scene, terrain: THREE.Object3D, character: Character,
  camera: THREE.PerspectiveCamera, groundAt: (x: number, z: number) => number, requireCape = true) {
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const issues: string[] = [];
  const visible = new Set<THREE.Object3D>();
  scene.traverseVisible(object => visible.add(object));
  let terrainMeshes = 0;
  terrain.traverseVisible(object => { if (object instanceof THREE.Mesh && visible.has(object)) terrainMeshes++; });
  if (!scene.userData.worldBuilt) issues.push('World construction has not completed');
  if (!terrainMeshes) issues.push('Terrain is absent from the visible scene');
  const cameraClearance = camera.position.y - groundAt(camera.position.x, camera.position.z);
  if (!Number.isFinite(cameraClearance) || cameraClearance < 0.2) issues.push('Cape camera is below or too close to terrain');
  const root = character.root;
  if (root.position.y < groundAt(root.position.x, root.position.z) - 0.05) issues.push('Character staging pose is below terrain');
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const vertex = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let capeMeshes = 0, vertices = 0, inView = 0, area = 0, maxBodyDistance = 0;
  for (const object of visible) {
    if (!(object instanceof THREE.Mesh) || !object.name.endsWith('_SoftCloth')) continue;
    capeMeshes++;
    const material = object.material as THREE.MeshStandardMaterial;
    if (!material.visible || material.opacity < 0.99 || material.side !== THREE.DoubleSide) issues.push('Cape material is hidden or not double sided');
    const geometry = object.geometry, position = geometry.attributes.position, index = geometry.index;
    if (!position || !index) { issues.push('Cape has no indexed cloth surface'); continue; }
    vertices += position.count;
    for (let n = 0; n < position.count; n++) {
      vertex.fromBufferAttribute(position, n).applyMatrix4(object.matrixWorld);
      if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) { issues.push('Non-finite cape vertex'); break; }
      maxBodyDistance = Math.max(maxBodyDistance, vertex.distanceTo(root.position));
      if (frustum.containsPoint(vertex)) inView++;
    }
    for (let n = 0; n < index.count; n += 3) {
      a.fromBufferAttribute(position, index.getX(n)).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position, index.getX(n + 1)).applyMatrix4(object.matrixWorld).sub(a);
      c.fromBufferAttribute(position, index.getX(n + 2)).applyMatrix4(object.matrixWorld).sub(a);
      area += b.cross(c).length() * 0.5;
    }
  }
  if (requireCape) {
    if (!capeMeshes) issues.push('No visible soft cape is attached to the scene');
    if (area < 0.05 || !Number.isFinite(area)) issues.push('Cape surface is degenerate');
    if (maxBodyDistance > 4) issues.push('Cape has separated from the character');
    if (!vertices || inView / vertices < 0.7) issues.push('Cape is outside the screenshot camera');
  }
  return { ok: issues.length === 0, issues, terrainMeshes, capeMeshes, vertices, inView, area, maxBodyDistance, cameraClearance };
}
