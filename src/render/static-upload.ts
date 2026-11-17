import * as THREE from 'three';

/** Arm only finalized Builder meshes, after all merging, PBR classification and style setup.
 * Controllers/cameras collide against colliders.ts, never these render triangles. Detail
 * culling reads the precomputed sphere. Runtime styles change materials, not attributes.
 * Callers exclude shot mode, whose external review tools may inspect/raycast geometry.
 * Context loss is fatal and reloads the world; these arrays are not used for restoration.
 */
export function releaseStructureArraysAfterUpload(scene: THREE.Object3D): void {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh) return;
    if (!object.name.startsWith('structure-') && object.name !== 'Settlement merged relief') return;
    const geometry = object.geometry;
    if (Object.keys(geometry.morphAttributes).length) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    for (const attribute of [...Object.values(geometry.attributes), geometry.index]) {
      if (!(attribute instanceof THREE.BufferAttribute) || attribute.usage !== THREE.StaticDrawUsage) continue;
      const previous = attribute.onUploadCallback;
      attribute.onUpload(function (this: THREE.BufferAttribute) {
        previous.call(this);
        // Three caches GL type/size/count at upload and reuses the unchanged attribute version.
        this.array = null!;
      });
    }
  });
}
