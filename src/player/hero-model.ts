import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Rig } from './rig';

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
export async function loadHeroRig(): Promise<Rig> {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/traveler.glb`);
  const root = new THREE.Group();
  root.name = 'Hero';
  root.add(gltf.scene);
  root.updateMatrixWorld(true);
  const bones = JOINTS.map(([name]) => {
    const bone = gltf.scene.getObjectByName(name);
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
  const capeMeshes: THREE.Mesh[] = [];
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
  return {
    root, ...joints, hipHeight, eyes: null,
    setMaskVisible(visible) {
      for (const mesh of maskMeshes) mesh.visible = visible;
    },
    setCapeState: capeMeshes.length ? (glide, trail, time, wind) => {
      capeMeshes.forEach((mesh, i) => {
        const keys = mesh.morphTargetDictionary!;
        const values = mesh.morphTargetInfluences!;
        values[keys.Glide] = glide;
        values[keys.Trail] = Math.min(1, trail) * (1 - glide * 0.8);
        values[keys.Flutter] = Math.sin(time * 2.8 + i * 1.7) * Math.min(0.6, 0.12 + wind * 0.04);
      });
    } : undefined,
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
