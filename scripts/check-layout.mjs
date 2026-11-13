import assert from 'node:assert/strict';
import { measure, collisionDigest, reviewViews, inventory, screenshotViews } from './detail-metrics.mjs';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import * as THREE from 'three';

// Only canvas painting is stubbed. All world TS, Three geometry, colliders and
// procedural placement below are the production modules, without WebGL/Chrome.
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (o, key) => {
  if (key in o) return o[key];
  if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
  if (key === 'getImageData') return (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
  return () => {};
}, set: (o, k, v) => (o[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let failures = 0;
const check = (name, fn) => { try { const details = fn(); console.log(`PASS ${name}${details ? ': ' + details : ''}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); } };
const t0 = performance.now();
try {
  const L = await server.ssrLoadModule('/src/world/layout.ts');
  const H = await server.ssrLoadModule('/src/world/heightmap.ts');
  const C = await server.ssrLoadModule('/src/world/colliders.ts');
  const B = await server.ssrLoadModule('/src/world/build.ts');
  const { PALACE } = await server.ssrLoadModule('/src/world/structures/palace.ts');
  const { buildAbbey, ABBEY_ENTRY } = await server.ssrLoadModule('/src/world/structures/abbey.ts');
  const low = process.argv.includes('--low');
  const detail = low ? 0 : process.argv.includes('--high') ? 2 : 1;
  const tier = low ? 'low' : detail === 2 ? 'high' : 'medium';
  const detailModule = await server.ssrLoadModule('/src/world/structure-detail.ts');
  detailModule.setStructureDetail(detail);
  H.buildHeightmap(low ? 8 : 4);
  const village = (await server.ssrLoadModule('/src/world/structures/village.ts')).buildVillage(detail);
  const landmarks = (await server.ssrLoadModule('/src/world/structures/landmarks.ts')).buildLandmarks();
  const city = (await server.ssrLoadModule('/src/world/structures/city.ts')).buildCity(detail);
  const abbey = buildAbbey();
  const mountain = await server.ssrLoadModule('/src/world/mountain-layout.ts');
  const texture = H.createHeightTexture(), sun = new THREE.Vector3(0.42, 0.72, 0.55).normalize();
  const terrain = (await server.ssrLoadModule('/src/world/terrain.ts')).createTerrain();
  const water = (await server.ssrLoadModule('/src/world/water.ts')).createWater(texture, sun, 0xc5dfed);
  const vegetation = low ? [7000, 9000, 1200] : detail === 2 ? [24000, 36000, 6000] : [14000, 20000, 3000];
  const grass = (await server.ssrLoadModule('/src/world/grass.ts')).createGrass(...vegetation, texture);
  const scatterModule = await server.ssrLoadModule('/src/world/scatter.ts');
  const scatter = scatterModule.createScatter({ tier: low ? 'low' : detail === 2 ? 'high' : 'medium', propRange: low ? 260 : detail === 2 ? 600 : 420 }, sun);
  scatter.update(new THREE.Vector3(L.START.x, 40, L.START.z));
  const life = (await server.ssrLoadModule('/src/world/life.ts')).createLife(village.info, city.info, low ? 3 : 7);
  life.update(1 / 60, 0, new THREE.Vector3(L.START.x, 40, L.START.z));
  const crops = (await server.ssrLoadModule('/src/world/structures/village.ts')).buildCrops(low ? 0.4 : 1, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const { builtHouses } = await server.ssrLoadModule('/src/world/structures/house.ts');
  const { collectOrbPositions } = await server.ssrLoadModule('/src/world/orbs.ts');
  const { x: sx, z: sz } = L.START;
  const sy = H.heightAt(sx, sz);
  const { waterFragmentSample } = await server.ssrLoadModule('/src/world/water.ts');
  const { abbeyGroundMask, abbeyInteriorWeight, createAbbeyLighting, ABBEY_LIGHTING, ABBEY_GROUND_MASK_GLSL } = await server.ssrLoadModule('/src/world/abbey-space.ts');
  const { cityPlotsOverlap } = await server.ssrLoadModule('/src/world/structures/city-parcels.ts');
  check('uploaded bathymetry, actual water geometry, fragment depth alpha and blue color', () => {
    assert.ok(texture.version > 0 && texture.source.version > 0, 'height texture was never scheduled for GPU upload');
    const { data, width, height } = texture.image;
    assert.equal(texture.type, THREE.FloatType, 'height texture should be R32F');
    const sampleTexture = (x, z) => {
      const u = x / L.SIZE + 0.5, v = z / L.SIZE + 0.5;
      if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return -22;
      const nn = width - 1, cellSize = L.SIZE / nn;
      const gx = Math.min(Math.max((x + L.HALF) / cellSize, 0), nn - 1e-4);
      const gz = Math.min(Math.max((z + L.HALF) / cellSize, 0), nn - 1e-4);
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      const at = (i, j) => data[Math.max(0, Math.min(height - 1, j)) * width + Math.max(0, Math.min(width - 1, i))];
      return fx + fz <= 1 ? at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * fx + (at(ix, iz + 1) - at(ix, iz)) * fz
        : at(ix + 1, iz + 1) + (at(ix, iz + 1) - at(ix + 1, iz + 1)) * (1 - fx) + (at(ix + 1, iz) - at(ix + 1, iz + 1)) * (1 - fz);
    };
    const points = [['coast', 0, 560, 0], ['sea', 0, 700, 0], ['mirror', L.LAKE.x, L.LAKE.z, 0],
      ['river', L.BRIDGE.x, L.BRIDGE.z, 0], ['alpine', -744, -722, 94], ['off-map sea', 0, 1300, 0]];
    water.updateMatrixWorld(true);
    for (const [name, x, z, level] of points) {
      const ground = sampleTexture(x, z), result = waterFragmentSample(ground, level);
      assert.ok(level > ground + 0.5, `${name}: bed ${ground} is not below level ${level}`);
      assert.ok(result.depth > 0.5 && result.alpha > 0.65 && result.color[2] > result.color[0] * 1.6, `${name}: invisible or non-blue water`);
      const hits = new THREE.Raycaster(new THREE.Vector3(x, level + 150, z), new THREE.Vector3(0, -1, 0)).intersectObject(water, true);
      assert.ok(hits.some((h) => Math.abs(h.point.y - level) < 0.02), `${name}: no upward-facing water surface`);
      if (Math.abs(x) < L.HALF && Math.abs(z) < L.HALF) assert.ok(level > H.heightAt(x, z) + 0.5, `${name}: water below actual terrain mesh`);
      console.log(`  WATER ${name}: level=${level}, bed=${ground.toFixed(3)}, depth=${result.depth.toFixed(3)}, alpha=${result.alpha.toFixed(3)}, color=#${new THREE.Color().fromArray(result.color).getHexString()}`);
    }
    return 'float32 upload + sea/lake/river/alpine meshes verified';
  });
  check('dense city parcels have clear roof gaps and rising contour shelves', () => {
    const plots = builtHouses.filter((h) => L.insideCity(h.spec.x, h.spec.z)).map((h) => h.spec);
    assert.equal(plots.length, city.info.houseCount);
    assert.ok(plots.length >= 300 && plots.length <= 420, `${plots.length} city houses`);
    for (let i = 0; i < plots.length; i++) for (let j = i + 1; j < plots.length; j++) {
      assert.ok(!cityPlotsOverlap(plots[i], plots[j], 0.5), `overlapping city plots ${i}/${j}`);
    }
    const relief = [];
    for (let k = 0; k < 18; k++) {
      const levels = [0.07, 0.25, 0.43, 0.61, 0.79, 0.97].map((q) => H.heightAt(...L.cityShelfPoint(k / 18 * Math.PI * 2, q)));
      relief.push(levels[0] - levels.at(-1));
    }
    assert.ok(Math.max(...relief) > 24 && L.CITY_TERRACE_EDGES.length === 5);
    return `${plots.length} city houses, 5 shelf edges, relief=${Math.max(...relief).toFixed(1)}m`;
  });
  const maps = await server.ssrLoadModule('/src/world/maps.ts');
  check('city ground between lanes and squares is not blanket cobblestone', () => {
    let tested = 0;
    for (let x = L.CITY.x - 280; x <= L.CITY.x + 280; x += 9) for (let z = L.CITY.z - 280; z <= L.CITY.z + 280; z += 9) {
      if (!L.insideCity(x, z, 8) || Math.hypot(x - L.CITY.x, z - L.CITY.z) < 95 || L.roadClearance(x, z) < 6) continue;
      if (L.PLAZAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + 2)) continue;
      assert.equal(maps.cobbleAt(x, z), 0); tested++;
    }
    assert.ok(tested > 100); return `${tested} unpaved samples between streets`;
  });
  check('abbey blades flowers and scattered props are excluded from the full floor plan', () => {
    const spots = [[L.ABBEY.x, L.ABBEY.z], [L.ABBEY.x, L.ABBEY.z + 39], [L.ABBEY.x - 26, L.ABBEY.z - 9], [L.ABBEY.x + 26, L.ABBEY.z - 9]];
    for (const [x, z] of spots) assert.equal(abbeyGroundMask(x, z), 0);
    for (const mesh of grass.children) {
      if (mesh.material.isShaderMaterial) assert.ok(mesh.material.vertexShader.includes(ABBEY_GROUND_MASK_GLSL) && mesh.material.vertexShader.includes('* abbeyGroundMask(root)'));
      else {
        const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
        mesh.material.onBeforeCompile(shader);
        assert.ok(shader.vertexShader.includes(ABBEY_GROUND_MASK_GLSL) && shader.vertexShader.includes('* abbeyGroundMask(wp.xz)'));
        assert.ok(shader.vertexShader.includes('vGrassAllowed = step(0.001, bladeHeight) * abbeyGroundMask(root)') && shader.fragmentShader.includes('if (vGrassAllowed < 0.5) discard;'));
      }
    }
    const tileSizes = [46, 170, 90];
    let suppressed = 0, visibleIndoor = 0;
    const indoors = (x, z) => { const dx = Math.abs(x - L.ABBEY.x), dz = z - L.ABBEY.z; return (dx < 18 && Math.abs(dz) < 37) || (dx < 29 && Math.abs(dz + 9) < 9) || (dx < 3.5 && dz >= 37 && dz <= 40); };
    for (const [px, pz] of spots) for (let m = 0; m < grass.children.length; m++) {
      const cells = grass.children[m].geometry.attributes.aCell, tile = tileSizes[m];
      const mod = (v, n) => ((v % n) + n) % n;
      for (let i = 0; i < cells.count; i++) {
        const x = px + mod(cells.getX(i) - px + tile / 2, tile) - tile / 2;
        const z = pz + mod(cells.getY(i) - pz + tile / 2, tile) - tile / 2;
        if (indoors(x, z)) { suppressed++; visibleIndoor += abbeyGroundMask(x, z) > 0 ? 1 : 0; }
      }
    }
    let props = 0; const transform = new THREE.Matrix4(), p = new THREE.Vector3();
    scatter.object.traverse((m) => {
      if (!m.isInstancedMesh) return;
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, transform); p.setFromMatrixPosition(transform); if (!abbeyGroundMask(p.x, p.z)) props++; }
    });
    assert.equal(props, 0); assert.equal(visibleIndoor, 0); assert.ok(suppressed > 0);
    return `${suppressed} indoor roots tested, 0 visible grass/flowers, 0 indoor scatter props`;
  });
  check('abbey lighting scopes attenuation to rendering and restores the active style', () => {
    abbey.traverse((o) => assert.ok(!o.isLight, 'abbey added a real-time light'));
    const sun = new THREE.DirectionalLight(0xfff0cf, 3), ambient = new THREE.HemisphereLight(0xcfe6ff, 0x7fa04a, 1.5);
    const fog = new THREE.Fog(0xcfe4f2, 110, 1500), originalHaze = fog.color.clone(), lighting = createAbbeyLighting(sun, ambient, fog);
    const p = new THREE.Vector3(L.ABBEY.x, L.ABBEY.floor, L.ABBEY.z);
    assert.equal(abbeyInteriorWeight(p), 1); lighting.update(1 / 60, p);
    assert.ok(lighting.weight > 0 && lighting.weight < 0.1, 'abrupt entry lighting');
    for (let i = 0; i < 240; i++) lighting.update(1 / 60, p);
    assert.ok(Math.abs(sun.intensity / 3 - ABBEY_LIGHTING.sun) < 0.001 && Math.abs(ambient.intensity / 1.5 - ABBEY_LIGHTING.ambient) < 0.001);
    p.set(L.START.x, 38, L.START.z); for (let i = 0; i < 240; i++) lighting.update(1 / 60, p);
    assert.equal(sun.intensity, 3); assert.equal(ambient.intensity, 1.5); assert.ok(fog.color.equals(originalHaze));
  });
  const { ABBEY_OPTICS, abbeyOpticalEnvelope } = await server.ssrLoadModule('/src/world/abbey-light.ts');
  const { cinematic } = await server.ssrLoadModule('/src/render/styles/cinematic.ts');
  check('abbey optics cannot add HDR energy or wash out the opaque traveller', () => {
    const optics = [];
    abbey.traverse((o) => { if (o.isMesh && o.material.userData.abbeyOptics) optics.push(o); });
    assert.equal(optics.length, 2);
    for (const mesh of optics) {
      const mat = mesh.material, kind = mat.userData.abbeyOptics.kind, cap = ABBEY_OPTICS[kind];
      assert.equal(mat.blending, THREE.NormalBlending); assert.equal(mat.depthTest, true); assert.equal(mat.depthWrite, false);
      assert.equal(mat.uniforms.uLimits.value.x, cap.radiance); assert.equal(mat.uniforms.uLimits.value.y, cap.alpha);
      assert.ok(cap.radiance < cinematic.post.bloom[0]);
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const sample = abbeyOpticalEnvelope(kind, i / 20, j / 20);
        assert.ok(sample.alpha >= 0 && sample.alpha <= cap.alpha && sample.radiance <= cap.radiance);
      }
      if (kind === 'shaft') {
        assert.ok(mat.fragmentShader.includes('smoothstep(1.,1.25,length(delta))'));
        assert.equal(mesh.geometry.attributes.position.count, 10 * 2 * 4);
      }
      let surface = 0.10;
      for (let i = 0; i < 52; i++) surface = cap.radiance * cap.alpha + surface * (1 - cap.alpha);
      assert.ok(surface <= cap.radiance && surface < cinematic.post.bloom[0]);
    }
    return `10 shafts: RGB<=${ABBEY_OPTICS.shaft.radiance}, alpha<=${ABBEY_OPTICS.shaft.alpha}; patches: RGB<=${ABBEY_OPTICS.patch.radiance}, alpha<=${ABBEY_OPTICS.patch.alpha}`;
  });
  check('cinematic style switches, screenshot frames and outdoors keep their own light/fog values', () => {
    const sun = new THREE.DirectionalLight(0xffffff, 3), hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.5);
    let fog = new THREE.Fog(0xcfe4f2, 110, 1500);
    const lighting = createAbbeyLighting(sun, hemi, () => fog), p = new THREE.Vector3(L.ABBEY.x, L.ABBEY.floor, L.ABBEY.z);
    for (const preset of [null, cinematic, null, cinematic]) {
      const si = preset?.sun[1] ?? 3, hi = preset?.hemisphere[2] ?? 1.5;
      sun.intensity = si; hemi.intensity = hi; fog = new THREE.Fog(preset?.fog[0] ?? 0xcfe4f2, 110, 1500);
      const color = fog.color.clone();
      for (let i = 0; i < 24; i++) { // Same settling period as shot=1; simulation need not tick.
        lighting.update(1, p);
        assert.ok(Math.abs(sun.intensity / si - ABBEY_LIGHTING.sun) < (i === 0 ? 0.05 : 0.003));
        lighting.restore(); assert.equal(sun.intensity, si); assert.equal(hemi.intensity, hi); assert.ok(fog.color.equals(color));
      }
    }
    p.set(L.START.x, 38, L.START.z);
    for (let i = 0; i < 240; i++) { lighting.update(1 / 60, p); lighting.restore(); }
    lighting.update(1 / 60, p);
    assert.equal(sun.intensity, cinematic.sun[1]); assert.equal(hemi.intensity, cinematic.hemisphere[2]);
    return `cinematic indoor sun=${(cinematic.sun[1] * ABBEY_LIGHTING.sun).toFixed(3)}, hemi=${(cinematic.hemisphere[2] * ABBEY_LIGHTING.ambient).toFixed(3)}; outdoor restored exactly`;
  });
  check('abbey representative linear-luminance model drops glare without changing outdoor exposure', () => {
    // A bounded illustrative mixture, not a rendered screenshot measurement.
    // Weights: bare stone / one shaft / floor patch / two shafts plus patch.
    const weights = [0.4, 0.25, 0.25, 0.1], oldBase = 0.16, tintY = 0.4;
    const base = oldBase * (0.7 * (4.9 * ABBEY_LIGHTING.sun / 1.35) + 0.3 * (0.85 * ABBEY_LIGHTING.ambient / 0.675));
    const oldShaft = tintY * 2.3 * (1 + 1.5 * 0.4) * 0.21, oldPatch = tintY * 1.8 * 0.70;
    const mix = (dst, kind) => dst * (1 - ABBEY_OPTICS[kind].alpha) + tintY * ABBEY_OPTICS[kind].radiance * ABBEY_OPTICS[kind].alpha;
    const oldValues = [oldBase, oldBase + oldShaft, oldBase + oldPatch, oldBase + oldPatch + 2 * oldShaft];
    const newValues = [base, mix(base, 'shaft'), mix(base, 'patch'), mix(mix(mix(base, 'patch'), 'shaft'), 'shaft')];
    const mean = (values) => values.reduce((sum, y, i) => sum + y * weights[i], 0);
    const before = mean(oldValues), after = mean(newValues);
    assert.ok(after < before * 0.4);
    console.log(`  LUMA MODEL before=${before.toFixed(4)}, after=${after.toFixed(4)}, linear reduction=${((1 - after / before) * 100).toFixed(1)}% (illustrative, not GPU measurement)`);
  });
  check('spawn grounded and outside solids', () => {
    assert.ok(Number.isFinite(sy) && sy > 20);
    assert.equal(C.solidAt(sx, sy + 0.5, sz), false);
    const p = { x: sx, z: sz }; C.resolveWalls(p, 0.32, sy, sy + 1.7, 0.5);
    assert.ok(Math.hypot(p.x - sx, p.z - sz) < 0.01);
    return `height=${sy.toFixed(2)}m`;
  });
  const sight = (target, targetY) => {
    let clearance = Infinity;
    // Skip the first 15m: terrain beside the camera is not a distant obstruction.
    const distance = Math.hypot(target.x - sx, target.z - sz);
    for (let d = 15; d < distance - 5; d += 2) {
      const t = d / distance, x = sx + (target.x - sx) * t, z = sz + (target.z - sz) * t;
      clearance = Math.min(clearance, sy + 2.1 + (targetY - sy - 2.1) * t - H.heightAt(x, z));
    }
    assert.ok(clearance > 0, `terrain occludes ray by ${(-clearance).toFixed(2)}m`);
    assert.ok(distance < 1050, 'landmark must remain inside medium fog fade range');
    return `distance=${distance.toFixed(1)}m, min terrain clearance=${clearance.toFixed(2)}m`;
  };
  check('palace main spire skyline from spawn', () => sight(PALACE, H.heightAt(PALACE.x, PALACE.z) + PALACE.spire));
  check('palace great hall visible from spawn', () => sight(L.CITY, H.heightAt(L.CITY.x, L.CITY.z) + 32));
  check('abbey spire skyline from spawn', () => sight(L.ABBEY, L.ABBEY.floor + L.ABBEY.tower));
  check('noncircular city wall and gate consistency', () => {
    const radii = L.cityWallPolygon.map(([x, z]) => Math.hypot(x - L.CITY.x, z - L.CITY.z));
    const mean = radii.reduce((a, b) => a + b) / radii.length;
    const cv = Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length) / mean;
    assert.ok(cv >= 0.2);
    for (const g of [L.SOUTH_GATE, L.EAST_GATE]) assert.ok(Math.abs(L.cityEdgeDistance(g.x, g.z)) < 0.01);
    return `${radii.length} vertices, radius CV=${cv.toFixed(3)}, min/max=${Math.min(...radii).toFixed(1)}/${Math.max(...radii).toFixed(1)}m`;
  });
  check('curved roads with changing widths', () => {
    let minTurn = Infinity, minVariation = Infinity;
    for (const r of L.ROADS) {
      if (r.bridge) continue; // Surveyed stone bridge deliberately stays straight.
      let turn = 0;
      for (let i = 1; i < r.pts.length - 1; i++) {
        const a = r.pts[i - 1], b = r.pts[i], c = r.pts[i + 1];
        const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
        turn += Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
      }
      const variation = Math.max(...r.widths) - Math.min(...r.widths);
      assert.ok(turn > 0.3, `${r.id} too straight (${turn})`);
      assert.ok(variation > 0.4, `${r.id} has constant width`);
      assert.ok(r.widths.every((w) => w >= 2 && w <= 6));
      minTurn = Math.min(minTurn, turn); minVariation = Math.min(minVariation, variation);
    }
    return `${L.ROADS.length} roads, min total turn=${(minTurn * 180 / Math.PI).toFixed(1)}°, min width span=${minVariation.toFixed(2)}m`;
  });
  check('roads avoid water, except registered bridge/pier', () => {
    const bad = [];
    for (const r of L.ROADS) for (const [x, z] of r.pts) {
      if (r.bridge) continue;
      const supportedPier = r.id === 'lake-road' && Math.hypot(x - L.PIER.x, z - L.PIER.z) < 45;
      if ((supportedPier ? C.surfaceTop(x, z) : H.heightAt(x, z)) < mountain.waterLevelAt(x, z) + 0.3) bad.push(`${r.id}@${x.toFixed(0)},${z.toFixed(0)}`);
    }
    assert.equal(bad.length, 0, bad.slice(0, 20).join('; '));
  });
  check('house foundations dry and streets unobstructed', () => {
    const bad = [];
    for (const { spec: h } of builtHouses) {
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      for (const [u, v] of [[0, 0], [-h.w / 2, -h.d / 2], [h.w / 2, -h.d / 2], [h.w / 2, h.d / 2], [-h.w / 2, h.d / 2]]) {
        const x = h.x + u * c + v * s, z = h.z - u * s + v * c;
        if (H.heightAt(x, z) < mountain.waterLevelAt(x, z) + 0.5 || L.roadClearance(x, z) < -0.5) bad.push(`${h.x.toFixed(0)},${h.z.toFixed(0)}`);
      }
    }
    assert.equal(bad.length, 0, [...new Set(bad)].join('; '));
    return `${builtHouses.length} houses`;
  });
  check('abbey portal to nave to altar is walkable', () => {
    let feet = L.ABBEY.floor;
    for (let z = ABBEY_ENTRY.z + 7; z > L.ABBEY.z - 25; z -= 0.12) {
      const p = { x: L.ABBEY.x, z };
      C.resolveWalls(p, 0.32, feet, feet + 1.7, 0.5);
      assert.ok(Math.hypot(p.x - L.ABBEY.x, p.z - z) < 0.05, `blocked at z=${z.toFixed(1)}`);
      const next = C.supportHeight(p.x, p.z, feet, 0.5);
      assert.ok(Math.abs(next - feet) < 0.5, 'threshold step too high'); feet = next;
    }
    return `entrance (${ABBEY_ENTRY.x},${ABBEY_ENTRY.z}), south-facing, floor ${feet.toFixed(1)}m`;
  });
  check('both transepts connect to the nave through real openings', () => {
    for (const side of [-1, 1]) for (let d = 0; d <= 26; d += 0.12) {
      const x = L.ABBEY.x + d * side, z = L.ABBEY.z - 7.4, p = { x, z };
      C.resolveWalls(p, 0.32, L.ABBEY.floor, L.ABBEY.floor + 1.7, 0.5);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 0.05, `transept blocked at ${x},${z}`);
      assert.ok(Math.abs(C.supportHeight(x, z, L.ABBEY.floor, 0.5) - L.ABBEY.floor) < 0.1);
    }
  });
  check('spawn to abbey pilgrimage is a continuous dry collision-free walking route', () => {
    const get = (id) => L.ROADS.find((r) => r.id === id).pts;
    const villagePath = get('village-city'), join = villagePath.findIndex(([x, z]) => Math.hypot(x - 18, z + 330) < 0.1);
    assert.ok(join >= 0, 'missing northern bridge-road junction');
    const route = [[sx, sz], ...get('start-village'), ...get('river-bridge'), ...villagePath.slice(0, join + 1),
      ...get('abbey-pilgrimage'), [L.ABBEY.x, L.ABBEY.entranceZ]];
    let feet = sy, length = 0, maxGrade = 0, minDry = Infinity;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.001) continue;
      const steps = Math.ceil(len / 0.15);
      for (let j = 1; j <= steps; j++) {
        const x = a[0] + (b[0] - a[0]) * j / steps, z = a[1] + (b[1] - a[1]) * j / steps;
        const next = C.supportHeight(x, z, feet, 0.5), p = { x, z };
        C.resolveWalls(p, 0.32, next, next + 1.7, 0.5);
        assert.ok(Math.hypot(p.x - x, p.z - z) < 0.03, `route solid at ${x.toFixed(1)},${z.toFixed(1)}`);
        const grade = Math.abs(next - feet) / (len / steps);
        assert.ok(grade < 1.25, `route grade ${grade.toFixed(2)} at ${x.toFixed(1)},${z.toFixed(1)}`);
        const dry = next - mountain.waterLevelAt(x, z); assert.ok(dry > 0.25, `wet route at ${x},${z}`);
        maxGrade = Math.max(maxGrade, grade); minDry = Math.min(minDry, dry); feet = next;
      }
      length += len;
    }
    return `${length.toFixed(0)}m via village stone bridge, max grade=${maxGrade.toFixed(2)}, min dry clearance=${minDry.toFixed(2)}m`;
  });
  check('abbey exterior photo stances are dry and reach the south portal', () => {
    const descriptions = [];
    for (const z of [-420, -444]) {
      const x = L.ABBEY.x, floor = H.heightAt(x, z), level = mountain.waterLevelAt(x, z);
      assert.ok(floor > level + 2 && Math.abs(C.surfaceTop(x, z) - floor) < 0.1);
      assert.ok(!C.solidAt(x, floor + 0.8, z));
      let feet = floor;
      for (let t = z; t > L.ABBEY.entranceZ; t -= 0.15) {
        const p = { x, z: t }, next = C.supportHeight(x, t, feet, 0.5);
        C.resolveWalls(p, 0.32, next, next + 1.7, 0.5);
        assert.ok(Math.hypot(p.x - x, p.z - t) < 0.03 && Math.abs(next - feet) < 0.2); feet = next;
      }
      descriptions.push(`(${x},${z}) Y=${floor.toFixed(2)}m > water=${level}m`);
    }
    return descriptions.join('; ') + '; face north (-Z), camyaw=0';
  });
  check('lake road shore gangway joins the pier with dry support', () => {
    const x = L.PIER.x + 18, deckZ = L.PIER.z;
    const route = [[x, deckZ + 29], [x, deckZ], [L.PIER.x, deckZ]];
    let feet = H.heightAt(...route[0]);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
      for (let j = 0; j <= steps; j++) {
        const px = a[0] + (b[0] - a[0]) * j / steps, pz = a[1] + (b[1] - a[1]) * j / steps;
        const next = C.supportHeight(px, pz, feet, 0.5), p = { x: px, z: pz };
        C.resolveWalls(p, 0.32, next, next + 1.7, 0.5);
        assert.ok(next > mountain.waterLevelAt(px, pz) + 0.3 && Math.abs(next - feet) < 0.5);
        assert.ok(Math.hypot(p.x - px, p.z - pz) < 0.03); feet = next;
      }
    }
  });
  // Sample the actual generated wrap-stair ramps through all corners, using the
  // same support/push rules as the player instead of inspecting decorative steps.
  const stair = (x, z, half, rot, y0, y1, flights, width) => {
    let feet = y0;
    for (let i = 0; i < flights; i++) {
      const a = rot + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), out = half + width / 2;
      const ya = y0 + (y1 - y0) * i / flights, yb = y0 + (y1 - y0) * (i + 1) / flights;
      for (let u = -half + (i === 0 ? 0.7 : 0); u <= half + 0.001; u += 0.1) {
        const px = x + u * c + out * s, pz = z - u * s + out * c;
        const expected = ya + (u + half) / (2 * half) * (yb - ya);
        const p = { x: px, z: pz };
        C.resolveWalls(p, 0.28, expected, expected + 1.7, 0.5);
        assert.ok(Math.hypot(p.x - px, p.z - pz) < 0.05, `stair flight ${i} u=${u.toFixed(1)} blocked`);
        feet = C.supportHeight(px, pz, expected, 0.5);
        assert.ok(Math.abs(feet - expected) < 0.25, `stair lacks support at ${px},${pz}`);
      }
    }
    return feet;
  };
  check('palace keep stairs reachable on all four flights', () => stair(PALACE.x, PALACE.z, PALACE.half, 0,
    H.heightAt(PALACE.x, PALACE.z), H.heightAt(PALACE.x, PALACE.z) + PALACE.terrace, 4, 3.4).toFixed(1) + 'm');
  check('old watchtower stairs retained', () => stair(L.WATCHTOWER.x, L.WATCHTOWER.z, 3.6, 0.4,
    H.heightAt(L.WATCHTOWER.x, L.WATCHTOWER.z) - 0.2, H.heightAt(L.WATCHTOWER.x, L.WATCHTOWER.z) + 15, 4, 2.4).toFixed(1) + 'm');
  const { shared } = await server.ssrLoadModule('/src/render/uniforms.ts');
  const { Player } = await server.ssrLoadModule('/src/player/controller.ts');
  check('actual player takes off from spawn during aligned gust', () => {
    const p = Object.assign(Object.create(Player.prototype), {
      pos: new THREE.Vector3(sx, sy, sz), vel: new THREE.Vector3(), yaw: Math.PI, mode: 'ground',
      coyote: 0, landTimer: 0, glideLock: 0, glideSpeed: 0, glideTime: 0, turn: 0, dive: 0, lift: 0,
      normal: new THREE.Vector3(), state: { wind: new THREE.Vector3() },
      character: { root: new THREE.Object3D(), update() {} }, onJump() {}, onLand() {}, onGlide() {}, onSplash() {},
    });
    const dir = new THREE.Vector2(0.12, -1).normalize();
    const wind = { gust: 1, dir, velocity: new THREE.Vector3(dir.x * 8, 0, dir.y * 8) };
    let started = false;
    for (let frame = 0; frame < 300; frame++) {
      p.update(1 / 60, frame / 60, { moveX: 0, moveY: 1, run: true, takeJump: () => frame === 90 },
        -Math.atan2(dir.x, -dir.y), wind);
      if (p.mode === 'glide') { started = true; break; }
    }
    assert.ok(started, `mode=${p.mode}, pos=${p.pos.toArray()}`);
    return `clearance=${p.clearance.toFixed(2)}m, alignment=${p.alignment.toFixed(3)}`;
  });
  check('stone bridge banks and crown can be crossed on foot', () => {
    let feet = H.heightAt(L.BRIDGE.x, L.BRIDGE.z + L.BRIDGE.length / 2 + 8);
    for (let z = L.BRIDGE.z + L.BRIDGE.length / 2 + 8; z >= L.BRIDGE.z - L.BRIDGE.length / 2 - 8; z -= 0.1) {
      const p = { x: L.BRIDGE.x, z }, before = { ...p };
      C.resolveWalls(p, 0.32, feet, feet + 1.7, 0.5);
      assert.ok(Math.hypot(p.x - before.x, p.z - before.z) < 0.03, `bridge blocked at ${z}`);
      const next = C.supportHeight(p.x, p.z, feet, 0.5);
      assert.ok(next >= feet - 0.8, `bridge bank drop ${feet - next}`); feet = next;
    }
  });
  check('all non-bridge road centerlines stay walkable and clear of solid walls', () => {
    const blocked = [], steep = [];
    let maxSlope = 0;
    for (const r of L.ROADS) {
      if (r.bridge) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const slope = Math.abs(H.heightAt(...a) - H.heightAt(...b)) / len;
        maxSlope = Math.max(maxSlope, slope); if (slope > 1.25) steep.push(r.id);
        for (let d = 0; d < len; d += 1) {
          const x = a[0] + (b[0] - a[0]) * d / len, z = a[1] + (b[1] - a[1]) * d / len;
          const onBridgeApproach = Math.abs(x - L.BRIDGE.x) < L.BRIDGE.width / 2 && Math.abs(z - L.BRIDGE.z) <= L.BRIDGE.length / 2 + 7;
          const onPierApproach = r.id === 'lake-road' && Math.hypot(x - L.PIER.x, z - L.PIER.z) < 45;
          const feet = onBridgeApproach || onPierApproach ? C.surfaceTop(x, z) : H.heightAt(x, z), p = { x, z };
          C.resolveWalls(p, 0.32, feet, feet + 1.7, 0.5);
          if (Math.hypot(p.x - x, p.z - z) > 0.05) blocked.push(`${r.id}@${x.toFixed(0)},${z.toFixed(0)}`);
        }
      }
    }
    assert.equal(steep.length, 0, `steep: ${[...new Set(steep)]}`);
    assert.equal(blocked.length, 0, [...new Set(blocked)].slice(0, 100).join('; '));
    return `maximum centerline grade=${maxSlope.toFixed(2)}`;
  });
  check('four alpine lakes and local swimming levels', () => {
    for (const l of mountain.ALPINE_LAKES) {
      assert.equal(mountain.waterLevelAt(l.x, l.z), l.level);
      assert.ok(H.heightAt(l.x, l.z) < l.level - 1);
    }
    return mountain.ALPINE_LAKES.map((l) => l.level + 'm').join(', ');
  });
  check('abbey interior details only appear near the player', () => {
    const { interior } = abbey.userData;
    const exterior = abbey.children[0];
    // The callback reads the production shared uniform; no DOM or frame-loop surrogate.
    const callback = exterior.children[0].onBeforeRender;
    assert.equal(interior.visible, false);
    shared.uPlayer.value.set(L.ABBEY.x, L.ABBEY.floor, L.ABBEY.z); callback();
    assert.equal(interior.visible, true);
    shared.uPlayer.value.set(sx, sy, sz); callback(); assert.equal(interior.visible, false);
  });
  check('four stone hamlets have four to eight cottages each', () => {
    const counts = [];
    landmarks.object.traverse((o) => {
      for (const [key, n] of Object.entries(o.userData)) if (key.startsWith('hamlet:')) {
        assert.ok(n >= 4 && n <= 8, `${key} has ${n} houses`); counts.push(n);
      }
    });
    assert.equal(counts.length, 4); return counts.join('/') + ' cottages';
  });
  check('heightmap and road grading are deterministic', () => {
    const before = H.grid().data.slice(); H.buildHeightmap(low ? 8 : 4);
    assert.deepEqual(H.grid().data, before); return `${before.length.toLocaleString()} samples identical`;
  });
  const { wallStairRamps } = await server.ssrLoadModule('/src/world/structures/common.ts');
  check('all curtain-wall stair ramps have support and clear walking width', () => {
    for (const r of wallStairRamps) for (let u = -r.run / 2 + 0.6; u < r.run / 2 - 0.6; u += 0.15) {
      const x = r.x + u * Math.cos(r.theta), z = r.z - u * Math.sin(r.theta);
      const y = r.foot + (u / r.run + 0.5) * (r.head - r.foot), p = { x, z };
      C.resolveWalls(p, 0.28, y, y + 1.7, 0.5);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 0.05, `ramp blocked at ${x},${z}`);
      assert.ok(Math.abs(C.supportHeight(x, z, y, 0.5) - y) < 0.3);
    }
    return `${wallStairRamps.length} ramps`;
  });
  check('all 81 orb centers and bobbing clearance outside solids', () => {
    const orbs = collectOrbPositions();
    assert.equal(orbs.length, 81); assert.equal(new Set(orbs.map((o) => o.id)).size, 81);
    for (const o of orbs) assert.ok(!C.solidAt(o.x, o.y - 0.2, o.z), `${o.id} buried`);
    return `${orbs.length} orbs`;
  });
  check('world geometry finite, merged and bounded', () => {
    let meshes = 0, details = 0, vertices = 0;
    for (const root of [village.object, landmarks.object, city.object, abbey]) root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++; if (o.userData.structureDetail) details++;
      const p = o.geometry.attributes.position;
      vertices += p.count;
      for (const v of p.array) assert.ok(Number.isFinite(v));
      o.geometry.computeBoundingSphere(); assert.ok(Number.isFinite(o.geometry.boundingSphere.radius));
    });
    assert.ok(meshes - details < 90, 'base architecture must keep original batching budget');
    assert.ok(details < 220, `${details} spatial detail batches exceed budget`);
    return `${meshes - details} base + ${details} detail meshes, ${vertices.toLocaleString()} vertices (includes existing structures)`;
  });
  check('terrain water grass crops scatter and life generate without runtime errors', () => {
    let meshes = 0, instances = 0;
    for (const root of [terrain, water, grass, crops, scatter.object, life.object]) root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
      if (o.isInstancedMesh) {
        instances += o.count;
        for (const v of o.instanceMatrix.array) assert.ok(Number.isFinite(v));
      }
    });
    return `${meshes} meshes (existing regional LOD included), ${instances.toLocaleString()} instances`;
  });
  check('three tree LOD distances and continuous complementary coverage', () => {
    const { TREE_LOD, treeLodWeights } = scatterModule;
    assert.deepEqual(TREE_LOD, { near: 40, far: 160, nearFade: 8, farFade: 20 });
    for (const [distance, expected] of [[0, [1,0,0]], [36, [1,0,0]], [40, [.5,.5,0]], [44, [0,1,0]], [120, [0,1,0]], [160, [0,.5,.5]], [170, [0,0,1]], [1000, [0,0,1]]]) {
      assert.deepEqual(treeLodWeights(distance), expected);
      assert.deepEqual(treeLodWeights(distance, true), [0,0,1]);
    }
    let previous = treeLodWeights(0);
    for (let d = 0.05; d <= 220; d += 0.05) {
      const w = treeLodWeights(d);
      assert.ok(Math.abs(w.reduce((a,b) => a+b, 0) - 1) < 1e-12);
      assert.ok(w.every((v,i) => v >= 0 && v <= 1 && Math.abs(v - previous[i]) < 0.01), `jump at ${d}`);
      previous = w;
    }
    return '36–44m / 150–170m opaque dither bands; no uncovered pixels';
  });
  check('actual great-tree instances cross both LOD bands without duplication or buffer growth', () => {
    const meshes = scatter.object.children;
    assert.ok(meshes.every(m => m.isInstancedMesh));
    const buffers = meshes.map(m => [m.instanceMatrix.array, m.geometry.attributes.aLodBand.array, m.instanceColor.array, m.boundingSphere]);
    const x = sx - 9, z = sz - 3, y = H.heightAt(x,z) - 0.25 * 2.6;
    let exercised = 0;
    for (const distance of [10,36,40,44,100,150,160,170,210,40,10]) {
      scatter.update(new THREE.Vector3(x + distance, y, z));
      const actual = [];
      for (const m of meshes) {
        assert.ok(m.count <= m.instanceMatrix.count);
        const band = m.geometry.attributes.aLodBand;
        for (let i = 0; i < m.count; i++) {
          const start = band.getX(i), end = band.getY(i);
          assert.ok(start >= 0 && end <= 1.000001 && start < end);
          const offset = i * 16;
          if (m.userData.species === 'great' && !m.userData.leafCards && Math.abs(m.instanceMatrix.array[offset+12]-x) < 0.01 && Math.abs(m.instanceMatrix.array[offset+14]-z) < 0.01) {
            actual.push([m.userData.treeTier, start, end]);
          }
        }
      }
      const weights = scatterModule.treeLodWeights(distance, low);
      const expected = weights.map((w,i) => [i,w]).filter(([,w]) => w > 0);
      assert.deepEqual(actual.map(([i]) => i).sort(), expected.map(([i]) => i));
      assert.ok(Math.abs(actual.reduce((sum, [,a,b]) => sum+b-a,0)-1) < 1e-6);
      assert.equal(new Set(actual.map(([tier])=>tier)).size, actual.length);
      for(const [tier,a,b] of actual) assert.ok(Math.abs(b-a-weights[tier]) < 1e-6);
      exercised++;
    }
    meshes.forEach((m,i) => {
      assert.equal(m.instanceMatrix.array, buffers[i][0]);
      assert.equal(m.geometry.attributes.aLodBand.array, buffers[i][1]);
      assert.equal(m.instanceColor.array, buffers[i][2]);
      assert.equal(m.boundingSphere, buffers[i][3]);
      if (m.userData.treeTier === 2) assert.ok(!m.geometry.attributes.aCard, 'far shell contains leaf cards');
    });
    const species = scatter.object.userData.species;
    assert.equal(species.great.placed, 3);
    for (const name of ['oak','great','blossom','cypress','pine','bush']) {
      const s = species[name];
      if (low) { assert.deepEqual(s.cards,[0,0,0]); assert.ok(meshes.filter(m=>m.userData.species===name).every(m=>m.userData.treeTier===2)); }
      else { assert.ok(s.cards[0] > s.cards[1] && s.cards[1] > 0); assert.ok(s.triangles[0] > s.triangles[1] && s.triangles[1] > s.triangles[2]); }
    }
    scatter.update(new THREE.Vector3(sx,sy+2.5,sz));
    return `${exercised} actual camera positions; ${scatter.stats().total} deterministic scatter objects; low=${low}`;
  });
  check('natural rubble, bevelled masonry and open window reveals are real geometry', () => {
    const before = collisionDigest(C.inspectColliders());
    const rock = () => { const b = new B.Builder(); const geo=b.rock(0,0,0,1.7,0.95,1.15,0,0xbdb7a8,31,3); b.build(); return geo; };
    const a = rock(), b = rock(), p = a.attributes.position;
    assert.deepEqual(p.array,b.attributes.position.array);
    const shape = a.userData.fracturedRock;
    assert.ok(shape.profile==='rubble' && shape.corners>=8 && shape.corners<=24);
    assert.ok(low ? shape.bevel===0 : shape.bevel>0.02);
    assert.ok(low ? p.count/3<=24 : detail===2 ? p.count/3>80 : p.count/3>24);
    const shader = {vertexShader:THREE.ShaderLib.toon.vertexShader,fragmentShader:THREE.ShaderLib.toon.fragmentShader,uniforms:{}};
    const material = (()=>{const b=new B.Builder();b.rock(0,0,0,1,1,1,0,0xbdb7a8,31);return b.build().children[0].material;})();
    material.onBeforeCompile(shader,{});
    assert.ok(!shader.fragmentShader.includes('texture2D(uTex'), 'loose rock still receives brick projection');
    assert.ok(new Set(Array.from({length:p.count},(_,i)=>p.getY(i).toFixed(4))).size > 5, 'rock still a box');
    a.computeBoundingBox();
    assert.ok(a.boundingBox.max.x < 1.7 * 0.5 && a.boundingBox.min.x > -1.7 * 0.5);
    assert.ok(a.boundingBox.max.y <= 0.95 && a.boundingBox.min.y > -0.1);
    const block = new B.Builder(); block.block(0,0,0,1.7,0.95,1.15,0,0xbdb7a8);
    const bevel = block.build().children[0].geometry;
    assert.ok(bevel.attributes.position.count/3 > 12);
    assert.ok(Array.from(bevel.attributes.normal.array).some(v=>Math.abs(v)>0.1 && Math.abs(v)<0.95));
    const window = new B.Builder(); window.windowSurround(0,0,0,1,1.25,0.1,0.18,0,0x5b4332);
    const frame = window.build(); frame.updateMatrixWorld(true);
    assert.equal(new THREE.Raycaster(new THREE.Vector3(0,.625,1),new THREE.Vector3(0,0,-1)).intersectObject(frame,true).length,0,'frame fills its aperture');
    assert.ok(new THREE.Raycaster(new THREE.Vector3(.46,.625,1),new THREE.Vector3(0,0,-1)).intersectObject(frame,true).length>0);
    assert.equal(collisionDigest(C.inspectColliders()),before,'decorative builders registered collisions');
    return `${p.count/3} rock / ${bevel.attributes.position.count/3} bevel / 24 reveal triangles; seeded geometry identical`;
  });
  check('natural rock hull silhouettes reject axis-aligned boxes across seeds', () => {
    const stats=[];
    for(let seed=0;seed<20;seed++) {
      const builder=new B.Builder(),g=builder.rock(0,0,0,1.7,.95,1.15,0,0xbdb7a8,seed,3);
      const p=g.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3();
      let total=0,axial=0,volume=0;
      for(let i=0;i<p.count;i+=3) {
        a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
        volume+=a.dot(cross.crossVectors(b,c))/6;
        cross.subVectors(b,a).cross(c.clone().sub(a));const area=cross.length()/2;cross.normalize();
        total+=area;if(Math.max(Math.abs(cross.x),Math.abs(cross.y),Math.abs(cross.z))>.98)axial+=area;
      }
      g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3()),fill=Math.abs(volume)/(size.x*size.y*size.z);
      assert.ok(axial/total<.45,`seed ${seed}: box-aligned area ${axial/total}`);
      assert.ok(fill>.25 && fill<.72,`seed ${seed}: box-volume fill ${fill}`);
      stats.push({seed,axisArea:axial/total,fill});
    }
    if(process.env.DETAIL_METRICS)writeFileSync(process.env.DETAIL_METRICS.replace('after-','rock-silhouettes-'),JSON.stringify(stats,null,2));
    return `20 seeds; max axis-aligned area ${(Math.max(...stats.map(s=>s.axisArea))*100).toFixed(1)}%`;
  });
  check('architecture detail batches, low fallback and distance culling', () => {
    const counters = detailModule.detailCounters;
    assert.equal(counters.rubble,low?22:60);
    const detailMeshes = [];
    for(const root of [village.object,landmarks.object,city.object,abbey]) root.traverse(o=>{if(o.userData.structureDetail) detailMeshes.push(o);});
    if(low) {
      assert.equal(detailMeshes.length,0);
      for(const key of ['dryCourses','wallBlocks','archStones','towerBands','houseFacades','roofCourses','palaceWindows','palaceReveals','palaceBlocks','palaceMerlons']) assert.equal(counters[key],0,`low generated ${key}`);
    } else {
      assert.ok(counters.dryCourses>300 && counters.wallBlocks>7000);
      assert.equal(counters.archStones,45);
      assert.ok(counters.towerBands>120 && counters.palaceWindows>80);
      assert.equal(counters.houseFacades,builtHouses.length);
      assert.ok(counters.roofCourses>5000 && detailMeshes.length>20 && detailMeshes.length<220);
      {const cm=city.object.children.filter(m=>m.userData.structureDetail);assert.ok(cm.length>0&&cm.length<=8);assert.equal(new Set(cm.map(m=>m.material)).size,cm.length,'city detail not merged by material (batchSettlementDetails)');}
      detailModule.updateStructureDetails(new THREE.Vector3(10000,10000,10000));
      assert.ok(detailMeshes.every(m=>!m.visible));
      assert.ok(detailMeshes.every(m=>m.userData.detailRange === (detail === 2 ? 320 : 120)));
      const m = detailMeshes[0]; detailModule.updateStructureDetails(m.geometry.boundingSphere.center);
      assert.ok(m.visible);
      // New relief never closes the south gate below its arch.
      const gate = L.SOUTH_GATE;
      for(const up of [1,2,3]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(gate.x,H.heightAt(gate.x,gate.z)+up,gate.z+6),new THREE.Vector3(0,0,-1),0,12);
        assert.equal(ray.intersectObjects(city.object.children.filter(m=>m.userData.structureDetail),false).length,0,`detail blocks gate at ${up}m`);
      }
    }
    detailModule.updateStructureDetails(new THREE.Vector3(sx,sy+2.5,sz));
    return `${detailMeshes.length} spatial batches; ${JSON.stringify(counters)}`;
  });
  const rockData = await server.ssrLoadModule('/src/world/rock-geometry.ts');
  const commonData = await server.ssrLoadModule('/src/world/structures/common.ts');
  const palaceData = await server.ssrLoadModule('/src/world/structures/palace.ts');
  const landmarkData = await server.ssrLoadModule('/src/world/structures/landmarks.ts');
  check('fractured rubble contacts, readable dry-wall courses, and actual recessed keep windows', () => {
    const rocks = rockData;
    assert.ok(rocks.rockContacts.length>=22);
    const buried=rocks.rockContacts.filter(c=>c.burialFraction!==undefined);
    assert.equal(buried.length,13);
    assert.ok(buried.every(c=>c.burialFraction>=.1 && c.burialFraction<=.3));
    const span=landmarkData.startRubbleSizes;
    assert.equal(span.length,22);
    assert.ok(Math.max(...span)/Math.min(...span)>=3 && Math.max(...span)/Math.min(...span)<=5);
    assert.ok(rocks.rockContacts.every(c=>Number.isFinite(c.clearance) && Math.abs(c.clearance)<0.001));
    const wall = commonData.dryWallSections;
    const recesses = palaceData.keepWindowRecesses;
    if(low) { assert.equal(wall.length,0); assert.equal(recesses.length,0); }
    else {
      assert.ok(wall.length>100);
      const heights = wall.map(w=>w.top-w.ground);
      assert.ok(Math.min(...heights)>1.0, `wall below grass: min ${Math.min(...heights)}`);
      assert.ok(heights.every(h=>h<2.1), `excessively tall wall: ${Math.max(...heights)}`);
      assert.equal(recesses.length,57);
      assert.equal(detailModule.detailCounters.palaceReveals,57);
      assert.ok(detailModule.detailCounters.palaceBlocks>2500 && detailModule.detailCounters.palaceMerlons>=108);
      city.object.updateMatrixWorld(true);
      const crown=detail===2?20:12, radius=6.5, top=H.heightAt(PALACE.x,PALACE.z)+PALACE.terrace+35;
      const crownRay=(angle)=>new THREE.Raycaster(new THREE.Vector3(PALACE.x+Math.sin(angle)*(radius+.9),top-.5,PALACE.z+Math.cos(angle)*(radius+.9)),new THREE.Vector3(-Math.sin(angle),0,-Math.cos(angle)),0,2).intersectObject(city.object,true);
      assert.equal(crownRay(Math.PI/crown).length,0,'solid cylinder/roof geometry fills crown gap');
      assert.ok(crownRay(0).length>0,'crenellation merlon missing');
      const window = recesses.find(r=>Math.abs(r.normalZ-1)<0.01 && Math.abs(r.x-L.CITY.x-0.22)<0.01);
      const eye = new THREE.Vector3(window.x+window.normalX*.12,window.y,window.z+window.normalZ*.12);
      const direction = new THREE.Vector3(-window.normalX,0,-window.normalZ);
      const hits = new THREE.Raycaster(eye,direction,0,1.4).intersectObject(city.object,true);
      assert.ok(hits.length>0,'no glass/backing behind window');
      assert.ok(hits[0].distance>window.depth-.08 && hits[0].distance<window.depth+.2,`window is still flush: ${hits[0].distance}`);
      const jamb=new THREE.Vector3(window.x+window.normalZ*(.81-.22)+window.normalX*.12,window.y,window.z-window.normalX*(.81-.22)+window.normalZ*.12);
      const frameHits=new THREE.Raycaster(jamb,direction,0,.5).intersectObject(city.object,true);
      assert.ok(frameHits.length>0 && frameHits[0].distance<.09,'outer stone frame is buried/flush');
      const view=screenshotViews(L,H).find(v=>v.name==='palace'),camera=new THREE.PerspectiveCamera(55,16/9,.1,1800);
      camera.position.fromArray(view.eye);camera.lookAt(...view.target);camera.updateMatrixWorld();
      const p1=jamb.clone().project(camera),p2=jamb.clone().add(new THREE.Vector3(window.normalZ*.3,0,-window.normalX*.3)).project(camera);
      assert.ok(Math.hypot((p2.x-p1.x)*800,(p2.y-p1.y)*450)>4,'frame is too thin at the capture camera');

    }
    return `${rocks.rockContacts.length} seated rocks; ${wall.length} wall sections; ${recesses.length} keep recesses`;
  });
  check('review cameras are outside the near canopy and show actual dry-wall geometry', () => {
    const views = screenshotViews(L,H), near = views.find(v=>v.name==='tree-near');
    scatter.update(new THREE.Vector3(...near.eye));
    const hero = scatter.object.children.find(m=>m.userData.species==='great' && m.userData.treeTier===(low?2:0) && !m.userData.leafCards && m.count>0);
    const matrix = new THREE.Matrix4(); let found = false;
    for(let i=0;i<hero.count;i++) { hero.getMatrixAt(i,matrix); if(Math.abs(matrix.elements[12]+9)<.01 && Math.abs(matrix.elements[14]-97)<.01) {found=true;break;} }
    assert.ok(found);
    const eye = new THREE.Vector3(...near.eye), triangle = new THREE.Triangle(), point = new THREE.Vector3();
    const p = hero.geometry.attributes.position, leaf = hero.geometry.attributes.aLeaf;
    const camera = new THREE.PerspectiveCamera(near.fov,16/9,.1,1800);camera.position.copy(eye);camera.lookAt(...near.target);camera.updateMatrixWorld();
    let distance = Infinity, maxY = -Infinity, minY = Infinity;
    for(let i=0;i<p.count;i+=3) {
      triangle.a.fromBufferAttribute(p,i).applyMatrix4(matrix);triangle.b.fromBufferAttribute(p,i+1).applyMatrix4(matrix);triangle.c.fromBufferAttribute(p,i+2).applyMatrix4(matrix);
      if(leaf.getX(i)>0.5) {triangle.closestPointToPoint(eye,point);distance=Math.min(distance,eye.distanceTo(point));}
      for(const v of [triangle.a,triangle.b,triangle.c]) { point.copy(v).project(camera);maxY=Math.max(maxY,point.y);minY=Math.min(minY,point.y); }
    }
    let leafClearance = distance;
    if(!low) {
      const cards = scatter.object.children.find(m=>m.name===hero.name+'-leaves');
      const p = cards.geometry.attributes.position, index=cards.geometry.index, sizes=cards.geometry.attributes.aCard, corners=cards.geometry.attributes.aCorner;
      const scale = new THREE.Vector3().setFromMatrixScale(matrix).x;
      const vertex = (j,out) => {
        out.fromBufferAttribute(p,j).applyMatrix4(matrix);
        const seed=sizes.getY(j),flutter=Math.sin(12*(2+seed*2.5)+seed*40+out.x),turn=(seed-.5)*2.6+flutter*.03;
        out.applyMatrix4(camera.matrixWorldInverse);
        const cx=corners.getX(j),cy=corners.getY(j),size=sizes.getX(j)*scale;
        out.x+=(cx*Math.cos(turn)-cy*Math.sin(turn))*size;
        out.y+=(cx*Math.sin(turn)+cy*Math.cos(turn))*size;
        return out.applyMatrix4(camera.matrixWorld);
      };
      for(let i=0;i<index.count;i+=3) {
        vertex(index.getX(i),triangle.a);vertex(index.getX(i+1),triangle.b);vertex(index.getX(i+2),triangle.c);
        triangle.closestPointToPoint(eye,point);leafClearance=Math.min(leafClearance,eye.distanceTo(point));
        for(const v of [triangle.a,triangle.b,triangle.c]) {point.copy(v).project(camera);maxY=Math.max(maxY,point.y);minY=Math.min(minY,point.y);}
      }
      assert.ok(leafClearance>=4 && leafClearance<=9,`outside-crown clearance ${leafClearance}`);
    }
    assert.ok(distance>4,`camera too close to crown core: ${distance}`);
    assert.ok(minY>-.98 && maxY<.98,`whole tree clipped: ${minY}/${maxY}; core/leaf clearance=${distance}/${leafClearance}`);
    if(!low) {
      const wall = views.find(v=>v.name==='dry-wall-close');landmarks.object.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(); const camera = new THREE.PerspectiveCamera(55,16/9,.1,100);
      camera.position.fromArray(wall.eye);camera.lookAt(...wall.target);camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(0,0),camera);
      const hits=ray.intersectObject(landmarks.object,true);
      assert.ok(hits.length>0 && hits[0].distance<10,'dry wall absent from frame center');
      assert.ok(hits[0].point.y-H.heightAt(hits[0].point.x,hits[0].point.z)>.8,'wall center is submerged in grass');
    }
    scatter.update(new THREE.Vector3(sx,sy+2.5,sz));
    return `near core/leaf clearance ${distance.toFixed(2)}/${leafClearance.toFixed(2)}m; full-tree vertical NDC ${minY.toFixed(2)}…${maxY.toFixed(2)}`;
  });
  check('new material compile hooks generate color, relief, leaf and shadow sources', () => {
    const materials = new Map();
    for (const root of [village.object,landmarks.object,city.object,scatter.object]) root.traverse(o=>{
      if (o.isMesh && o.material.isMeshToonMaterial) materials.set(o.material,o);
    });
    let lod = 0, relief = 0, detail = 0;
    for(const [mat,mesh] of materials) {
      const shader = { vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader, uniforms: {} };
      mat.onBeforeCompile(shader,{});
      assert.ok(!shader.vertexShader.includes('undefined') && !shader.fragmentShader.includes('undefined'));
      if (shader.vertexShader.includes('attribute vec2 aLodBand')) {
        assert.ok(mesh.geometry.attributes.aLodBand);
        assert.ok(shader.fragmentShader.includes('lodPixel')); lod++;
      }
      if (shader.fragmentShader.includes('float reliefH')) relief++;
      if (shader.fragmentShader.includes('float detailCoverage')) detail++;
    }
    assert.ok(lod>=2);
    if (!low) { assert.ok(relief>=3 && detail>=3); }
    else assert.equal(relief,0);
    const caster = scatter.object.children.find(m=>m.castShadow);
    if(caster) {
      const shader = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms:{} };
      caster.customDepthMaterial.onBeforeCompile(shader,{});
      assert.ok(shader.vertexShader.includes('vLodBand = aLodBand') && shader.fragmentShader.includes('lodPixel'));
    }
    return `${materials.size} shared materials; source hooks execute (GPU shader compilation requires external Chrome)`;
  });
  check('all collider footprints, rotations, undersides and sampled supports match pre-detail baseline', () => {
    const baseline = JSON.parse(readFileSync(new URL(`../scripts/baselines/detail-lod/before-${tier}.json`,import.meta.url),'utf8'));
    assert.equal(C.inspectColliders().length,baseline.colliders);
    assert.equal(collisionDigest(C.inspectColliders()),baseline.collision);
    return `${baseline.colliders} colliders; SHA-256 ${baseline.collision}`;
  });
  const roots = [village.object, landmarks.object, city.object, abbey, terrain, water, grass, crops, life.object];
  const measuredViews = measure(roots, scatter, reviewViews(L, H), low ? 1100 : detail === 2 ? 1800 : 1500, detailModule.updateStructureDetails);
  check('medium draw calls and triangles stay within +30% / 2x at all six review views', () => {
    if (tier !== 'medium') return `measured ${tier}; medium budget checked by default run`;
    const baseline = JSON.parse(readFileSync(new URL('../scripts/baselines/detail-lod/before-medium.json',import.meta.url),'utf8'));
    for(const view of measuredViews) {
      const before = baseline.views.find(v=>v.name===view.name);
      assert.deepEqual(view.eye,before.eye); assert.deepEqual(view.target,before.target);
      assert.ok(view.calls <= before.calls * 1.3, `${view.name}: ${before.calls} → ${view.calls} calls`);
      assert.ok(view.triangles <= before.triangles * 2, `${view.name}: ${before.triangles} → ${view.triangles} triangles`);
    }
    return measuredViews.map(v=>`${v.name} ${v.calls} calls/${v.triangles} tris`).join('; ');
  });
  const shotViews = screenshotViews(L,H);
  const shotMetrics = measure(roots,scatter,shotViews,low?1100:detail===2?1800:1500,detailModule.updateStructureDetails);
  check('medium budget also passes all eight corrected screenshot cameras', () => {
    const reference=JSON.parse(readFileSync(new URL(`../scripts/baselines/detail-lod/camera-baseline-${tier}.json`,import.meta.url),'utf8'));
    assert.equal(reference.collision,collisionDigest(C.inspectColliders()));
    for(const view of shotMetrics) {
      const before=reference.screenshots.find(v=>v.name===view.name);
      assert.deepEqual(view.eye,before.eye);assert.deepEqual(view.target,before.target);assert.equal(view.fov,before.fov);
      if(tier==='medium') {
        assert.ok(view.calls<=before.calls*1.3,`${view.name} exceeds call budget`);
        assert.ok(view.triangles<=before.triangles*2,`${view.name} exceeds triangle budget`);
      }
    }
    const previous=JSON.parse(readFileSync(new URL(`../scripts/baselines/detail-lod/round2/after-${tier}.json`,import.meta.url),'utf8'));
    const species=scatter.object.userData.species;
    for(const [name,s] of Object.entries(species)) {
      assert.equal(s.placed,previous.species[name].placed);
      assert.equal(s.triangles[1],previous.species[name].triangles[1]);
      assert.equal(s.triangles[2],previous.species[name].triangles[2]);
    }
    return 'same-camera original reference; unchanged placement counts and mid/far geometry sizes';
  });
  if (process.env.DETAIL_METRICS) {
    const data = { tier, collision: collisionDigest(C.inspectColliders()), colliders: C.inspectColliders().length, vegetation,
      inventory: roots.map(inventory), scatterInventory: inventory(scatter.object), species: scatter.object.userData.species,
      detailCounts: detailModule.detailCounters, benchmarkViews: measuredViews, views: shotMetrics, screenshots: shotViews };
    writeFileSync(process.env.DETAIL_METRICS, JSON.stringify(data, null, 2));
    console.log('Metrics: ' + process.env.DETAIL_METRICS);
  }
  if (process.argv.includes('--preview')) {
    const colors = (h, water) => h < water ? '#5bafca' : h > 190 ? '#eef3f0' : h > 90 ? '#a5ad99' : h > 50 ? '#779465' : '#a6bd72';
    const chunks = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1024 -1024 2048 2048" width="1300" height="1300"><rect x="-1024" y="-1024" width="2048" height="2048" fill="#5bafca"/>'];
    for (let z = -1024; z < 1024; z += 16) for (let x = -1024; x < 1024; x += 16) chunks.push(`<rect x="${x}" y="${z}" width="16.2" height="16.2" fill="${colors(H.heightAt(x + 8, z + 8), mountain.waterLevelAt(x + 8, z + 8))}"/>`);
    for (const f of L.FIELDS) chunks.push(`<polygon points="${L.fieldPolygon(f).map((p) => p.join(',')).join(' ')}" fill="${{ wheat: '#e7c45b', tilled: '#956c50', cabbage: '#599951', lavender: '#a18fc0' }[f.crop]}"/>`);
    for (const r of L.ROADS) for (let i = 0; i < r.pts.length - 1; i++) chunks.push(`<path d="M${r.pts[i].join(' ')}L${r.pts[i + 1].join(' ')}" fill="none" stroke="${r.kind === 'dirt' ? '#e8c397' : '#dbd5c6'}" stroke-width="${r.widths[i]}" stroke-linecap="round"/>`);
    chunks.push(`<polygon points="${L.cityWallPolygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#56544c" stroke-width="4"/>`);
    for (const { spec: h } of builtHouses) chunks.push(`<rect x="${h.x - h.w / 2}" y="${h.z - h.d / 2}" width="${h.w}" height="${h.d}" fill="#b7603c" transform="rotate(${-h.rot * 180 / Math.PI} ${h.x} ${h.z})"/>`);
    for (const [p, label] of [[L.START, 'START'], [L.CITY, 'PALACE'], [L.ABBEY, 'ABBEY'], [L.LAKE, 'LAKE'], [L.WINDMILL, 'MILL']]) chunks.push(`<circle cx="${p.x}" cy="${p.z}" r="5" fill="#aa3344"/><text x="${p.x + 8}" y="${p.z - 7}" font-size="14">${label}</text>`);
    chunks.push('</svg>'); mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/layout.svg', chunks.join('\n'));
    console.log('Preview: artifacts/layout.svg');
  }
  console.log(`Generation/audit ${(performance.now() - t0).toFixed(0)}ms; ${B.orbSpots.length} registered orb spots`);
} finally { await server.close(); }
console.log(`${failures ? 'FAIL' : 'PASS'}: ${failures} failed checks`);
process.exitCode = failures ? 1 : 0;
