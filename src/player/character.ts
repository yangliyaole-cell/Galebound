import * as THREE from 'three';
import { toon } from '../render/toon';
import { ClothStrip } from './cloth';

export type Motion = 'idle' | 'walk' | 'run' | 'glide';

const SKIN = 0xf6d5b9;
const HAIR = 0x4b3026;
const TUNIC = 0xf5eedc;
const TROUSERS = 0x345a6e;
const LEATHER = 0x7c5030;
const BOOT = 0x5a3a27;
const ACCENT = 0xd9472f;
const TRIM = 0xf2c462;

const HIP_HEIGHT = 0.88;

/** Joint angles in radians. Forward is +Z; a positive x angle swings a limb backward. */
interface Pose {
  bodyPitch: number;
  bodyY: number;
  spineX: number;
  spineY: number;
  headX: number;
  headY: number;
  armLX: number;
  armLZ: number;
  armRX: number;
  armRZ: number;
  elbowL: number;
  elbowR: number;
  legLX: number;
  legRX: number;
  kneeL: number;
  kneeR: number;
}

const REST: Pose = {
  bodyPitch: 0, bodyY: 0, spineX: 0, spineY: 0, headX: 0, headY: 0,
  armLX: 0, armLZ: 0.12, armRX: 0, armRZ: -0.12, elbowL: -0.1, elbowR: -0.1,
  legLX: 0, legRX: 0, kneeL: 0, kneeR: 0,
};

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** A capsule hanging down from its origin, so it rotates about its top end. */
function limb(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 10).translate(0, -length / 2, 0);
}

export class Character {
  /** Feet are at the origin of this group; it faces +Z before rotation. */
  readonly root = new THREE.Group();
  /** Cloth lives in world space; add this to the scene, not to the character. */
  readonly cloth = new THREE.Group();

  private readonly body: THREE.Group;
  private readonly spine: THREE.Group;
  private readonly head: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly elbowL: THREE.Group;
  private readonly elbowR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly kneeL: THREE.Group;
  private readonly kneeR: THREE.Group;

  private readonly stripL = new ClothStrip(0.2, 0.125, 9, ACCENT, TRIM, 0);
  private readonly stripR = new ClothStrip(0.2, 0.125, 9, ACCENT, TRIM, 2.1);
  private readonly pose: Pose = { ...REST };
  private stride = 0;

  private readonly pinA = new THREE.Vector3();
  private readonly pinB = new THREE.Vector3();
  private readonly air = new THREE.Vector3();

  constructor() {
    const skin = toon(SKIN);
    const hair = toon(HAIR);
    const tunic = toon(TUNIC);
    const trousers = toon(TROUSERS);
    const leather = toon(LEATHER);
    const boot = toon(BOOT);
    const accent = toon(ACCENT);

    this.body = pivot(this.root, 0, HIP_HEIGHT, 0);

    // Hips: trousers, belt, the skirt of the tunic and a pouch.
    add(this.body, new THREE.SphereGeometry(0.15, 14, 10), trousers).scale.set(1, 0.62, 0.8);
    add(
      this.body,
      new THREE.CylinderGeometry(0.152, 0.215, 0.25, 16, 1, true),
      toon(TUNIC, { doubleSided: true }),
      0, -0.075, 0,
    ).scale.z = 0.82;
    add(this.body, new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), leather, 0, 0.05, 0).scale.z = 0.82;
    add(this.body, new THREE.BoxGeometry(0.035, 0.05, 0.02), toon(TRIM), 0, 0.05, 0.132);
    add(this.body, new THREE.BoxGeometry(0.07, 0.1, 0.09), leather, -0.165, -0.03, 0.02);

    // Torso, scarf and neck.
    this.spine = pivot(this.body, 0, 0.05, 0);
    add(this.spine, new THREE.CylinderGeometry(0.165, 0.15, 0.36, 16), tunic, 0, 0.2, 0).scale.z = 0.76;
    add(this.spine, new THREE.SphereGeometry(0.165, 16, 10), tunic, 0, 0.38, 0).scale.set(1, 0.45, 0.76);
    add(this.spine, new THREE.CylinderGeometry(0.046, 0.05, 0.1, 10), skin, 0, 0.47, 0);
    const scarf = add(this.spine, new THREE.TorusGeometry(0.088, 0.046, 8, 18), accent, 0, 0.445, 0);
    scarf.rotation.x = Math.PI / 2;
    scarf.scale.set(1, 0.9, 1);
    const scarfTail = add(this.spine, new THREE.BoxGeometry(0.07, 0.2, 0.02), accent, 0.06, 0.34, -0.125);
    scarfTail.rotation.set(-0.18, 0, 0.12);

