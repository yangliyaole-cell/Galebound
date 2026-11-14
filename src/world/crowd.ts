import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from '../render/uniforms';
import { CITY_SQUARES, CITY_STREETS, type Road } from './layout';
import { squareLevel, streetProfiles } from './city-plan';
import { seededRandom } from './noise';

/**
 * Hightown's townsfolk: hundreds of small figures in one or two instanced draws.
 *
 * Every walker paces a stretch of street to and fro on its paved profile; where
 * they are is a pure function of time, so a frozen screenshot always shows the
 * same street scene. Legs and arms swing in the vertex shader. Others stand in
 * twos and threes on the squares, talking.
 */

const SKINS = [0xf2cfb2, 0xe8bf9c, 0xd9a882, 0xf6dcc4, 0xc89270];
const HAIRS = [0x3a2a22, 0x6b4a2e, 0x8a6a3c, 0xb9a077, 0x9c9c9c, 0x241c1a];
const CLOTHES = [0xc7d3bb, 0xd8ad88, 0x8ea6c6, 0xc7866a, 0xe7dbbf, 0x98ae78, 0xb58da6, 0xd9c27a, 0x6f88a8, 0xa85a4a, 0x7a9a6a, 0xe0d0b0];

// Parts: 0 body, 1/2 legs, 3/4 arms. aPaint: 0 skin, 1 clothes, 2 hair, 3 legs/boots.
function figure(skirt: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, part: number, paint: number): void => {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    const n = geo.attributes.position.count;
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(new Array(n).fill(paint), 1));
    parts.push(geo);
  };
  for (const side of [-1, 1]) {
    // Legs hang from the hip at 0.86 m.
    add(new THREE.BoxGeometry(0.13, 0.82, 0.15).translate(side * 0.085, 0.45, 0), side < 0 ? 1 : 2, 3);
    add(new THREE.BoxGeometry(0.14, 0.08, 0.24).translate(side * 0.085, 0.04, 0.04), side < 0 ? 1 : 2, 3);
    // Arms hang from the shoulder at 1.42 m.
    add(new THREE.BoxGeometry(0.1, 0.6, 0.11).translate(side * 0.25, 1.13, 0), side < 0 ? 3 : 4, 1);
    add(new THREE.BoxGeometry(0.085, 0.09, 0.09).translate(side * 0.25, 0.8, 0), side < 0 ? 3 : 4, 0);
  }
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8).scale(1, 1, 0.68).translate(0, 1.16, 0), 0, 1);
  if (skirt) add(new THREE.CylinderGeometry(0.2, 0.34, 0.66, 10).scale(1, 1, 0.85).translate(0, 0.6, 0), 0, 1);
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6).translate(0, 1.5, 0), 0, 0);
  add(new THREE.SphereGeometry(0.115, 10, 8).scale(0.95, 1.08, 1).translate(0, 1.62, 0.01), 0, 0);
  add(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.05, 1.05).translate(0, 1.64, -0.012), 0, 2);
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

interface Walker { road: Road; len: number; start: number; speed: number; lane: number; cum: number[] }

