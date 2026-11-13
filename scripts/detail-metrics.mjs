import * as THREE from 'three';
import { createHash } from 'node:crypto';

export function collisionDigest(colliders) {
  return createHash('sha256').update(JSON.stringify(colliders.map(c => [
    c.x, c.z, c.hx, c.hz, c.cos, c.sin, c.round, String(c.bottom),
    ...[[0, 0], [-c.hx / 2, 0], [c.hx / 2, c.hz / 2]].map(([x, z]) => c.top(x, z)),
  ]))).digest('hex');
}

/** Ground-relative views remain identical before/after for each terrain quality. */
export function reviewViews(L, H) {
  const ground = (x, z, up) => [x, H.heightAt(x, z) + up, z];
  const gate = L.SOUTH_GATE, cityY = H.heightAt(L.CITY.x, L.CITY.z);
  return [
    { name: 'spawn', eye: ground(0, 100, 2.5), target: [120, 130, -640] },
    { name: 'tree-near', eye: ground(-2, 104, 3.5), target: [-9, H.heightAt(-9, 97) + 12, 97] },
    { name: 'forest', eye: ground(-380, 240, 7), target: ground(-470, 195, 10) },
    { name: 'city-wall', eye: ground(gate.x + 12, gate.z + 24, 2.4), target: [gate.x, H.heightAt(gate.x, gate.z) + 5, gate.z] },
    { name: 'palace', eye: [132, cityY + 12, -586], target: [120, cityY + 34, -640] },
    { name: 'aerial', eye: [120, 430, -210], target: [120, 115, -640] },
  ];
}

export function screenshotViews(L, H) {
  return [
    ...reviewViews(L, H).map(view => view.name === 'tree-near' ? {
      name: 'tree-near', eye: [4.8, H.heightAt(-9,97) - 0.65 + 8.5, 104.4],
      target: [-9, H.heightAt(-9,97) - 0.65 + 9.1, 97], fov: 76,
    } : view),
    { name: 'rubble-close', eye: [6.5, H.heightAt(6.5,102)+1.8, 102], target: [4.8, H.heightAt(4.8,96.8)+0.95, 96.8] },
    { name: 'dry-wall-close', eye: [-42.43, Math.max(H.heightAt(-42.43,53.69)+1.9,H.heightAt(-47.4,56.6666666667)+2.5), 53.69], target: [-47.4, H.heightAt(-47.4,56.6666666667)+1.25, 56.6666666667] },
  ];
}

export function inventory(root) {
  const result = { meshes: 0, detailBatches: 0, uniqueGeometryBytes: 0, instanceCapacity: 0 };
  const arrays = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    result.meshes++;
    if (o.userData.structureDetail) result.detailBatches++;
    if (o.isInstancedMesh) result.instanceCapacity += o.instanceMatrix.count;
    for (const a of [...Object.values(o.geometry.attributes), o.geometry.index, o.instanceMatrix, o.instanceColor]) {
      if (a && !arrays.has(a.array)) { arrays.add(a.array); result.uniqueGeometryBytes += a.array.byteLength; }
    }
  });
  return result;
}

/** Color-pass estimates: actual batch bounds and visibility, no GPU/occlusion surrogate. */
export function measure(roots, scatter, views, viewRange, updateDetails = () => {}) {
  return views.map(v => {
    const camera = new THREE.PerspectiveCamera(v.fov ?? 55, 16 / 9, 0.1, viewRange);
    camera.position.fromArray(v.eye); camera.lookAt(...v.target); camera.updateMatrixWorld();
    scatter.update(camera.position); updateDetails(camera.position);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const total = { ...v, calls: 0, triangles: 0, instances: 0, treeTiers: [0, 0, 0], scatterTiers: [0, 0, 0], detailCalls: 0, detailTriangles: 0 };
    for (const root of [...roots, scatter.object]) {
      root.updateMatrixWorld(true);
      root.traverseVisible(o => {
        if (!o.isMesh || (o.isInstancedMesh && !o.count)) return;
        if (o.frustumCulled && !frustum.intersectsObject(o)) return;
        const n = o.isInstancedMesh ? o.count : 1;
        const triangles = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * n;
        total.calls++; total.triangles += triangles;
        if (o.isInstancedMesh) total.instances += n;
        if (o.userData.structureDetail) { total.detailCalls++; total.detailTriangles += triangles; }
        if (o.userData.treeTier !== undefined && !o.userData.leafCards) {
          total.scatterTiers[o.userData.treeTier] += n;
          if (o.userData.tree) total.treeTiers[o.userData.treeTier] += n;
        }
      });
    }
    total.scatter = scatter.stats?.();
    return total;
  });
}
