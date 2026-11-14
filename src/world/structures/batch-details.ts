import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerStructureDetail } from '../structure-detail';

/** Compact one settlement's relief by material. Retains all vertices and the original
 * per-fragment distance fade; each settlement still has independent bounds/culling. */
export function batchSettlementDetails<T extends THREE.Group>(root: T): T {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.structureDetail || Array.isArray(o.material)) return;
    const list = batches.get(o.material) ?? []; list.push(o); batches.set(o.material, list);
  });
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    // Builder output already sits in the settlement's frame: skip the copy when nothing moves.
    const identity = new THREE.Matrix4();
    const parts = meshes.map((m) => {
      const relative = new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld);
      return relative.equals(identity) ? m.geometry : m.geometry.clone().applyMatrix4(relative);
    });
    const combined = new THREE.Mesh(mergeGeometries(parts), material);
    combined.name = 'Settlement merged relief'; combined.receiveShadow = true;
    registerStructureDetail(combined); root.add(combined);
    for (const part of parts) if (!meshes.some((m) => m.geometry === part)) part.dispose();
    for (const mesh of meshes) {
      mesh.removeFromParent();
      // The shared detail registry retains a culling record. Keep only its bounds,
      // releasing the old CPU arrays as well as the GPU allocation after rebatching.
      mesh.geometry.computeBoundingSphere(); const sphere = mesh.geometry.boundingSphere!.clone();
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry(); mesh.geometry.boundingSphere = sphere;
    }
  }
  return root;
}
