import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  H.buildHeightmap(low ? 8 : 4);
  const village = (await server.ssrLoadModule('/src/world/structures/village.ts')).buildVillage(detail);
  const landmarks = (await server.ssrLoadModule('/src/world/structures/landmarks.ts')).buildLandmarks();
  const city = (await server.ssrLoadModule('/src/world/structures/city.ts')).buildCity(detail);
  const abbey = buildAbbey();
  const mountain = await server.ssrLoadModule('/src/world/mountain-layout.ts');
  const texture = H.createHeightTexture(), sun = new THREE.Vector3(0.42, 0.72, 0.55).normalize();
  const terrain = (await server.ssrLoadModule('/src/world/terrain.ts')).createTerrain();
  const water = (await server.ssrLoadModule('/src/world/water.ts')).createWater(texture, sun, 0xc5dfed);
  const grass = (await server.ssrLoadModule('/src/world/grass.ts')).createGrass(1000, 1200, 200, texture);
  const scatter = (await server.ssrLoadModule('/src/world/scatter.ts')).createScatter({ treeDetailRange: 170, propRange: 420 }, sun);
  scatter.update(new THREE.Vector3(L.START.x, 40, L.START.z));
  const life = (await server.ssrLoadModule('/src/world/life.ts')).createLife(village.info, city.info, 7);
  life.update(1 / 60, 0, new THREE.Vector3(L.START.x, 40, L.START.z));
  const crops = (await server.ssrLoadModule('/src/world/structures/village.ts')).buildCrops(0.4, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const { builtHouses } = await server.ssrLoadModule('/src/world/structures/house.ts');
  const { collectOrbPositions } = await server.ssrLoadModule('/src/world/orbs.ts');
  const { x: sx, z: sz } = L.START;
  const sy = H.heightAt(sx, sz);
  const { waterFragmentSample } = await server.ssrLoadModule('/src/world/water.ts');
  const { abbeyGroundMask, abbeyInteriorWeight, createAbbeyLighting, ABBEY_GROUND_MASK_GLSL } = await server.ssrLoadModule('/src/world/abbey-space.ts');
  const { cityPlotsOverlap } = await server.ssrLoadModule('/src/world/structures/city-parcels.ts');
  check('uploaded bathymetry, actual water geometry, fragment depth alpha and blue color', () => {
    assert.ok(texture.version > 0 && texture.source.version > 0, 'height texture was never scheduled for GPU upload');
    const { data, width, height } = texture.image;
    const sampleTexture = (x, z) => {
      const u = x / L.SIZE + 0.5, v = z / L.SIZE + 0.5;
      if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return -22;
      const gx = u * width - 0.5, gz = v * height - 0.5;
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      const at = (i, j) => THREE.DataUtils.fromHalfFloat(data[Math.max(0, Math.min(height - 1, j)) * width + Math.max(0, Math.min(width - 1, i))]);
      return (at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx) * (1 - fz) +
        (at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx) * fz;
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
    return 'half-float upload + sea/lake/river/alpine meshes verified';
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
  check('abbey lighting fades to 45 percent and restores the outdoor lights', () => {
    abbey.traverse((o) => assert.ok(!o.isLight, 'abbey added a real-time light'));
    const sun = new THREE.DirectionalLight(0xfff0cf, 3), ambient = new THREE.HemisphereLight(0xcfe6ff, 0x7fa04a, 1.5);
    const fog = new THREE.Fog(0xcfe4f2, 110, 1500), originalHaze = fog.color.clone(), lighting = createAbbeyLighting(sun, ambient, fog);
    const p = new THREE.Vector3(L.ABBEY.x, L.ABBEY.floor, L.ABBEY.z);
    assert.equal(abbeyInteriorWeight(p), 1); lighting.update(1 / 60, p);
    assert.ok(lighting.weight > 0 && lighting.weight < 0.1, 'abrupt entry lighting');
    for (let i = 0; i < 240; i++) lighting.update(1 / 60, p);
    assert.ok(Math.abs(sun.intensity / 3 - 0.45) < 0.001 && Math.abs(ambient.intensity / 1.5 - 0.45) < 0.001);
    p.set(L.START.x, 38, L.START.z); for (let i = 0; i < 240; i++) lighting.update(1 / 60, p);
    assert.equal(sun.intensity, 3); assert.equal(ambient.intensity, 1.5); assert.ok(fog.color.equals(originalHaze));
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
    let meshes = 0, vertices = 0;
    for (const root of [village.object, landmarks.object, city.object, abbey]) root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const p = o.geometry.attributes.position;
      vertices += p.count;
      for (const v of p.array) assert.ok(Number.isFinite(v));
      o.geometry.computeBoundingSphere(); assert.ok(Number.isFinite(o.geometry.boundingSphere.radius));
    });
    assert.ok(meshes < 90);
    return `${meshes} meshes, ${vertices.toLocaleString()} vertices (includes existing structures)`;
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
