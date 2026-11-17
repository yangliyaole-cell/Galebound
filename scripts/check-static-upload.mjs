import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
import { WebGLAttributes } from '../node_modules/three/src/renderers/webgl/WebGLAttributes.js';
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { releaseStructureArraysAfterUpload } = await server.ssrLoadModule('/src/render/static-upload.ts');
  const { packFloats, PackedStaticAttribute } = await server.ssrLoadModule('/src/render/packed-attribute.ts');
  const { classifyNaturalStone } = await server.ssrLoadModule('/src/render/pbr/natural-stone.ts');
  const detail = await server.ssrLoadModule('/src/world/structure-detail.ts');
  const scene = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const building = new THREE.Mesh(new THREE.BoxGeometry(), material); building.name = 'structure-stone';
  const relief = new THREE.Mesh(new THREE.BoxGeometry(), material); relief.name = 'Settlement merged relief';
  const terrain = new THREE.Mesh(new THREE.BoxGeometry(), material); terrain.name = 'Terrain';
  const instance = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1); instance.name = 'structure-instanced';
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(), material); cloth.name = 'Traveler_Cape_SoftCloth';
  scene.add(building, relief, terrain, instance, cloth); detail.registerStructureDetail(relief);
  // Compression must preserve exact Float32 words, including signed zero and bit boundaries.
  for (const source of [
    new Float32Array(900).fill(.70710677),
    Float32Array.from({ length: 6000 }, (_, i) => i % 19 === 0 ? -0 : Math.fround(Math.sin(i % 97) * 12.5)),
    Float32Array.from({ length: 900 }, (_, i) => Math.fround(Math.sin(i * 137.1) * i)),
  ]) {
    const packed = packFloats(source), result = packed.unpack();
    assert.deepEqual(new Uint32Array(result.buffer), new Uint32Array(source.buffer));
    const a = new PackedStaticAttribute([packed], 3);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) assert.ok(Object.is(a.getComponent(i, c), source[i * 3 + c]));
    assert.deepEqual(a.clone().array, source);
  }
  // Real merged relief uses multiple blocks. Bounds/PBR/raycast reads must not inflate them.
  const input = relief.geometry.toNonIndexed(), originals = {};
  for (const [name, attribute] of Object.entries(input.attributes)) {
    const values = new Float32Array(attribute.array); originals[name] = values;
    const middle = Math.floor(values.length / 6) * 3;
    input.setAttribute(name, new PackedStaticAttribute([packFloats(values.slice(0, middle)), packFloats(values.slice(middle))], attribute.itemSize));
  }
  relief.geometry = input;
  const beforeBounds = relief.geometry.attributes.position.cpuBytes;
  relief.geometry.computeBoundingBox(); relief.geometry.computeBoundingSphere();
  assert.equal(relief.geometry.attributes.position.cpuBytes, beforeBounds);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -1));
  relief.updateMatrixWorld(true);
  assert.ok(ray.intersectObject(relief).length > 0);
  assert.equal(relief.geometry.attributes.position.cpuBytes, beforeBounds);
  assert.equal(classifyNaturalStone(relief.geometry).components, 0);
  detail.registerStructureDetail(relief);
  let prior = 0;
  building.geometry.attributes.position.onUpload(() => prior++);
  releaseStructureArraysAfterUpload(scene);
  assert.ok(building.geometry.boundingSphere && building.geometry.boundingBox);
  assert.ok(relief.geometry.boundingSphere && relief.geometry.boundingBox);
  let uploaded = 0, expectedUpload;
  const gl = { FLOAT: 5126, UNSIGNED_SHORT: 5123, SHORT: 5122, UNSIGNED_BYTE: 5121, createBuffer: () => ({}), bindBuffer() {}, bufferData(_target, array) {
    assert.ok(array); if (expectedUpload) assert.deepEqual(array, expectedUpload); uploaded++;
  } };
  // Exercise Three r187's actual create/update/cache code, not just the callback in isolation.
  const attributes = WebGLAttributes(gl);
  for (const mesh of [building, relief]) {
    for (const attribute of [...Object.values(mesh.geometry.attributes), mesh.geometry.index].filter(Boolean)) {
      const count = attribute.count, version = attribute.version;
      expectedUpload = undefined;
      if (mesh === relief) {
        const name = Object.keys(mesh.geometry.attributes).find(key => mesh.geometry.attributes[key] === attribute);
        if (name && name in originals) expectedUpload = originals[name];
      }
      attributes.update(attribute, 34962);
      assert.equal(attribute.array, null); assert.equal(attribute.count, count); assert.equal(attribute.version, version);
      attributes.update(attribute, 34962); // A second pass/frame/material uses the cached GL buffer.
      assert.ok(attributes.get(attribute).buffer);
    }
  }
  assert.equal(prior, 1); assert.equal(uploaded, Object.keys(building.geometry.attributes).length + 1 + Object.keys(relief.geometry.attributes).length);
  assert.equal(classifyNaturalStone(relief.geometry).components, 0); // Cached PBR audit never reads released arrays.
  detail.updateStructureDetails(new THREE.Vector3(0, 0, 0)); assert.ok(relief.visible);
  detail.updateStructureDetails(new THREE.Vector3(10000, 0, 0)); assert.equal(relief.visible, false);
  for (const mesh of [terrain, instance, cloth]) for (const attribute of Object.values(mesh.geometry.attributes)) {
    attribute.onUploadCallback(); assert.ok(attribute.array, `${mesh.name} must retain CPU data`);
  }
  console.log('PASS static uploads: actual Three cache supports freed arrays; bounds/detail culling survive; terrain/instances/cloth retained');
} finally { await server.close(); }
