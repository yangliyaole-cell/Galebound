// Diagnostic: how deep would the cloak's own rest shape sit inside enlarged capsules?
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
const bytes = readFileSync('public/models/traveler.glb');
const jsonLength = bytes.readUInt32LE(12), asset = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
for (const m of asset.materials) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.pbrMetallicRoughness?.baseColorTexture; delete m.pbrMetallicRoughness?.metallicRoughnessTexture; }
delete asset.images; delete asset.textures;
const json = Buffer.from(JSON.stringify(asset)), padding = (4 - json.length % 4) % 4;
const binChunk = bytes.subarray(20 + jsonLength), header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + padding + binChunk.length, 8);
header.writeUInt32LE(json.length + padding, 12); header.writeUInt32LE(0x4e4f534a, 16);
const stripped = Buffer.concat([header, json, Buffer.alloc(padding, 32), binChunk]);
const gltf = await new GLTFLoader().parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '');
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { createHeroRig, heroCapeColliders } = await server.ssrLoadModule('/src/player/hero-model.ts');
  const scene = clone(gltf.scene);
  const cape = scene.getObjectByName('Traveler_Cape');
  const rig = createHeroRig(scene, 'low');
  rig.root.updateMatrixWorld(true);
  const caps = heroCapeColliders(rig);
  const names = ['torso', 'shoulders', 'pelvis', 'upperL', 'foreL', 'thighL', 'shinL', 'upperR', 'foreR', 'thighR', 'shinR', 'footL', 'footR'];
  const v = new THREE.Vector3(), pos = cape.geometry.attributes.position;
  cape.skeleton.update();
  const depth = caps.map(() => -Infinity);
  for (let i = 0; i < pos.count; i++) {
    cape.getVertexPosition(i, v); v.applyMatrix4(cape.matrixWorld);
    caps.forEach((c, n) => {
      const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b), ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, v.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
      depth[n] = Math.max(depth[n], c.radius - v.distanceTo(a.addScaledVector(ab, t)));
    });
  }
  // Back profile: per height band, most-backward body point vs cloak rest (inner wall), and the body's half-width there.
  const body = [], skip = /Cape|Hair|Eyes|Face|Mask|Gloves|Arms|Hand/;
  rig.root.traverse((o) => { if (o.isSkinnedMesh && !skip.test(o.name)) body.push(o); });
  const band = (y) => Math.round(y * 20) / 20;
  const back = new Map(), cloak = new Map();
  for (const m of body) { m.skeleton.update(); const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (Math.abs(v.x) > 0.12) continue; const k = band(v.y); const o = back.get(k) ?? { z: 0, w: 0, who: '' }; if (v.z < o.z) { o.z = v.z; o.who = m.name; } back.set(k, o); } }
  for (let i = 0; i < pos.count; i++) { cape.getVertexPosition(i, v); v.applyMatrix4(cape.matrixWorld); if (Math.abs(v.x) > 0.12) continue; const k = band(v.y); cloak.set(k, Math.max(cloak.get(k) ?? -1, v.z)); }
  for (const k of [...back.keys()].sort((a, b) => a - b)) if (k > 0.3 && k < 1.65) console.log(`y=${k.toFixed(2)} bodyBackZ=${back.get(k).z.toFixed(3)} (${back.get(k).who}) cloakInnerZ=${(cloak.get(k) ?? NaN).toFixed(3)}`);
  caps.forEach((c, n) => console.log(`${names[n] ?? n} r=${c.radius} capeRestInside=${(depth[n] * 100).toFixed(1)}cm`));
} finally { await server.close(); }
