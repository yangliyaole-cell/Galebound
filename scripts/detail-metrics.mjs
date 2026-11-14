import * as THREE from 'three';
import { createHash } from 'node:crypto';

export function collisionDigest(colliders) {
  return createHash('sha256').update(JSON.stringify(colliders.map(c => [
    c.x, c.z, c.hx, c.hz, c.cos, c.sin, c.round, String(c.bottom),
    ...[[0, 0], [-c.hx / 2, 0], [c.hx / 2, c.hz / 2]].map(([x, z]) => c.top(x, z)),
  ]))).digest('hex');
}

/** Ground-relative views around the layout's own anchors, so they follow the map. */
export function reviewViews(L, H) {
  const ground = (x, z, up) => [x, H.heightAt(x, z) + up, z];
  const gate = L.SOUTH_GATE, cityY = H.heightAt(L.CITY.x, L.CITY.z), S = L.START, C = L.CITY, F = L.FOREST;
  return [
    { name: 'spawn', eye: ground(S.x, S.z, 2.5), target: [C.x, cityY - 20, C.z] },
    { name: 'tree-near', eye: ground(S.x - 2, S.z + 4, 3.5), target: [S.x - 9, H.heightAt(S.x - 9, S.z - 3) + 12, S.z - 3] },
    { name: 'forest', eye: ground(F.x + 50, F.z + 20, 7), target: ground(F.x - 40, F.z - 25, 10) },
    { name: 'city-wall', eye: ground(gate.x + 12, gate.z + 24, 2.4), target: [gate.x, H.heightAt(gate.x, gate.z) + 5, gate.z] },
    { name: 'palace', eye: [C.x + 12, cityY + 12, C.z + 54], target: [C.x, cityY + 34, C.z] },
    { name: 'aerial', eye: [C.x, cityY + 330, C.z + 430], target: [C.x, cityY, C.z] },
  ];
}

export function screenshotViews(L, H) {
  const S = L.START, at = (dx, dz) => [S.x + dx, S.z + dz];
  const [tx, tz] = at(-9, -3), [ex, ez] = at(4.8, 4.4), [rx, rz] = at(6.5, 2), [qx, qz] = at(4.8, -3.2);
  const [wx, wz] = at(-42.43, -46.31), [vx, vz] = at(-47.4, -43.3333333333);
  return [
    ...reviewViews(L, H).map(view => view.name === 'tree-near' ? {
      name: 'tree-near', eye: [ex, H.heightAt(tx, tz) - 0.65 + 8.5, ez],
      target: [tx, H.heightAt(tx, tz) - 0.65 + 9.1, tz], fov: 76,
    } : view),
    { name: 'rubble-close', eye: [rx, H.heightAt(rx, rz) + 1.8, rz], target: [qx, H.heightAt(qx, qz) + 0.95, qz] },
    { name: 'dry-wall-close', eye: [wx, Math.max(H.heightAt(wx, wz) + 1.9, H.heightAt(vx, vz) + 2.5), wz], target: [vx, H.heightAt(vx, vz) + 1.25, vz] },
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
