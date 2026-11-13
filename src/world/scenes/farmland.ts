import * as THREE from 'three';
import { Builder, place } from '../build';
import { addBox } from '../colliders';
import { heightAt, normalAt } from '../heightmap';
import { FIELDS, fieldPolygon, inPolygon, RIVER, distToPolyline, roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { addHouse, builtHouses } from '../structures/house';
import { shared } from '../../render/uniforms';
import { FIELD_HAMLETS } from './plan';
import { sceneSolids } from './geometry';

export type AtmosphereSeed = [number, number, number, number];

/** Shared field polygons drive crops, painted parcels and broken hedgerow boundaries. */
export function addFarmland(b: Builder, group: THREE.Group, detail: number, smoke: AtmosphereSeed[]): number {
  const rand = seededRandom(6401), normal = new THREE.Vector3(); let homes = 0;
  if (detail > 0) for (const f of FIELDS) {
    const poly = fieldPolygon(f);
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], c = poly[(k + 1) % poly.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let d = 2; d < len - 2; d += detail === 2 ? 1.45 : 2.8) {
        // Frequent farm entrances and open sightlines keep the hedges from reading as walls.
        if (k === 0 && d > len * 0.35 && d < len * 0.65) continue;
        const x = a[0] + (c[0] - a[0]) * d / len, z = a[1] + (c[1] - a[1]) * d / len;
        if (roadClearance(x, z) < 4 || builtHouses.some((h) => Math.hypot(h.spec.x - x, h.spec.z - z) < 8)) continue;
        const y = heightAt(x, z);
        const geo = new THREE.IcosahedronGeometry(1, detail === 2 ? 2 : 1).scale(1.8, 0.6 + rand() * 0.3, 1.4);
        b.add('plain', geo, rand() < 0.5 ? 0x647d44 : 0x7f914e, place(x, y + 0.42, z), 0.23);
      }
    }
  }
  for (const village of FIELD_HAMLETS) {
    let n = 0;
    for (let attempt = 0; n < village.n && attempt < 400; attempt++) {
      const a = rand() * Math.PI * 2, r = 9 + rand() * 31;
      const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
      if (heightAt(x, z) < 3 || normalAt(x, z, normal).y < 0.91 || roadClearance(x, z) < 9 || distToPolyline(x, z, RIVER) < 30) continue;
      if (FIELDS.some((f) => inPolygon(x, z, fieldPolygon(f))) || builtHouses.some((h) => Math.hypot(h.spec.x - x, h.spec.z - z) < 17)) continue;
      const h = addHouse(b, { x, z, rot: a + Math.PI, w: 7 + rand() * 2, d: 6 + rand() * 2, floors: rand() < 0.25 ? 2 : 1,
        roof: rand() < 0.5 ? 0xc46d49 : 0xad583e, wall: 0xd8d1bb, timber: false, ridgeAlongFront: rand() < 0.5,
        shutters: 0x567468, chimney: true, simple: detail === 0 ? 2 : 1 }, rand);
      // Same chimney offsets as the house generator, so smoke leaves the actual pot.
      const u = h.spec.ridgeAlongFront ? h.spec.w * 0.27 : -h.spec.w * 0.2;
      const v = h.spec.ridgeAlongFront ? -h.spec.d * 0.18 : h.spec.d * 0.2;
      const cs = Math.cos(h.spec.rot), sn = Math.sin(h.spec.rot);
      smoke.push([x + u * cs + v * sn, h.topY + 1.4, z - u * sn + v * cs, 0.9]);
      sceneSolids.push({ kind: 'farmhouse', x, z, radius: Math.hypot(h.spec.w, h.spec.d) / 2 + 0.8 }); n++; homes++;
    }
    // One additional mill in the eastern patchwork; the existing Windmill Rise stays intact.
    if (village.x > 0) addFieldMill(b, group, village.x + 45, village.z + 38, detail);
  }
  return homes;
}

function addFieldMill(b: Builder, group: THREE.Group, x: number, z: number, detail: number): void {
  const y = heightAt(x, z), h = 16;
  b.cyl('plaster', x, y - 1, z, 2.6, 4.2, h + 1, 0xd8d2b9, detail === 2 ? 32 : 18);
  b.cone('roof', x, y + h, z, 3.3, 5, 0x9f6548, detail === 2 ? 32 : 18);
  addBox(x, z, 3.7, 3.7, 0, y + h); sceneSolids.push({ kind: 'field-mill', x, z, radius: 5 });
  const blades = new Builder();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    blades.slab('wood', 0.14, 8.8, 0.16, new THREE.Matrix4().makeRotationZ(a).setPosition(-Math.sin(a) * 4.1, Math.cos(a) * 4.1, 0), 0x74644b);
    blades.slab('cloth', 1.6, 5.4, 0.045, new THREE.Matrix4().makeRotationZ(a).setPosition(-Math.sin(a) * 5.6 + Math.cos(a) * 0.7, Math.cos(a) * 5.6 + Math.sin(a) * 0.7, 0.04), 0xd8ceac);
    if (detail > 0) for (let k = 0; k < 8; k++) {
      const d = 3 + k * 0.68;
      blades.slab('wood', 1.7, 0.065, 0.07, new THREE.Matrix4().makeRotationZ(a).setPosition(-Math.sin(a) * d + Math.cos(a) * 0.7, Math.cos(a) * d + Math.sin(a) * 0.7, 0.09), 0x8d7e5d);
    }
  }
  const rotor = blades.build(false); rotor.position.set(x, y + 13, z + 3);
  // Shared clock freezes consistently in shot mode; no new frame-loop integration required.
  for (const child of rotor.children) {
    const mesh = child as THREE.Mesh, original = mesh.material as THREE.Material;
    const compile = original.onBeforeCompile, baseKey = original.customProgramCacheKey();
    mesh.material = original.clone();
    mesh.material.onBeforeCompile = (shader, renderer) => {
      compile.call(original, shader, renderer);
      shader.uniforms.uSceneTime = shared.uTime;
      shader.vertexShader = 'uniform float uSceneTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>\nfloat a=uSceneTime*.12; mat2 r=mat2(cos(a),sin(a),-sin(a),cos(a)); transformed.xy=r*transformed.xy;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nfloat na=uSceneTime*.12; objectNormal.xy=mat2(cos(na),sin(na),-sin(na),cos(na))*objectNormal.xy;`);
    };
    mesh.material.customProgramCacheKey = () => baseKey + '-scene-field-mill-rotation-v2';
    mesh.frustumCulled = false;
  }
  group.add(rotor);
}
