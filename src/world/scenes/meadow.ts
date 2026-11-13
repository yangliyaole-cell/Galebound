import * as THREE from 'three';
import { Builder, place } from '../build';
import { heightAt, normalAt } from '../heightmap';
import { roadClearance } from '../layout';
import { seededRandom } from '../noise';
import { surfaceTop } from '../colliders';

/** True petals and clustered pea flowers, concentrated in the foreground framing. */
export function addMeadowFlowers(b: Builder, detail: number, count: number): number {
  const rand = seededRandom(383), normal = new THREE.Vector3(); let flowers = 0;
  for (let attempt = 0; flowers < count && attempt < count * 6; attempt++) {
    const x = -79 + rand() * 176, z = 34 + rand() * 78;
    if (Math.hypot(x, z - 100) < 17 || roadClearance(x, z) < 1.5 || normalAt(x, z, normal).y < 0.85) continue;
    const y = heightAt(x, z);
    if (surfaceTop(x, z) > y + 0.1) continue;
    const lupin = rand() < 0.36, h = lupin ? 0.65 + rand() * 0.55 : 0.22 + rand() * 0.36;
    b.cyl('plain', x, y, z, 0.012, 0.019, h, 0x668044, 4);
    if (lupin) {
      const rings = detail === 2 ? 12 : 7;
      for (let k = 0; k < rings; k++) for (let j = 0; j < (detail === 2 ? 5 : 3); j++) {
        const t = k / rings, a = j / (detail === 2 ? 5 : 3) * Math.PI * 2 + k * 0.7, r = 0.105 * (1 - t * 0.74);
        const geo = new THREE.SphereGeometry(0.052 * (1 - t * 0.4), detail === 2 ? 7 : 5, 4).scale(1, 0.8, 1.3);
        b.add('plain', geo, k % 3 ? 0x8573b5 : 0xb5a3d0, place(x + Math.cos(a) * r, y + h * (0.45 + t * 0.55), z + Math.sin(a) * r));
      }
    } else {
      const petals = detail === 2 ? 10 : 7;
      for (let k = 0; k < petals; k++) {
        const a = k / petals * Math.PI * 2;
        const geo = new THREE.SphereGeometry(1, detail === 2 ? 7 : 5, 4).scale(0.045, 0.018, 0.09).rotateY(a);
        b.add('plain', geo, 0xeeeedd, place(x + Math.sin(a) * 0.07, y + h, z + Math.cos(a) * 0.07));
      }
      b.add('plain', new THREE.SphereGeometry(0.045, 6, 4).scale(1, 0.5, 1), 0xe6bc50, place(x, y + h + 0.015, z));
    }
    flowers++;
  }
  return flowers;
}
