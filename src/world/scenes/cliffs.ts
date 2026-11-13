import * as THREE from 'three';
import { Builder } from '../build';
import { heightAt } from '../heightmap';
import { CITY, cityRadiusAt, roadClearance } from '../layout';
import { fbm } from '../noise';

/** Outward/upward facing rock skin follows the actual collision terrain, not a flat facade. */
export function addCliffFaces(b: Builder, detail: number): void {
  const p: number[] = [], sections = detail === 2 ? 480 : detail === 1 ? 210 : 90;
  const rings = detail === 2 ? 34 : detail === 1 ? 17 : 8;
  const vertex = (a: number, d: number): number[] => {
    const r = cityRadiusAt(a) + d, x = CITY.x + Math.cos(a) * r, z = CITY.z + Math.sin(a) * r;
    return [x, heightAt(x, z) + 0.2, z];
  };
  for (let k = 0; k < sections; k++) for (let j = 0; j < rings; j++) {
    const a = -0.12 + k / sections * (Math.PI + 0.24), a1 = -0.12 + (k + 1) / sections * (Math.PI + 0.24);
    const d = 5 + j / rings * 57, d1 = 5 + (j + 1) / rings * 57;
    const quad = [vertex(a, d), vertex(a1, d), vertex(a, d1), vertex(a1, d1)];
    if (quad.some(([x, , z]) => roadClearance(x, z) < 5.8)) continue;
    p.push(...quad[0], ...quad[1], ...quad[2], ...quad[2], ...quad[1], ...quad[3]);
  }
  // Western abbey escarpment: avoid the building footprint and the pilgrimage lane.
  const step = detail === 2 ? 1.5 : detail === 1 ? 3 : 6;
  for (let x = -665; x < -635; x += step) for (let z = -533; z < -460; z += step) {
    if (roadClearance(x, z) < 6 || Math.abs(x + 638) < 6 && Math.abs(z + 493) < 9) continue;
    const v = (px: number, pz: number): number[] => [px, heightAt(px, pz) + 0.17, pz];
    p.push(...v(x, z), ...v(x, z + step), ...v(x + step, z), ...v(x + step, z), ...v(x, z + step), ...v(x + step, z + step));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.computeVertexNormals();
  b.add('stone', geo, 0xaaa99b, undefined, 0.14);
  const color = geo.attributes.color, pos = geo.attributes.position, tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const grain = fbm(pos.getX(i) / 11, pos.getZ(i) / 11 + pos.getY(i) * 0.05, 3);
    const strata = 0.88 + 0.12 * Math.sin(pos.getY(i) * 1.4 + grain * 5);
    tint.fromBufferAttribute(color, i).multiplyScalar((0.85 + grain * 0.25) * strata);
    color.setXYZ(i, tint.r, tint.g, tint.b);
  }
}
