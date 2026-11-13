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
// Canvas drawing is the only stub; terrain, textures, grass, GLB, bones and cameras are production code.
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (object, key) => {
  if (key in object) return object[key];
  if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
  if (key === 'getImageData') return (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
  return () => {};
}, set: (object, key, value) => (object[key] = value, true) });
globalThis.document = { documentElement: { dataset: {} }, createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
try {
  const { createHeroRig, heroCapeColliders } = await server.ssrLoadModule('/src/player/hero-model.ts');
  const { prepareCapeShotFromPlayer, inspectCapeShotScene } = await server.ssrLoadModule('/src/player/character.ts');
  const { capePenetration } = await server.ssrLoadModule('/src/player/cape-sim.ts');
  const { Player } = await server.ssrLoadModule('/src/player/controller.ts');
  const { FollowCamera } = await server.ssrLoadModule('/src/player/camera.ts');
  const { Wind } = await server.ssrLoadModule('/src/world/wind.ts');
  const H = await server.ssrLoadModule('/src/world/heightmap.ts');
  const { createTerrain, groundUniforms } = await server.ssrLoadModule('/src/world/terrain.ts');
  const { createGrass } = await server.ssrLoadModule('/src/world/grass.ts');
  const { buildSplat, buildBiome } = await server.ssrLoadModule('/src/world/maps.ts');
  const { groundDetailTexture } = await server.ssrLoadModule('/src/render/textures.ts');
  const { createMaterialStyles } = await server.ssrLoadModule('/src/render/styles/materials.ts');
  const { cinematic } = await server.ssrLoadModule('/src/render/styles/cinematic.ts');
  H.buildHeightmap(4);
  const scene = new THREE.Scene(), terrain = createTerrain();
  terrain.name = 'Terrain'; scene.add(terrain);
  const heightTex = H.createHeightTexture();
  groundUniforms.uSplat.value = buildSplat(2048); groundUniforms.uBiome.value = buildBiome();
  groundUniforms.uDetail.value = groundDetailTexture();
  const grass = createGrass(24000, 36000, 6000, heightTex);
  grass.name = 'Grass'; scene.add(grass);
  scene.userData.worldBuilt = true;
  const fresh = (tier = 'high') => {
    const player = new Player(false), character = player.character, rig = createHeroRig(clone(gltf.scene), tier);
    character.root.clear(); character.root.add(...rig.root.children); character.rig = { ...rig, root: character.root };
    character.cloth.visible = false;
    scene.add(character.root, character.cloth);
    player.teleport(0, 100, Math.PI);
    return player;
  };
  const release = player => {
    scene.remove(player.character.root, player.character.cloth);
    player.character.root.traverse(o => { if (o.name.endsWith('_SoftCloth')) { o.geometry.dispose(); o.material.dispose(); } });
  };
  const camera = () => new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 7000);

  // R1 regression: teleport only changes Player; the unsynchronised preview must be rejected.
  const broken = fresh();
  assert.deepEqual(broken.character.root.position.toArray(), [0, 0, 0]);
  assert.equal(broken.character.root.rotation.y, 0);
  assert.ok(broken.pos.distanceTo(broken.character.root.position) > 100);
  const brokenCamera = camera();
  broken.character.prepareCapeShot(new URLSearchParams('shot=cape&capemotion=run&capet=3'), H.heightAt, brokenCamera);
  const rejected = inspectCapeShotScene(scene, terrain, broken.character, brokenCamera, H.heightAt);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.issues.includes('Character staging pose is below terrain'));
  assert.ok(rejected.issues.includes('Cape has separated from the character'));
  console.log('PASS R1 reproduction rejected: ' + JSON.stringify(rejected));
  release(broken);

  const audit = (player, cam) => {
    const character = player.character, cape = scene.getObjectByName('Traveler_Cape_SoftCloth');
    const report = inspectCapeShotScene(scene, terrain, character, cam, H.heightAt);
    assert.ok(report.ok, report.issues.join('; '));
    assert.equal(report.capeMeshes, 1); assert.equal(report.terrainMeshes, 256);
    assert.ok(scene.children.includes(terrain) && scene.children.includes(grass));
    assert.ok(grass.children.length === 3 && groundUniforms.uSplat.value.version > 0 && heightTex.version > 0);
    assert.ok(character.rig.setCapeState && !character.cloth.visible, 'detailed hero must use the soft cape');
    assert.equal(character.root.getObjectByName('Traveler_Cape').visible, false, 'morph-only cape must not draw');
    assert.ok(cape.visible && cape.material.visible && cape.material.opacity === 1 && !cape.material.transparent);
    assert.equal(cape.material.side, THREE.DoubleSide);
    assert.equal(cape.frustumCulled, false);
    const positions = cape.geometry.attributes.position, index = cape.geometry.index;
    const world = new Float64Array(positions.count * 3), point = new THREE.Vector3();
    const chestInverse = character.rig.chest.matrixWorld.clone().invert();
    let behind = 0;
    for (let n = 0; n < positions.count; n++) {
      point.fromBufferAttribute(positions, n);
      assert.ok(point.distanceTo(cape.geometry.boundingSphere.center) <= cape.geometry.boundingSphere.radius + 1e-5, 'stale cloth bounding sphere');
      point.applyMatrix4(cape.matrixWorld).toArray(world, n * 3);
      assert.ok(point.toArray().every(Number.isFinite));
      point.applyMatrix4(chestInverse);
      if (point.z < -0.025) behind++;
    }
    assert.ok(behind / positions.count > 0.1, `cape must extend behind the posed torso: ${behind}/${positions.count}`);
    assert.ok(capePenetration(world, heroCapeColliders(character.rig)) < 0.002);
    const down = new THREE.Raycaster(cam.position, new THREE.Vector3(0, -1, 0));
    assert.ok(down.intersectObject(terrain, true).some(hit => hit.distance > 0.2), 'camera must be above the ACTUAL terrain triangles');
    // Visibility evidence stronger than mesh.visible: rays reach cloth before the visible body.
    const meshes = [];
    character.root.traverseVisible(object => { if (object.isMesh && object.material.visible) meshes.push(object); });
    let visibleRays = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < index.count; i += Math.ceil(index.count / 96 / 3) * 3) {
      a.fromBufferAttribute(positions, index.getX(i)); b.fromBufferAttribute(positions, index.getX(i + 1)); c.fromBufferAttribute(positions, index.getX(i + 2));
      const center = a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(cape.matrixWorld);
      const ray = new THREE.Raycaster(cam.position, center.sub(cam.position).normalize(), 0.05, 10);
      if (ray.intersectObjects(meshes, false)[0]?.object === cape) visibleRays++;
    }
    assert.ok(visibleRays >= 3, `cape occluded by body: only ${visibleRays} visible sample rays`);
    return { ...report, behindFraction: behind / positions.count, visibleRays };
  };
  const takes = [
    ...[1, 1.3, 2, 3, 4.5, 4.6, 4.8, 5.2].map(t => ['run', t]),
    ['idle', 3], ['jump', 1.9], ['jump', 3.2], ['glide', 2.7], ['glide', 4], ['glide', 5.6], ['glide', 6.2],
    ['turn', 2.55], ['turn', 2.85],
  ];
  const metrics = [];
  for (const [motion, seconds] of takes) {
    const player = fresh(), cam = camera(), origin = player.pos.clone();
    // The exact entry used by main.ts: no preparatory manual root positioning.
    prepareCapeShotFromPlayer(player, new URLSearchParams(`shot=cape&capemotion=${motion}&capet=${seconds}`), H.heightAt, cam);
    const metadata = player.character.root.userData.capeShot;
    assert.deepEqual(metadata.origin, origin.toArray()); assert.equal(metadata.heading, Math.PI);
    createMaterialStyles({ scene, sky: new THREE.Group() })('cinematic', cinematic);
    const report = audit(player, cam);
    assert.equal(report.vertices, 8722);
    metrics.push({ motion, seconds, root: player.pos.toArray(), camera: cam.position.toArray(), ...report });
    console.log(`PASS high ${motion}/${seconds}: terrain=${report.terrainMeshes}, cape=${report.vertices}, area=${report.area.toFixed(3)}m2, inView=${(report.inView / report.vertices).toFixed(3)}, behind=${report.behindFraction.toFixed(3)}, rays=${report.visibleRays}, clearance=${report.cameraClearance.toFixed(3)}m`);
    // Ready gating must reject missing world, missing terrain and a hidden cape.
    if (motion === 'idle') {
      scene.userData.worldBuilt = false;
      assert.equal(inspectCapeShotScene(scene, terrain, player.character, cam, H.heightAt).ok, false);
      scene.userData.worldBuilt = true; scene.remove(terrain);
      assert.equal(inspectCapeShotScene(scene, terrain, player.character, cam, H.heightAt).ok, false);
      scene.add(terrain);
      const cape = scene.getObjectByName('Traveler_Cape_SoftCloth'); cape.visible = false;
      assert.equal(inspectCapeShotScene(scene, terrain, player.character, cam, H.heightAt).ok, false);
      cape.visible = true;
      const saved = cam.position.clone(); cam.position.y = H.heightAt(cam.position.x, cam.position.z) - 1;
      assert.equal(inspectCapeShotScene(scene, terrain, player.character, cam, H.heightAt).ok, false);
      cam.position.copy(saved);
    }
    release(player);
  }
  for (const tier of ['low', 'medium']) {
    const player = fresh(tier), cam = camera();
    prepareCapeShotFromPlayer(player, new URLSearchParams('shot=cape&capemotion=glide&capet=4'), H.heightAt, cam);
    const report = audit(player, cam);
    console.log(`PASS ${tier} staged glide: ${report.vertices} vertices, camera clearance ${report.cameraClearance.toFixed(3)}m`);
    release(player);
  }
  // Original shot=1 and normal Player.update keep using the same dynamic Mesh, not the hidden morph skin.
  for (const mode of ['shot=1', 'game']) {
    const player = fresh(), cam = camera(), follow = new FollowCamera(cam, false), wind = new Wind();
    follow.yaw = -0.16; follow.pitch = 0.12; follow.distance = 8.5;
    const input = { moveX: 0, moveY: 0, run: false, takeJump: () => false };
    for (let frame = 0; frame < 90; frame++) { player.update(1 / 60, 12, input, follow.yaw, wind); follow.update(1 / 60, player); }
    scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
    const report = audit(player, cam);
    assert.ok(player.character.rig.capeStats().simulationMs > 0);
    console.log(`PASS ${mode}: visible soft cape, ${report.vertices} vertices, ${report.visibleRays} unoccluded sample rays`);
    release(player);
  }
  console.log('CAPE_SCENE_METRICS ' + JSON.stringify(metrics));
  console.log('PASS cape scene: real teleport, terrain/grass/materials, visible nondegenerate cape behind torso, current bounds, camera clearance, ray visibility and ready rejection; no WebGL');
} finally { await server.close(); }