    // Head, hair and face.
    this.head = pivot(this.spine, 0, 0.61, 0);
    add(this.head, new THREE.SphereGeometry(0.14, 20, 16), skin).scale.set(0.95, 1.05, 0.98);
    const cap = add(
      this.head,
      new THREE.SphereGeometry(0.153, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hair,
      0, 0.012, -0.004,
    );
    cap.rotation.x = -0.42;
    add(this.head, new THREE.SphereGeometry(0.13, 14, 10), hair, 0, -0.035, -0.055).scale.set(1.06, 1.12, 0.72);
    for (const [x, tilt] of [[-0.075, 0.35], [-0.025, 0.1], [0.03, -0.12], [0.08, -0.38]]) {
      const lock = add(this.head, new THREE.SphereGeometry(0.05, 10, 8), hair, x, 0.08, 0.112);
      lock.scale.set(0.85, 0.62, 0.42);
      lock.rotation.set(0.35, 0, tilt);
    }
    const tuft = add(this.head, new THREE.ConeGeometry(0.03, 0.11, 6), hair, 0.01, 0.165, -0.02);
    tuft.rotation.set(-0.5, 0, -0.3);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b1d18 });
    for (const x of [-0.052, 0.052]) {
      const eye = add(this.head, new THREE.SphereGeometry(0.017, 10, 8), eyeMat, x, -0.012, 0.128);
      eye.scale.set(1, 1.55, 0.4);
      eye.castShadow = false;
    }

    // Arms. The cloth is sewn along the back seam of each upper arm.
    const makeArm = (side: number): [THREE.Group, THREE.Group] => {
      const arm = pivot(this.spine, 0.2 * side, 0.37, 0);
      add(arm, new THREE.SphereGeometry(0.068, 12, 10), tunic);
      add(arm, limb(0.052, 0.28), tunic);
      add(arm, new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), accent, 0, -0.045, 0);
      add(arm, new THREE.CylinderGeometry(0.058, 0.058, 0.035, 12), accent, 0, -0.225, 0);
      add(arm, new THREE.BoxGeometry(0.03, 0.2, 0.024), accent, 0, -0.135, -0.05);
      const elbow = pivot(arm, 0, -0.27, 0);
      add(elbow, limb(0.044, 0.26), skin);
      add(elbow, new THREE.CylinderGeometry(0.052, 0.047, 0.11, 12), leather, 0, -0.17, 0);
      add(elbow, new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.285, 0).scale.set(0.8, 1.1, 1);
      return [arm, elbow];
    };
    [this.armL, this.elbowL] = makeArm(1);
    [this.armR, this.elbowR] = makeArm(-1);

    // Legs and boots.
    const makeLeg = (side: number): [THREE.Group, THREE.Group] => {
      const leg = pivot(this.body, 0.085 * side, -0.02, 0);
      add(leg, limb(0.072, 0.44), trousers);
      const knee = pivot(leg, 0, -0.42, 0);
      add(knee, limb(0.058, 0.4), trousers);
      add(knee, new THREE.CylinderGeometry(0.07, 0.062, 0.2, 12), boot, 0, -0.27, 0);
      add(knee, new THREE.CylinderGeometry(0.076, 0.074, 0.035, 12), leather, 0, -0.175, 0);
      add(knee, new THREE.SphereGeometry(0.07, 12, 8), boot, 0, -0.41, 0.045).scale.set(0.95, 0.62, 1.7);
      return [leg, knee];
    };
    [this.legL, this.kneeL] = makeLeg(1);
    [this.legR, this.kneeR] = makeLeg(-1);

    this.cloth.add(this.stripL.mesh, this.stripR.mesh);
  }

  private target(motion: Motion, time: number): Pose {
    const t: Pose = { ...REST };
    const p = this.stride;
    const s = Math.sin(p);
    const c = Math.cos(p);
    if (motion === 'idle') {
      const breath = Math.sin(time * 1.7);
      t.spineX = 0.02 + 0.012 * breath;
      t.bodyY = -0.004 * breath;
      t.armLZ = 0.13 + 0.012 * breath;
      t.armRZ = -t.armLZ;
      t.headY = Math.sin(time * 0.45) * 0.3;
      t.headX = Math.sin(time * 0.31 + 1) * 0.06;
    } else if (motion === 'walk') {
      t.legLX = -0.5 * s;
      t.legRX = 0.5 * s;
      t.kneeL = 0.06 + 0.8 * Math.max(0, c);
      t.kneeR = 0.06 + 0.8 * Math.max(0, -c);
      t.armLX = 0.45 * s;
      t.armRX = -0.45 * s;
      t.elbowL = t.elbowR = -0.35;
      t.spineX = 0.05;
      t.spineY = 0.09 * s;
      t.bodyY = -0.02 + 0.015 * Math.cos(2 * p);
    } else if (motion === 'run') {
      t.legLX = -0.9 * s - 0.1;
      t.legRX = 0.9 * s - 0.1;
      t.kneeL = 0.2 + 1.5 * Math.max(0, c);
      t.kneeR = 0.2 + 1.5 * Math.max(0, -c);
      t.armLX = 0.95 * s;
      t.armRX = -0.95 * s;
      t.armLZ = 0.2;
      t.armRZ = -0.2;
      t.elbowL = t.elbowR = -1.4;
      t.bodyPitch = 0.16;
      t.spineX = 0.16;
      t.spineY = 0.16 * s;
      t.headX = -0.14;
      t.bodyY = -0.05 + 0.05 * Math.cos(2 * p);
    } else {
      // Glide: prone, arms spread wide, legs trailing.
      const sway = Math.sin(time * 2.3);
      t.bodyPitch = 1.18 + 0.04 * sway;
      t.spineX = -0.14;
      t.headX = -0.8;
      t.armLZ = 1.47 + 0.04 * Math.sin(time * 3.1);
      t.armRZ = -1.47 - 0.04 * Math.sin(time * 3.1 + 1.3);
      t.elbowL = t.elbowR = -0.12;
      t.legLX = 0.14 + 0.05 * Math.sin(time * 4.2);
      t.legRX = 0.14 - 0.05 * Math.sin(time * 4.2);
      t.kneeL = t.kneeR = 0.22;
    }
    return t;
  }

  /**
   * @param velocity world-space velocity of the character
   * @param wind world-space wind velocity
   */
  update(
    dt: number,
    time: number,
    motion: Motion,
    velocity: THREE.Vector3,
    wind: THREE.Vector3,
    groundAt: (x: number, z: number) => number,
  ): void {
    if (motion === 'walk') this.stride += dt * 7.0;
    else if (motion === 'run') this.stride += dt * 9.4;

    const target = this.target(motion, time);
    const k = 1 - Math.exp(-dt * 11);
    const pose = this.pose;
    for (const key of Object.keys(pose) as (keyof Pose)[]) {
      pose[key] += (target[key] - pose[key]) * k;
    }

    this.body.position.y = HIP_HEIGHT + pose.bodyY;
    this.body.rotation.x = pose.bodyPitch;
    this.spine.rotation.set(pose.spineX, pose.spineY, 0);
    this.head.rotation.set(pose.headX, pose.headY - pose.spineY, 0);
    this.armL.rotation.set(pose.armLX, 0, pose.armLZ);
    this.armR.rotation.set(pose.armRX, 0, pose.armRZ);
    this.elbowL.rotation.x = pose.elbowL;
    this.elbowR.rotation.x = pose.elbowR;
    this.legL.rotation.x = pose.legLX;
    this.legR.rotation.x = pose.legRX;
    this.kneeL.rotation.x = pose.kneeL;
    this.kneeR.rotation.x = pose.kneeR;

    this.root.updateMatrixWorld(true);
    this.air.copy(wind).sub(velocity);
    const rp = this.root.position;
    // The body cylinder only makes sense while upright.
    const collider =
      pose.bodyPitch < 0.5
        ? { x: rp.x, z: rp.z, bottom: rp.y, top: rp.y + 1.35, radius: 0.19 }
        : null;
    for (const [arm, strip] of [[this.armL, this.stripL], [this.armR, this.stripR]] as const) {
      arm.localToWorld(this.pinA.set(0, -0.035, -0.06));
      arm.localToWorld(this.pinB.set(0, -0.235, -0.06));
      strip.update(dt, time, this.pinA, this.pinB, this.air, groundAt, collider);
    }
  }
}