export function createCrowd(count: number): { object: THREE.Group; update: (time: number, player: THREE.Vector3) => void } {
  const group = new THREE.Group();
  group.name = 'Townsfolk';
  const rand = seededRandom(7711);
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];

  // Streets weighted by how busy they are.
  const busy = (r: Road): number => r.id === 'avenue' ? 6 : r.id === 'high-street' || r.id === 'east-street' ? 3 : r.stairs ? 0.6 : r.id.startsWith('wall') ? 0.4 : 1.6;
  const streets = CITY_STREETS.map((road) => {
    const cum = [0];
    for (let i = 1; i < road.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(road.pts[i][0] - road.pts[i - 1][0], road.pts[i][1] - road.pts[i - 1][1]));
    return { road, cum, len: cum[cum.length - 1], weight: busy(road) * cum[cum.length - 1] };
  });
  const totalWeight = streets.reduce((a, s) => a + s.weight, 0);
  const walkers: Walker[] = [];
  const standers: { x: number; y: number; z: number; yaw: number }[] = [];
  const nStand = Math.round(count * 0.28);
  for (let i = 0; i < count - nStand; i++) {
    let r = rand() * totalWeight, s = streets[0];
    for (const c of streets) { r -= c.weight; if (r <= 0) { s = c; break; } }
    walkers.push({ road: s.road, len: s.len, cum: s.cum, start: rand() * s.len * 2, speed: (0.9 + rand() * 0.6) * (rand() < 0.5 ? 1 : -1), lane: (rand() * 2 - 1) * 0.7 });
  }
  // Knots of people on the squares, turned towards one another.
  for (let i = 0; i < nStand;) {
    const q = CITY_SQUARES[Math.floor(rand() * CITY_SQUARES.length)];
    const c = Math.cos(q.rot), s = Math.sin(q.rot);
    const u = (rand() * 2 - 1) * q.rx * 0.75, v = (rand() * 2 - 1) * q.rz * 0.75;
    if (Math.hypot(u, v) < 6) continue;
    const x = q.x + u * c + v * s, z = q.z - u * s + v * c, y = squareLevel.get(q)! + 0.04;
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n && i < nStand; k++, i++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.5;
      standers.push({ x: x + Math.cos(a) * 0.55, y, z: z + Math.sin(a) * 0.55, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });
    }
  }

  const material = new THREE.MeshToonMaterial({ color: 0xffffff });
  material.customProgramCacheKey = () => 'townsfolk-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart; attribute float aPaint;
        attribute vec3 aCloth; attribute vec3 aSkin; attribute vec3 aHair; attribute vec4 aGait;
        uniform float uTime; varying vec3 vPaint;
        mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position;
        float cycle = uTime * aGait.y + aGait.x;
        float swing = sin(cycle) * 0.5 * aGait.z;
        float leg = aPart > 0.5 && aPart < 2.5 ? (aPart < 1.5 ? swing : -swing) : 0.0;
        float arm = aPart > 2.5 ? (aPart < 3.5 ? -swing : swing) * 0.8 : 0.0;
        if (leg != 0.0) transformed = rotX(leg) * (transformed - vec3(0.0, 0.86, 0.0)) + vec3(0.0, 0.86, 0.0);
        if (arm != 0.0) transformed = rotX(arm) * (transformed - vec3(0.0, 1.42, 0.0)) + vec3(0.0, 1.42, 0.0);
        // Idle figures shift their weight and gesture a little; walkers bob.
        float idle = 1.0 - aGait.z;
        if (aPart > 2.5 && aPart < 3.5) transformed = rotX(-idle * (0.25 + 0.25 * sin(uTime * 1.3 + aGait.x * 3.0))) * (transformed - vec3(0.0, 1.42, 0.0)) + vec3(0.0, 1.42, 0.0);
        transformed.x += idle * sin(uTime * 0.7 + aGait.x) * 0.02 * transformed.y;
        transformed.y += aGait.z * abs(cos(cycle)) * 0.035;
        vPaint = aPaint < 0.5 ? aSkin : aPaint < 1.5 ? aCloth : aPaint < 2.5 ? aHair : aCloth * 0.45;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPaint;');
  };

  const total = walkers.length + standers.length;
  const meshes = [false, true].map((skirt) => {
    const mesh = new THREE.InstancedMesh(figure(skirt), material, total);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });
  // Each figure belongs to one of the two meshes; per-instance colours and gait live in attributes.
  const kind: number[] = [], slot: number[] = [];
  const counts = [0, 0];
  const attrs = meshes.map(() => ({ cloth: new Float32Array(total * 3), skin: new Float32Array(total * 3), hair: new Float32Array(total * 3), gait: new Float32Array(total * 4) }));
  const color = new THREE.Color();
  for (let i = 0; i < total; i++) {
    const k = rand() < 0.45 ? 1 : 0, j = counts[k]++;
    kind.push(k); slot.push(j);
    const a = attrs[k];
    color.set(pick(CLOTHES)).multiplyScalar(0.85 + rand() * 0.2).toArray(a.cloth, j * 3);
    color.set(pick(SKINS)).toArray(a.skin, j * 3);
    color.set(pick(HAIRS)).toArray(a.hair, j * 3);
    const walking = i < walkers.length;
    a.gait.set([rand() * 6.28, walking ? 6.2 + rand() * 1.4 : 1, walking ? 1 : 0, 0], j * 4);
  }
  meshes.forEach((mesh, k) => {
    const a = attrs[k];
    mesh.geometry.setAttribute('aCloth', new THREE.InstancedBufferAttribute(a.cloth, 3));
    mesh.geometry.setAttribute('aSkin', new THREE.InstancedBufferAttribute(a.skin, 3));
    mesh.geometry.setAttribute('aHair', new THREE.InstancedBufferAttribute(a.hair, 3));
    mesh.geometry.setAttribute('aGait', new THREE.InstancedBufferAttribute(a.gait, 4));
    mesh.count = counts[k];
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const place = (i: number, x: number, y: number, z: number, yaw: number): void => {
    q.setFromAxisAngle(up, yaw);
    meshes[kind[i]].setMatrixAt(slot[i], m.compose(p.set(x, y, z), q, one));
  };
  standers.forEach((s, j) => place(walkers.length + j, s.x, s.y, s.z, s.yaw));

  /** Position on a walker's street at time t: there and back, keeping to its side of the way. */
  const step = (w: Walker, i: number, time: number): void => {
    let s = (w.start + Math.abs(w.speed) * time) % (w.len * 2);
    const back = s > w.len;
    if (back) s = w.len * 2 - s;
    if (w.speed < 0) s = w.len - s;
    let k = 0, lo = 0, hi = w.cum.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (w.cum[mid] <= s) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    k = Math.min(k, w.road.pts.length - 2);
    const a = w.road.pts[k], b = w.road.pts[k + 1], seg = Math.max(1e-3, w.cum[k + 1] - w.cum[k]), t = (s - w.cum[k]) / seg;
    const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
    const forward = (w.speed > 0) !== back ? 1 : -1;
    // Keep right: the lateral offset flips with the direction of travel.
    const off = (w.road.widths[k] / 2 - 0.45) * w.lane * forward;
    const prof = streetProfiles.get(w.road)!;
    const y = prof[k] + (prof[k + 1] - prof[k]) * t + 0.04;
    place(i, a[0] + dx * s - dx * w.cum[k] - dz * off, y, a[1] + dz * (s - w.cum[k]) + dx * off, Math.atan2(dx * forward, dz * forward));
  };

  return {
    object: group,
    update: (time) => {
      walkers.forEach((w, i) => step(w, i, time));
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
