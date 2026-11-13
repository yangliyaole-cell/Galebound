import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Use the REAL asset, skeleton, skin matrices, garment UVs and morphs. Only image fetching is removed.
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
  const { CapeSimulation, capePatternFromMesh, capePreviewAt, capePenetration, CAPE_DETAIL } = await server.ssrLoadModule('/src/player/cape-sim.ts');
  const { createHeroRig, heroCapeColliders } = await server.ssrLoadModule('/src/player/hero-model.ts');
  const { Character } = await server.ssrLoadModule('/src/player/character.ts');
  const originalCape = gltf.scene.getObjectByName('Traveler_Cape');
  const patterns = Object.fromEntries(['low', 'medium', 'high'].map(tier => [tier, capePatternFromMesh(originalCape.geometry.attributes.position.array,
    originalCape.geometry.attributes.uv.array, originalCape.geometry.morphAttributes.position[0].array, tier)]));
  assert.ok(patterns.high.rest.length > patterns.medium.rest.length && patterns.medium.rest.length > patterns.low.rest.length);
  console.log('PASS quality point counts high > medium > low');
  const fresh = tier => {
    const rig = createHeroRig(clone(gltf.scene), tier), character = new Character(false);
    character.root.clear(); character.root.add(...rig.root.children); character.rig = { ...rig, root: character.root };
    return character;
  };
  const sequences = ['idle', 'run', 'jump', 'glide', 'turn', 'wind'];
  const all = {};
  for (const tier of ['low', 'medium', 'high']) {
    const metrics = { points: 0, constraints: 0, maxPenetration: 0, maxFrameMovement: 0, maxSpeed: 0, solverMs: [], updateMs: [], triangles: 0, vertices: 0 };
    for (const sequence of sequences) {
      const character = fresh(tier), root = character.root;
      const mesh = root.getObjectByName('Traveler_Cape_SoftCloth');
      const velocity = new THREE.Vector3(), wind = new THREE.Vector3(), prior = new THREE.Vector3();
      let previous, distance = 0, maxMovement = 0, maxDepth = 0, previousBlend = 0;
      const frames = (sequence === 'glide' ? 7 : 5.4) * 60;
      for (let frame = -60; frame <= frames; frame++) {
        const time = frame / 60, take = capePreviewAt(sequence === 'wind' ? 'glide' : sequence, time);
        prior.copy(root.position);
        const travel = take.distance - distance;
        root.position.x += Math.sin(take.yaw) * travel; root.position.z += Math.cos(take.yaw) * travel;
        root.position.y = take.height; root.rotation.y = take.yaw;
        distance = take.distance;
        velocity.copy(root.position).sub(prior).multiplyScalar(60);
        wind.fromArray(take.wind);
        if (sequence === 'wind') wind.set(28 * Math.sin(time * 1.3), 5 * Math.cos(time * 2.2), -35);
        character.update(1 / 60, time, { motion: take.motion, speed: take.speed, turn: take.turn, dive: 0, velocity, wind }, () => 0);
        root.updateMatrixWorld(true);
        const positions = mesh.geometry.attributes.position;
        const world = new Float64Array(positions.count * 3), point = new THREE.Vector3();
        for (let n = 0; n < positions.count; n++) {
          point.fromBufferAttribute(positions, n).applyMatrix4(mesh.matrixWorld).toArray(world, n * 3);
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), `${tier}/${sequence}: non-finite vertex`);
          assert.ok(point.distanceTo(root.position) < 4, `${tier}/${sequence}: unbounded cloth at ${time}`);
          if (previous && frame > -59) maxMovement = Math.max(maxMovement, Math.hypot(world[n * 3] - previous[n * 3], world[n * 3 + 1] - previous[n * 3 + 1], world[n * 3 + 2] - previous[n * 3 + 2]));
        }
        const colliders = heroCapeColliders(character.rig), depth = capePenetration(world, colliders);
        maxDepth = Math.max(maxDepth, depth);
        assert.ok(depth < 0.002, `${tier}/${sequence}: penetration ${(depth * 1000).toFixed(2)}mm at ${time}`);
        const stats = character.rig.capeStats();
        assert.ok(stats.maxSpeed <= 28.0001, `${tier}/${sequence}: unbounded velocity`);
        assert.ok(stats.maxPenetration < 0.002);
        assert.ok(Math.abs(stats.glideBlend - previousBlend) <= 0.096, `${tier}/${sequence}: abrupt flight blend`);
        previousBlend = stats.glideBlend;
        if (frame >= 30) { metrics.solverMs.push(stats.simulationMs); metrics.updateMs.push(stats.updateMs); }
        metrics.points = stats.points; metrics.constraints = stats.constraints; metrics.maxSpeed = Math.max(metrics.maxSpeed, stats.maxSpeed);
        metrics.triangles = stats.renderTriangles; metrics.vertices = stats.renderVertices;
        previous = world;
      }
      // Includes world-space motion, sudden bank, posed limbs AND contact correction.
      assert.ok(maxMovement < (sequence === 'glide' ? 0.3 : 0.4), `${tier}/${sequence}: frame discontinuity ${maxMovement.toFixed(3)}m`);
      metrics.maxPenetration = Math.max(metrics.maxPenetration, maxDepth); metrics.maxFrameMovement = Math.max(metrics.maxFrameMovement, maxMovement);
      console.log(`PASS ${tier}/${sequence}: depth=${(maxDepth * 1000).toFixed(4)}mm, max vertex step=${maxMovement.toFixed(4)}m`);
      let heroCalls = 0, heroTriangles = 0;
      root.traverseVisible(o => {
        if (o.isMesh) { heroCalls += Array.isArray(o.material) ? o.geometry.groups.length : 1; heroTriangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }
      });
      metrics.heroDrawCalls = heroCalls; metrics.heroTriangles = heroTriangles;
      root.traverse(o => { if (o.name.endsWith('_SoftCloth')) { o.geometry.dispose(); o.material.dispose(); } });
    }
    const summarize = values => ({ mean: values.reduce((a, b) => a + b, 0) / values.length, p95: [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] });
    all[tier] = { ...metrics, solverMs: summarize(metrics.solverMs), updateMs: summarize(metrics.updateMs) };
  }
  // Direct pure solver determinism, including previous-state integration and banked body contact.
  for (const tier of ['low', 'medium', 'high']) {
    const a = new CapeSimulation(patterns[tier], tier), b = new CapeSimulation(patterns[tier], tier);
    for (let frame = 0; frame < 150; frame++) {
      const t = frame / 60, targets = new Float64Array(patterns[tier].rest.length), glide = Math.min(1, Math.max(0, (t - 0.5) * 1.4));
      for (let i = 0; i < targets.length; i++) targets[i] = patterns[tier].rest[i] + (patterns[tier].glide[i] - patterns[tier].rest[i]) * glide;
      const input = { targets, colliders: [{ a: [0, 1, 0], b: [0, 1.36, 0], radius: 0.145 }], wind: [15, 2, -20], velocity: [0, 0, 0], glide };
      a.update(1 / 60, t, input); b.update(1 / 60, t, input);
      assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.previous, b.previous);
    }
    const snapshot = new Float64Array(a.positions);
    a.update(0, 4, { targets: snapshot, colliders: [], wind: [0, 0, 0], velocity: [0, 0, 0], glide: 0 });
    assert.deepEqual(a.positions, snapshot);
    console.log(`PASS ${tier}: bit-exact determinism and dt=0 freeze (${CAPE_DETAIL[tier].substeps} substeps)`);
  }
  // Full prone rotations with simultaneous yaw, bank and dive, rather than upright yaw alone.
  for (const tier of ['low', 'medium', 'high']) {
    const character = fresh(tier), root = character.root;
    const mesh = root.getObjectByName('Traveler_Cape_SoftCloth');
    let maxDepth = 0;
    for (let frame = 0; frame < 180; frame++) {
      const t = frame / 60;
      root.position.set(Math.sin(t) * 2, 3 + Math.sin(t * 0.7) * 0.3, t * 6);
      root.rotation.y = t * 1.4;
      character.update(1 / 60, t, { motion: 'glide', speed: 6, turn: Math.sin(t * 3.4), dive: Math.sin(t * 1.9),
        velocity: new THREE.Vector3(Math.cos(t) * 2, Math.cos(t * 0.7) * 0.21, 6), wind: new THREE.Vector3(24, -4, -30) }, () => 0);
      const world = new Float64Array(mesh.geometry.attributes.position.count * 3), v = new THREE.Vector3();
      for (let n = 0; n < world.length / 3; n++) v.fromBufferAttribute(mesh.geometry.attributes.position, n).applyMatrix4(mesh.matrixWorld).toArray(world, n * 3);
      assert.ok(world.every(Number.isFinite));
      maxDepth = Math.max(maxDepth, capePenetration(world, heroCapeColliders(character.rig)));
      assert.ok(maxDepth < 0.002, `${tier}: bank/dive contact penetration ${maxDepth}`);
    }
    console.log(`PASS ${tier}: prone yaw/bank/dive with strong wind, depth=${(maxDepth * 1000).toFixed(4)}mm`);
  }
  // Exercise the exact screenshot entry point, not a separate approximation of the take.
  for (const sequence of ['idle', 'run', 'jump', 'glide', 'turn']) {
    const character = fresh('low'), camera = new THREE.PerspectiveCamera();
    character.root.position.y = 4;
    character.prepareCapeShot(new URLSearchParams(`capemotion=${sequence}&capet=2.8&capeangle=invalid`), () => 0, camera);
    assert.equal(character.root.userData.capeShot.seconds, 2.8);
    assert.ok(camera.position.toArray().every(Number.isFinite));
    assert.ok(character.root.position.y >= 4, 'staging must preserve the URL up offset');
    assert.equal(camera.fov, 48);
  }
  const capture = () => {
    const character = fresh('high'), camera = new THREE.PerspectiveCamera();
    character.root.rotation.y = Math.PI;
    character.prepareCapeShot(new URLSearchParams('capemotion=glide&capet=3.4'), () => 0, camera);
    return { vertices: [...character.root.getObjectByName('Traveler_Cape_SoftCloth').geometry.attributes.position.array],
      camera: camera.position.toArray(), metadata: character.root.userData.capeShot };
  };
  assert.deepEqual(capture(), capture());
  console.log('PASS shot=cape: all five presets, finite camera, up offset and bit-exact repeated high/glide capet=3.4');
  assert.ok(all.low.solverMs.mean < all.medium.solverMs.mean && all.medium.solverMs.mean < all.high.solverMs.mean, 'quality CPU cost must scale with fidelity');
  console.log('CAPE_METRICS ' + JSON.stringify(all));
  console.log('PASS cape: real asset, six action sequences, all tiers, contacts, continuity, bounded speed and determinism; no WebGL');
} finally { await server.close(); }
