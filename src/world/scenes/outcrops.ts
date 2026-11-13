import * as THREE from 'three';
import { Builder } from '../build';
import { addBox, addRound } from '../colliders';
import { heightAt, normalAt } from '../heightmap';
import { roadClearance } from '../layout';
import { alpineChannel, ALPINE_LAKES, alpineLakeMetric } from '../mountain-layout';
import { fbm, seededRandom } from '../noise';
import { sceneSolids, rockContacts } from './geometry';
import { builtHouses } from '../structures/house';

/** Connected bedrock buttresses with broken bedding planes, not floating facade rocks. */
export function addCanyonOutcrops(b: Builder, detail: number): { buttresses: number; talus: number } {
  const rand = seededRandom(19841), count = detail === 2 ? 58 : detail === 1 ? 18 : 5;
  const normal = new THREE.Vector3(); let buttresses = 0, talus = 0;
  for (let attempt = 0; buttresses < count && attempt < 6000; attempt++) {
    const x = -839 + rand() * 188, z = -815 + rand() * 319, y = heightAt(x, z);
    normalAt(x, z, normal);
    if (y < 25 || y > 200 || normal.y > 0.66 || roadClearance(x, z) < 17) continue;
    if (builtHouses.some((house) => Math.hypot(x - house.spec.x, z - house.spec.z) < 20)) continue;
    if (alpineChannel(x, z).distance < 15 || ALPINE_LAKES.some((l) => alpineLakeMetric(x, z, l) < 1.14)) continue;
    const w = 7 + rand() * 7, depth = 2.5 + rand() * 2;
    const forward = new THREE.Vector2(normal.x, normal.z).normalize(), tangent = new THREE.Vector2(forward.y, -forward.x);
    const rot = Math.atan2(-tangent.y, tangent.x);
    const low = Math.min(y, heightAt(x + forward.x * depth, z + forward.y * depth)) - 4;
    const top = Math.max(y + 5, heightAt(x - forward.x * depth, z - forward.y * depth) + 1);
    const ringCount = Math.max(3, Math.ceil((top - low) / (4.3 + rand() * 2))), positions: number[] = [];
    const ring: THREE.Vector3[][] = [];
    for (let k = 0; k <= ringCount; k++) {
      const t = k / ringCount, ledge = k % 2 ? 0.6 : 1.15, width = w * (0.94 - t * 0.24 + rand() * 0.1);
      const level = low + (top - low) * t;
      const outline = [[-0.5,-0.7],[-0.5,0.6],[-0.35,1],[0.34,1],[0.5,0.56],[0.5,-0.7]];
      ring.push(outline.map(([u,v]) => new THREE.Vector3(x + tangent.x * u * width + forward.x * v * depth * ledge,
        level, z + tangent.y * u * width + forward.y * v * depth * ledge)));
    }
    const tri = (a: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => { positions.push(...a.toArray(), ...c.toArray(), ...d.toArray()); };
    for (let k = 0; k < ringCount; k++) for (let j = 0; j < 6; j++) {
      const j1 = (j + 1) % 6; tri(ring[k][j], ring[k][j1], ring[k + 1][j]); tri(ring[k][j1], ring[k + 1][j1], ring[k + 1][j]);
    }
    for (let j = 1; j < 5; j++) tri(ring[ringCount][0], ring[ringCount][j], ring[ringCount][j+1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
    b.add('plain', g, buttresses % 3 ? 0x76818a : 0x8c8e89, undefined, 0.18);
    addBox(x, z, w * 0.55, depth * 1.15, rot, top);
    sceneSolids.push({ kind: 'bedrock-buttress', x, z, radius: Math.hypot(w * 0.55, depth * 1.15) }); buttresses++;
    // Talus accumulates downhill at the actual toe of each buttress.
    for (let k = 0; k < (detail === 2 ? 8 : detail === 1 ? 4 : 2); k++) {
      const px = x + forward.x * (depth + 4 + rand() * 9) + tangent.x * (rand() - 0.5) * w * 1.4;
      const pz = z + forward.y * (depth + 4 + rand() * 9) + tangent.y * (rand() - 0.5) * w * 1.4;
      const r = 0.5 + rand() * 1.3;
      if (roadClearance(px, pz) < r + 2 || alpineChannel(px, pz).distance < 9 || Math.hypot(px + 600, pz + 495) < 65) continue;
      const geo = new THREE.DodecahedronGeometry(r, detail === 2 ? 1 : 0), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i), v = p.getY(i), w = p.getZ(i);
        const n = 0.84 + fbm(u / r * 2 + px, w / r * 2 + v / r + pz, 2) * 0.3;
        p.setXYZ(i, u * n, v * n, w * n);
      }
      let touch = -Infinity;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) touch = Math.max(touch,
        heightAt(px + p.getX(i), pz + p.getZ(i)) - p.getY(i) * 0.7);
      const cy = touch - r * 0.38;
      geo.scale(1, 0.7, 1).translate(px, cy, pz);
      geo.computeVertexNormals();
      b.add('plain', geo, k % 3 ? 0x858b88 : 0x686f76, undefined, 0.17);
      rockContacts.push({ x: px, z: pz, gap: -r * 0.38 });
      if (r > 1.2) { addRound(px, pz, r, cy + r * 0.7); sceneSolids.push({ kind: 'talus', x: px, z: pz, radius: r }); }
      talus++;
    }
  }
  return { buttresses, talus };
}
