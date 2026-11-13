import * as THREE from 'three';
import { createHash } from 'node:crypto';
export function collisionDigest(colliders) {
  return createHash('sha256').update(JSON.stringify(colliders.map(c => [c.x,c.z,c.hx,c.hz,c.cos,c.sin,c.round,String(c.bottom), ...[[0,0],[-c.hx/2,0],[c.hx/2,c.hz/2]].map(([x,z])=>c.top(x,z))]))).digest('hex');
}
export const views = [
  { name:'spawn', eye:[0,40,100], target:[0,85,-400] },
  { name:'city', eye:[25,120,-245], target:[0,145,-430] },
  { name:'aerial', eye:[0,430,-160], target:[0,100,-430] },
];
export function measure(roots, scatter, updateDetails = () => {}) {
  return views.map(v => {
    const camera = new THREE.PerspectiveCamera(60,16/9,0.1,1800);
    camera.position.fromArray(v.eye); camera.lookAt(...v.target); camera.updateMatrixWorld();
    scatter.update(camera.position); updateDetails(camera.position);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const total={name:v.name, calls:0, triangles:0, instances:0, treeTiers:[0,0,0]};
    for(const root of [...roots,scatter.object]) {
      root.updateMatrixWorld(true);
      root.traverseVisible(o=> {
        if(!o.isMesh || (o.isInstancedMesh && !o.count)) return;
        if(o.frustumCulled && !frustum.intersectsObject(o)) return;
        const n=o.isInstancedMesh?o.count:1;
        total.calls++; total.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*n;
        if(o.isInstancedMesh) total.instances+=n;
      });
    }
    if(scatter.stats) total.treeTiers=scatter.stats().tiers;
    return total;
  });
}
