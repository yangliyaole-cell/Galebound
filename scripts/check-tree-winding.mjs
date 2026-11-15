import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

// Tree wood is drawn with front faces only, so every triangle must wind counter-clockwise seen from outside:
// its geometric normal has to agree with the outward vertex normal the tube writes.
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { makeTree } = await server.ssrLoadModule('/src/world/flora/tree-models.ts');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), vn = new THREE.Vector3();
  for (const kind of ['oak', 'great', 'blossom', 'cypress', 'pine']) for (const detail of [0, 1, 2]) {
    const g = makeTree(kind, 11, detail).wood, p = g.attributes.position, nor = g.attributes.normal, idx = g.index.array;
    let out = 0, inward = 0;
    for (let i = 0; i < idx.length; i += 3) {
      a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-14) continue;
      vn.fromBufferAttribute(nor, idx[i]).add(vn.fromBufferAttribute(nor, idx[i + 1])).add(vn.fromBufferAttribute(nor, idx[i + 2]));
      if (n.dot(vn) > 0) out++; else inward++;
    }
    assert.ok(out + inward > 20, `${kind}/${detail}: no wood triangles`);
    assert.ok(inward / (out + inward) < 0.02, `${kind}/${detail}: ${inward} of ${out + inward} wood triangles face inward (front-face culling would hide the near side of the trunk)`);
    console.log(`ok ${kind} detail ${detail}: ${out} outward, ${inward} inward`);
  }
} finally { await server.close(); }
