import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../render/toon';
import { fbm, seededRandom } from './noise';
import { GROUND_GLSL, NOISE_GLSL, groundUniforms, heightAt, pathX } from './terrain';

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 0.6 },
};

/** Darkens the lower part of a foliage shape so crowns read as having depth. */
function shadeByHeight(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y);
    const patch = fbm(pos.getX(i) * 1.3 + 3, pos.getZ(i) * 1.3 + pos.getY(i), 2);
    const v = 0.5 + 0.5 * THREE.MathUtils.smoothstep(t + (patch - 0.5) * 0.5, 0.05, 0.75);
    colors.set([v * 0.92, v, v * 0.85], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

function nearPath(x: number, z: number, margin: number): boolean {
  return Math.abs(x - pathX(z)) < margin;
}

// ---------------------------------------------------------------- grass

function bladeGeometry(): THREE.BufferGeometry {
  const w = 0.15;
  const rows: [number, number][] = [[0, 0.5], [0.45, 0.38], [0.8, 0.2]];
  const positions: number[] = [];
  for (const [y, half] of rows) positions.push(-half * w, y, 0, half * w, y, 0);
  positions.push(0, 1, 0);
  const normals: number[] = [];
  for (let i = 0; i < 7; i++) normals.push(0, 1, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  return geo;
}

export function createGrass(count: number, radius: number): THREE.InstancedMesh {
  // Lit like the ground (normals point up, shadows received) so tufts blend into it.
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        varying float vTip;
        varying vec2 vOrigin;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 bladePos = instanceMatrix * vec4(transformed, 1.0);
        vec2 origin = instanceMatrix[3].xz;
        float tip = position.y;
        float bladeHeight = length(instanceMatrix[1].xyz);
        float gust = gNoise(origin * 0.06 - uWindDir * uTime * 0.7);
        float ripple = sin(dot(origin, uWindDir) * 0.9 - uTime * 2.4 + gHash(origin) * 6.28) * 0.5 + 0.5;
        float bend = (0.06 + uWindStrength * (0.55 * gust + 0.2 * ripple)) * tip * tip * bladeHeight;
        bladePos.xz += uWindDir * bend;
        bladePos.y -= bend * bend * 0.5;
        vTip = tip;
        vOrigin = origin;
        vec4 mvPosition = modelViewMatrix * bladePos;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vTip;
        varying vec2 vOrigin;
        ${GROUND_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `float pathMask;
        vec3 base = groundColor(vOrigin, pathMask);
        diffuseColor.rgb = base * mix(0.78, 1.32, vTip) + vec3(0.02, 0.035, 0.0) * vTip;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`,
      );
  };

  const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, count);
  const rand = seededRandom(1);
  let placed = 0;
  while (placed < count) {
    const r = radius * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearPath(x, z, 2.3)) continue;
    const edgeFade = 1 - 0.7 * THREE.MathUtils.smoothstep(r, radius * 0.7, radius);
    dummy.position.set(x, heightAt(x, z) - 0.04, z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.set(0.8 + rand() * 0.7, (0.35 + rand() * 0.45) * edgeFade, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// -------------------------------------------------------------- flowers

export function createFlowers(patches: number, radius: number): THREE.Group {
  const perPatch = 22;
  const total = patches * perPatch;
  const petalGeo = new THREE.CircleGeometry(0.1, 8).rotateX(-Math.PI / 2);
  const centreGeo = new THREE.CircleGeometry(0.04, 8).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
  const petals = new THREE.InstancedMesh(
    petalGeo,
    new THREE.MeshBasicMaterial({ color: 0xfbfaf2, side: THREE.DoubleSide }),
    total,
  );
  const centres = new THREE.InstancedMesh(
    centreGeo,
    new THREE.MeshBasicMaterial({ color: 0xf2bd2e, side: THREE.DoubleSide }),
    total,
  );
  const rand = seededRandom(2);
  let i = 0;
  while (i < total) {
    const pr = radius * Math.sqrt(rand());
    const pa = rand() * Math.PI * 2;
    const cx = Math.cos(pa) * pr;
    const cz = Math.sin(pa) * pr;
    for (let k = 0; k < perPatch; k++) {
      const x = cx + (rand() - 0.5) * 7;
      const z = cz + (rand() - 0.5) * 7;
      const hidden = nearPath(x, z, 2.4);
      dummy.position.set(x, hidden ? -500 : heightAt(x, z) + 0.42 + rand() * 0.2, z);
      dummy.rotation.set((rand() - 0.5) * 0.9, rand() * 6.28, (rand() - 0.5) * 0.9);
      dummy.scale.setScalar(0.8 + rand() * 0.6);
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
      centres.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  petals.frustumCulled = false;
  centres.frustumCulled = false;
  const group = new THREE.Group();
  group.add(petals, centres);
  return group;
}

// ---------------------------------------------------------------- trees

function blob(parts: [number, number, number, number][]): THREE.BufferGeometry {
  return mergeGeometries(
    parts.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 2).translate(x, y, z)),
  );
}

interface TreeSpot {
  x: number;
  z: number;
  scale: number;
  cypress: boolean;
}

function treeSpots(count: number): TreeSpot[] {
  const rand = seededRandom(3);
  // The big tree beside the starting point, as in the concept art.
  const spots: TreeSpot[] = [{ x: -9, z: 5, scale: 2.3, cypress: false }];
  let guard = 0;
  while (spots.length < count && guard++ < 20000) {
    const x = (rand() - 0.5) * 760;
    const z = (rand() - 0.5) * 760;
    if (Math.hypot(x, z) < 22 || nearPath(x, z, 5)) continue;
    if (fbm(x / 85 + 40, z / 85 - 13, 3) < 0.53) continue;
    spots.push({ x, z, scale: 0.8 + rand() * 0.9, cypress: rand() < 0.28 });
  }
  return spots;
}

export function createTrees(count: number): THREE.Group {
  const spots = treeSpots(count);
  const round = spots.filter((s) => !s.cypress);
  const tall = spots.filter((s) => s.cypress);
  const group = new THREE.Group();
  const rand = seededRandom(4);

  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 3, 7).translate(0, 1.5, 0);
  const crownGeo = shadeByHeight(blob([
    [0, 3.4, 0, 1.9],
    [1.4, 2.9, 0.3, 1.3],
    [-1.3, 3.0, -0.4, 1.4],
    [0.2, 4.6, 0.3, 1.3],
    [-0.3, 2.7, 1.3, 1.2],
    [0.4, 2.8, -1.4, 1.2],
  ]));
  const cypressGeo = shadeByHeight(
    new THREE.IcosahedronGeometry(1, 2).scale(0.6, 2.6, 0.6).translate(0, 2.9, 0),
  );

  const build = (
    list: TreeSpot[],
    geo: THREE.BufferGeometry,
    base: number,
    vary: number,
  ): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), list.length);
    list.forEach((s, i) => {
      dummy.position.set(s.x, heightAt(s.x, s.z) - 0.3, s.z);
      dummy.rotation.set(0, rand() * 6.28, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.set(base).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * vary);
      mesh.setColorAt(i, tint);
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  };

  const trunks = build(spots, trunkGeo, 0x7d5d40, 0.05);
  // Same placement order as build() used, so trunks and crowns line up.
  const crowns = new THREE.InstancedMesh(crownGeo, toon(0xffffff, { vertexColors: true }), round.length);
  const cones = new THREE.InstancedMesh(cypressGeo, toon(0xffffff, { vertexColors: true }), tall.length);
  const m = new THREE.Matrix4();
  let ri = 0;
  let ti = 0;
  spots.forEach((s, i) => {
    trunks.getMatrixAt(i, m);
    if (s.cypress) {
      cones.setMatrixAt(ti, m);
      cones.setColorAt(ti++, tint.set(0x3a8a4c).offsetHSL(0, 0, (rand() - 0.5) * 0.05));
    } else {
      crowns.setMatrixAt(ri, m);
      crowns.setColorAt(ri++, tint.set(0x6cc04a).offsetHSL((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.1));
    }
  });
  for (const mesh of [crowns, cones]) {
    mesh.castShadow = true;
    mesh.frustumCulled = false;
  }
  group.add(trunks, crowns, cones);
  return group;
}

// ---------------------------------------------------------------- rocks

export function createRocks(count: number): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.72 + 0.55 * fbm(v.x * 1.7 + v.y * 2.3 + 5, v.z * 1.7 - v.y * 1.9 + 9, 2);
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();

  const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), count);
  const rand = seededRandom(5);
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    do {
      const r = 5 + 150 * rand() * rand();
      const a = rand() * 6.28;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    } while (nearPath(x, z, 3));
    const s = 0.35 + rand() * rand() * 2.2;
    dummy.position.set(x, heightAt(x, z) + s * 0.15, z);
    dummy.rotation.set(rand() * 0.5, rand() * 6.28, rand() * 0.5);
    dummy.scale.set(s, s * (0.55 + rand() * 0.3), s * (0.8 + rand() * 0.4));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tint.set(0xb0aea2).offsetHSL(0, 0, (rand() - 0.5) * 0.1));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
