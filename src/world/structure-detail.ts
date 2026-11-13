import * as THREE from 'three';

// Set once before generation. Visual detail never registers colliders or uses layout RNGs.
let level = 1;
export function setStructureDetail(value: number): void { level = value; }
export function structureDetail(): number { return level; }
export const STRUCTURE_DETAIL_RANGE = 150;
const meshes: THREE.Mesh[] = [];
export function registerStructureDetail(mesh: THREE.Mesh): void {
  mesh.userData.structureDetail = true;
  mesh.geometry.computeBoundingSphere();
  meshes.push(mesh);
}
export function updateStructureDetails(camera: THREE.Vector3): void {
  for (const mesh of meshes) {
    const sphere = mesh.geometry.boundingSphere!;
    mesh.visible = camera.distanceTo(sphere.center) < sphere.radius + STRUCTURE_DETAIL_RANGE;
  }
}
export const detailCounters = { rubble: 0, dryCourses: 0, wallBlocks: 0, archStones: 0, towerBands: 0, houseFacades: 0, roofCourses: 0 };
