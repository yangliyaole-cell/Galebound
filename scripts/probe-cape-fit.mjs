// Diagnostic: how far does the real body mesh stick out past the cape's collision capsules?
// Run: node scripts/probe-cape-fit.mjs   (no WebGL; uses the real GLB, skeleton and poses)
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const bytes = readFileSync('public/models/traveler.glb');
const jsonLength = bytes.readUInt32LE(12), asset = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
for (const material of asset.materials) {
  delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  delete material.pbrMetallicRoughness?.baseColorTexture;
  delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
}
delete asset.images; delete asset.textures;
const json = Buffer.from(JSON.stringify(asset)), padding = (4 - json.length % 4) % 4;
const binChunk = bytes.subarray(20 + jsonLength), header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + padding + binChunk.length, 8);
header.writeUInt32LE(json.length + padding, 12); header.writeUInt32LE(0x4e4f534a, 16);
const stripped = Buffer.concat([header, json, Buffer.alloc(padding, 32), binChunk]);
const gltf = await new GLTFLoader().parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '');
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { createHeroRig, heroCapeColliders } = await server.ssrLoadModule('/src/player/hero-model.ts');
  const { poseFor } = await server.ssrLoadModule('/src/player/character.ts');
  const { applyPose } = await server.ssrLoadModule('/src/player/rig.ts');
  const rig = createHeroRig(clone(gltf.scene), 'low');
  const skip = /Cape|Hair|Head|Eyes|Face|Mask|Gloves|Arms|Neck/;
  const meshes = [];
  rig.root.traverse((o) => { if (o.isSkinnedMesh && o.visible && !skip.test(o.name)) meshes.push(o); });
  const names = ['torso', 'shoulders', 'pelvis', 'upperL', 'foreL', 'thighL', 'shinL', 'upperR', 'foreR', 'thighR', 'shinR'];
  const v = new THREE.Vector3();
  for (const [motion, phase] of [['idle', 0], ['walk', 0], ['walk', Math.PI / 2], ['run', 0], ['run', Math.PI / 2], ['run', Math.PI], ['glide', 0], ['fall', 0], ['land', 0]]) {
    applyPose(rig, poseFor(motion, phase, 0, 0, 0));
    rig.root.updateMatrixWorld(true);
    const caps = heroCapeColliders(rig);
    const worst = caps.map(() => []);
    for (const mesh of meshes) {
      mesh.skeleton.update();
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld);
        // Only the back half of the body matters for a cape hanging behind (local -Z).
        if (v.z > 0.02) continue;
        let best = Infinity, which = -1;
        caps.forEach((c, n) => {
          const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b);
          const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, v.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
          const near = a.addScaledVector(ab, t), off = v.clone().sub(near);
          // Back sector only: the cape hangs behind (-Z). Side bulges never meet it.
          if (process.env.BACK && off.z > -0.6 * off.length()) return;
          const d = off.length() - c.radius;
          if (d < best) { best = d; which = n; }
        });
        if (which >= 0 && best > 0) worst[which].push({ d: best, mesh: mesh.name, y: v.y, x: v.x, z: v.z });
      }
    }
    const report = worst.map((list, n) => {
      if (!list.length) return null;
      list.sort((a, b) => b.d - a.d);
      const p95 = list[Math.floor(list.length * 0.05)].d;
      return `${names[n]} max ${(list[0].d * 100).toFixed(1)}cm (${list[0].mesh} y=${list[0].y.toFixed(2)}) p95 ${(p95 * 100).toFixed(1)}cm n=${list.length}`;
    }).filter(Boolean);
    console.log(`${motion}@${phase.toFixed(2)}\n  ${report.join('\n  ')}`);
  }
} finally {
  await server.close();
}
