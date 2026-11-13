import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Rig } from './rig';
import { CapeSimulation, capePatternFromMesh, sampleCape, resolveCapeCollisions, capePenetration, type CapeCapsule, type CapeTier } from './cape-sim';

type JointName = 'body' | 'spine' | 'chest' | 'head' | 'armL' | 'foreL' | 'handL' |
  'armR' | 'foreR' | 'handR' | 'legL' | 'shinL' | 'footL' | 'legR' | 'shinR' | 'footR';

// The semantic parent relationships stay stable; bind positions now come from
// the Blender skeleton so anatomy can change without distorting the new model.
const JOINTS: [JointName, JointName | null][] = [
  ['body', null], ['spine', 'body'], ['chest', 'spine'], ['head', 'chest'],
  ['armL', 'chest'], ['foreL', 'armL'], ['handL', 'foreL'],
  ['armR', 'chest'], ['foreR', 'armR'], ['handR', 'foreR'],
  ['legL', 'body'], ['shinL', 'legL'], ['footL', 'shinL'],
  ['legR', 'body'], ['shinR', 'legR'], ['footR', 'shinR'],
];

/** Load a normal weighted Blender asset and adapt it to the game's Pose API. */
export async function loadHeroRig(tier: CapeTier = 'medium'): Promise<Rig> {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/traveler.glb`);
  return createHeroRig(gltf.scene, tier);
}

/** Separate asset adaptation from fetching so Node can check the real skeleton and cloak. */
export function createHeroRig(scene: THREE.Group, tier: CapeTier = 'medium'): Rig {
  const root = new THREE.Group();
  root.name = 'Hero';
  root.add(scene);
  root.updateMatrixWorld(true);
  const bones = JOINTS.map(([name]) => {
    const bone = scene.getObjectByName(name);
    if (!(bone instanceof THREE.Bone)) throw new Error(`Traveler is missing bone ${name}`);
    return bone;
  });
  const bindPositions = new Map(JOINTS.map(([name], i) => [name, bones[i].getWorldPosition(new THREE.Vector3())]));
  const joints = {} as Record<JointName, THREE.Group>;
  for (const [name, parent] of JOINTS) {
    const joint = new THREE.Group();
    joint.name = `pose_${name}`;
    joint.position.copy(bindPositions.get(name)!);
    if (parent) joint.position.sub(bindPositions.get(parent)!);
    (parent ? joints[parent] : root).add(joint);
    joints[name] = joint;
  }
  root.updateMatrixWorld(true);

  const hipHeight = bindPositions.get('body')!.y;
  if (!Number.isFinite(hipHeight) || hipHeight < 0.5 || hipHeight > 1.4) throw new Error('Invalid traveler scale');
  // attach() preserves each bone's exported rest matrix. The semantic parent
  // then rotates about the existing game axes. Skin weights and inverse-bind
  // matrices stay intact, as do all cloth attachment points in Character.
  JOINTS.forEach(([name], i) => joints[name].attach(bones[i]));

  const blinkMeshes: THREE.Mesh[] = [];
  const maskMeshes: THREE.Mesh[] = [];
  const capeMeshes: THREE.SkinnedMesh[] = [];
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object);
  });
  for (const mesh of meshes) {
    mesh.castShadow = true;
    // Cast onto the world; smooth PBR lighting retains the sculpted head volume.
    // Self-shadowing tiny hair/stitched details aliases at the game's shadow scale.
    mesh.receiveShadow = false;
    // Existing animation includes large prone/glide rotations. The default
    // bind-pose bounds are unsuitable for a dynamically driven skin.
    mesh.frustumCulled = false;
    const original = mesh.material as THREE.MeshStandardMaterial;
    original.envMapIntensity = 0.6;
    if (original.map) original.map.anisotropy = 8;
    if (mesh.name.startsWith('Traveler_Mask')) maskMeshes.push(mesh);
    if (mesh.name.startsWith('Traveler_Cape')) capeMeshes.push(mesh);
    if (mesh.morphTargetDictionary?.Blink !== undefined) blinkMeshes.push(mesh);
  }
  root.updateMatrixWorld(true);
  const capes = capeMeshes.map(mesh => new CapeBinding(mesh, tier));
  return {
    root, ...joints, hipHeight, eyes: null,
    setMaskVisible(visible) {
      for (const mesh of maskMeshes) mesh.visible = visible;
    },
    setCapeState: capes.length ? (glide, dt, time, wind, velocity, groundAt) => {
      const colliders = heroCapeColliders(joints);
      for (const cape of capes) cape.update(dt, time, glide, wind, velocity, colliders, groundAt);
    } : undefined,
    capeStats: capes.length ? () => ({ ...capes[0].sim.stats,
      points: capes.reduce((n, c) => n + c.sim.stats.points, 0),
      constraints: capes.reduce((n, c) => n + c.sim.stats.constraints, 0),
      maxPenetration: Math.max(...capes.map(c => c.sim.stats.maxPenetration)),
      simulationMs: capes.reduce((n, c) => n + c.sim.stats.simulationMs, 0),
      updateMs: capes.reduce((n, c) => n + c.updateMs, 0),
      renderVertices: capes.reduce((n, c) => n + c.render.geometry.attributes.position.count, 0),
      renderTriangles: capes.reduce((n, c) => n + c.render.geometry.index!.count / 3, 0),
      drawCalls: capes.length,
    }) : undefined,
    setBlink(closed) {
      for (const mesh of blinkMeshes) {
        mesh.morphTargetInfluences![mesh.morphTargetDictionary!.Blink] = closed ? 1 : 0;
      }
    },
  };
}

/** Dispose only the superseded procedural hero, preserving shared NPC materials. */
export function disposeProceduralHero(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.add(object.geometry);
  });
  geometries.forEach((geometry) => geometry.dispose());
}

/** Anatomical capsules follow the posed joints, including prone/banked flight. Metres. */
export function heroCapeColliders(joints: Pick<Rig, JointName>): CapeCapsule[] {
  const point = (name: JointName, x = 0, y = 0, z = 0): number[] => joints[name].localToWorld(new THREE.Vector3(x, y, z)).toArray();
  const capsules: CapeCapsule[] = [
    { a: point('body', 0, -0.04), b: point('chest', 0, 0.12), radius: 0.145 },
    { a: point('armL'), b: point('armR'), radius: 0.108 },
    { a: point('legL'), b: point('legR'), radius: 0.12 },
  ];
  for (const side of ['L', 'R'] as const) {
    capsules.push(
      { a: point(`arm${side}`), b: point(`fore${side}`), radius: 0.075 },
      { a: point(`fore${side}`), b: point(`hand${side}`), radius: 0.059 },
      { a: point(`leg${side}`), b: point(`shin${side}`), radius: 0.087 },
      { a: point(`shin${side}`), b: point(`foot${side}`), radius: 0.067 },
    );
  }
  return capsules;
}

function capeRenderGeometry(source: THREE.BufferGeometry, tier: CapeTier): THREE.BufferGeometry {
  if (tier === 'high') return source.clone();
  const p = capePatternFromMesh(source.attributes.position.array, source.attributes.uv.array,
    source.morphAttributes.position![0].array, tier === 'medium' ? 'high' : 'medium');
  const count = p.rest.length / 3, positions = new Float32Array(p.rest.length * 2), delta = new Float32Array(positions.length);
  const uv = new Float32Array(count * 4), index: number[] = [];
  for (let layer = 0; layer < 2; layer++) for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.columns; c++) {
    const n = r * p.columns + c, i = layer * count + n;
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = p.rest[n * 3 + k] + (k === 2 ? (layer ? -0.0007 : 0.0007) : 0);
      delta[i * 3 + k] = p.glide[n * 3 + k] - p.rest[n * 3 + k];
    }
    uv[i * 2] = 0.0005 + 0.999 * c / (p.columns - 1); uv[i * 2 + 1] = r / (p.rows - 1);
    if (r + 1 < p.rows && c + 1 < p.columns) {
      const quad = [i, i + 1, i + p.columns + 1, i, i + p.columns + 1, i + p.columns];
      index.push(...(layer ? quad.reverse() : quad));
    }
  }
  const boundary = [...Array.from({ length: p.columns }, (_, c) => c),
    ...Array.from({ length: p.rows - 1 }, (_, r) => (r + 1) * p.columns + p.columns - 1),
    ...Array.from({ length: p.columns - 1 }, (_, c) => (p.rows - 1) * p.columns + p.columns - 2 - c),
    ...Array.from({ length: p.rows - 2 }, (_, r) => (p.rows - 2 - r) * p.columns)];
  for (let n = 0; n < boundary.length; n++) {
    const a = boundary[n], b = boundary[(n + 1) % boundary.length];
    index.push(a, a + count, b, b, a + count, b + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.morphAttributes.position = [new THREE.BufferAttribute(delta, 3)];
  geometry.morphTargetsRelative = true;
  return geometry;
}

/** Skin only supplies target positions. The rendered cloak is driven entirely by cloth. */
export class CapeBinding {
  readonly sim: CapeSimulation;
  readonly render: THREE.Mesh;
  updateMs = 0;
  private readonly rest: Float32Array;
  private readonly glideDelta: Float32Array;
  private readonly uv: Float32Array;
  private readonly targets: Float64Array;
  private readonly offsets: Float64Array;
  readonly world: Float64Array;
  private readonly matrix = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly vertex = new THREE.Vector3();
  private readonly sampled = new Float64Array(3);

  constructor(private readonly source: THREE.SkinnedMesh, tier: CapeTier) {
    const geometry = capeRenderGeometry(source.geometry, tier);
    this.rest = new Float32Array(geometry.attributes.position.array);
    this.glideDelta = new Float32Array(geometry.morphAttributes.position![source.morphTargetDictionary!.Glide].array);
    this.uv = new Float32Array(geometry.attributes.uv.array);
    // Exported cloak is weighted entirely to chest. Fail loudly if an asset revision changes this contract.
    const bone = source.geometry.attributes.skinIndex.getX(0);
    for (let i = 0; i < source.geometry.attributes.position.count; i++) {
      if (source.geometry.attributes.skinIndex.getX(i) !== bone || source.geometry.attributes.skinWeight.getX(i) < 0.999) throw new Error('Cape skin chart must have a single chest attachment');
    }
    geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
    geometry.morphAttributes = {};
    (geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    material.side = THREE.DoubleSide;
    this.render = new THREE.Mesh(geometry, material);
    this.render.name = `${source.name}_SoftCloth`;
    this.render.position.copy(source.position); this.render.quaternion.copy(source.quaternion); this.render.scale.copy(source.scale);
    this.render.castShadow = true; this.render.frustumCulled = false;
    source.parent!.add(this.render); source.visible = false;
    this.sim = new CapeSimulation(capePatternFromMesh(source.geometry.attributes.position.array, source.geometry.attributes.uv.array,
      source.geometry.morphAttributes.position![source.morphTargetDictionary!.Glide].array, tier), tier);
    this.targets = new Float64Array(this.sim.positions.length); this.offsets = new Float64Array(this.targets.length);
    this.world = new Float64Array(this.rest.length);
  }

  update(dt: number, time: number, glide: number, wind: THREE.Vector3, velocity: THREE.Vector3,
    colliders: readonly CapeCapsule[], groundAt: (x: number, z: number) => number): void {
    if (!(dt > 0)) return;
    const begin = performance.now(), { rest, glide: flown, columns, rows } = this.sim.pattern;
    const bone = this.source.geometry.attributes.skinIndex.getX(0);
    this.matrix.copy(this.source.matrixWorld).multiply(this.source.bindMatrixInverse)
      .multiply(this.source.skeleton.bones[bone].matrixWorld).multiply(this.source.skeleton.boneInverses[bone]).multiply(this.source.bindMatrix);
    for (let i = 0; i < rest.length; i += 3) {
      this.vertex.set(rest[i] + (flown[i] - rest[i]) * glide, rest[i + 1] + (flown[i + 1] - rest[i + 1]) * glide,
        rest[i + 2] + (flown[i + 2] - rest[i + 2]) * glide).applyMatrix4(this.matrix).toArray(this.targets, i);
    }
    this.sim.update(dt, time, { targets: this.targets, colliders, wind: wind.toArray(), velocity: velocity.toArray(), glide, groundAt });
    for (let i = 0; i < this.offsets.length; i++) this.offsets[i] = this.sim.positions[i] - this.targets[i];
    for (let n = 0; n < this.uv.length / 2; n++) {
      const i = n * 3;
      sampleCape(this.offsets, columns, rows, (this.uv[n * 2] - 0.0005) / 0.999, this.uv[n * 2 + 1], this.sampled);
      this.vertex.set(this.rest[i] + this.glideDelta[i] * glide, this.rest[i + 1] + this.glideDelta[i + 1] * glide,
        this.rest[i + 2] + this.glideDelta[i + 2] * glide).applyMatrix4(this.matrix);
      for (let k = 0; k < 3; k++) this.world[i + k] = this.vertex.getComponent(k) + this.sampled[k];
      this.world[i + 1] = Math.max(this.world[i + 1], groundAt(this.world[i], this.world[i + 2]) + 0.015);
    }
    resolveCapeCollisions(this.world, colliders);
    this.sim.stats.maxPenetration = Math.max(this.sim.stats.maxPenetration, capePenetration(this.world, colliders));
    this.inverse.copy(this.render.matrixWorld).invert();
    const output = this.render.geometry.attributes.position;
    for (let i = 0; i < this.world.length; i += 3) {
      this.vertex.fromArray(this.world, i).applyMatrix4(this.inverse);
      output.setXYZ(i / 3, this.vertex.x, this.vertex.y, this.vertex.z);
    }
    output.needsUpdate = true;
    this.render.geometry.computeVertexNormals();
    // CPU cloth invalidates the imported bind-pose bounds, including raycasts/debug inspection.
    this.render.geometry.computeBoundingBox();
    this.render.geometry.computeBoundingSphere();
    this.updateMs = performance.now() - begin;
  }
}
