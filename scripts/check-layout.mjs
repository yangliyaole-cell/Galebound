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
  H.buildHeightmap(4);
  const village = (await server.ssrLoadModule('/src/world/structures/village.ts')).buildVillage(1);
  const landmarks = (await server.ssrLoadModule('/src/world/structures/landmarks.ts')).buildLandmarks();
  const city = (await server.ssrLoadModule('/src/world/structures/city.ts')).buildCity(1);
  const abbey = buildAbbey();
  const { builtHouses } = await server.ssrLoadModule('/src/world/structures/house.ts');
  const { collectOrbPositions } = await server.ssrLoadModule('/src/world/orbs.ts');
  const { x: sx, z: sz } = L.START;
  const sy = H.heightAt(sx, sz);
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
    assert.ok(cv > 0.09);
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
      if (r.bridge || Math.hypot(x - L.PIER.x, z - L.PIER.z) < 22) continue;
      if (H.heightAt(x, z) < 0.3) bad.push(`${r.id}@${x.toFixed(0)},${z.toFixed(0)}`);
    }
    assert.equal(bad.length, 0, bad.slice(0, 20).join('; '));
  });
  check('house foundations dry and streets unobstructed', () => {
    const bad = [];
    for (const { spec: h } of builtHouses) {
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      for (const [u, v] of [[0, 0], [-h.w / 2, -h.d / 2], [h.w / 2, -h.d / 2], [h.w / 2, h.d / 2], [-h.w / 2, h.d / 2]]) {
        const x = h.x + u * c + v * s, z = h.z - u * s + v * c;
        if (H.heightAt(x, z) < 0.5 || L.roadClearance(x, z) < -0.5) bad.push(`${h.x.toFixed(0)},${h.z.toFixed(0)}`);
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
  if (process.argv.includes('--preview')) {
    const colors = (h) => h < 0 ? '#5bafca' : h > 190 ? '#eef3f0' : h > 90 ? '#a5ad99' : h > 50 ? '#779465' : '#a6bd72';
    const chunks = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1024 -1024 2048 2048" width="1300" height="1300"><rect x="-1024" y="-1024" width="2048" height="2048" fill="#5bafca"/>'];
    for (let z = -1024; z < 1024; z += 8) for (let x = -1024; x < 1024; x += 8) chunks.push(`<rect x="${x}" y="${z}" width="8.2" height="8.2" fill="${colors(H.heightAt(x + 4, z + 4))}"/>`);
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
