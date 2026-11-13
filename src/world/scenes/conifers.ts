import * as THREE from 'three';
import { Builder, place } from '../build';
import { heightAt, normalAt } from '../heightmap';
import { roadClearance } from '../layout';
import { waterLevelAt, alpineChannel } from '../mountain-layout';
import { seededRandom } from '../noise';
import { builtHouses } from '../structures/house';
import { addRound } from '../colliders';
import { sceneSolids } from './geometry';

/** Independent bank forest; never changes the shared tree scatter or its LODs. */
export function addCanyonConifers(b: Builder, detail: number, count: number): number {
  const rand = seededRandom(14193), normal = new THREE.Vector3(); let planted = 0;
  for (let attempt = 0; planted < count && attempt < count * 35; attempt++) {
    const x = -878 + rand() * 260, z = -813 + rand() * 325;
    const y = heightAt(x, z), channel = alpineChannel(x, z);
    if (channel.distance < 17 || channel.distance > 110 || y < waterLevelAt(x, z) + 4 || y > 205) continue;
    if (roadClearance(x, z) < 7 || normalAt(x, z, normal).y < 0.76 || Math.hypot(x + 600, z + 495) < 72) continue;
    if (builtHouses.some((h) => Math.hypot(h.spec.x - x, h.spec.z - z) < 12)) continue;
    const h = 9 + rand() * 15, radius = h * (0.13 + rand() * 0.045);
    const segments = detail === 2 ? 18 : detail === 1 ? 10 : 7, layers = detail === 2 ? 16 : detail === 1 ? 9 : 5;
    const profile: THREE.Vector2[] = [new THREE.Vector2(0, h * 0.18)];
    for (let k = 0; k < layers; k++) {
      const t = k / layers;
      profile.push(new THREE.Vector2(radius * (1 - t) ** 0.83, h * (0.19 + t * 0.8)),
        new THREE.Vector2(radius * (1 - t) ** 0.83 * 0.48, h * (0.19 + (t + 0.8 / layers) * 0.8)));
    }
    profile.push(new THREE.Vector2(0, h));
    const geo = new THREE.LatheGeometry(profile, segments).toNonIndexed(), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const angle = Math.atan2(p.getZ(i), p.getX(i));
      const serration = 1 + 0.11 * Math.sin(angle * 7 + p.getY(i) * 3);
      p.setXYZ(i, p.getX(i) * serration, p.getY(i), p.getZ(i) * serration);
    }
    geo.computeVertexNormals(); b.add('plain', geo, rand() < 0.5 ? 0x365e4d : 0x466b50, place(x, y - 0.25, z), 0.28);
    b.cyl('wood', x, y - 0.3, z, 0.1, h * 0.025, h * 0.64, 0x746b54, detail === 2 ? 10 : 6);
    addRound(x, z, h * 0.025, y + h * 0.64);
    sceneSolids.push({ kind: 'conifer', x, z, radius: h * 0.025 }); planted++;
  }
  return planted;
}
