import * as THREE from 'three';
import { Builder } from '../build';
import { heightAt } from '../heightmap';
import { fbm } from '../noise';
import { GLACIAL_HORNS, GLACIER_SPINE } from './plan';
import { ribbon } from './geometry';

/** Broad, corrugated ice flow, snow aprons and blue crevasses; no external textures. */
export function addGlacier(b: Builder, detail: number): void {
  const curve = new THREE.CatmullRomCurve3(GLACIER_SPINE.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const count = detail === 2 ? 160 : detail === 1 ? 65 : 40;
  const points = curve.getPoints(count);
  const widths = points.map((_, i) => {
    const t = i / count * (GLACIER_SPINE.length - 1), k = Math.min(GLACIER_SPINE.length - 2, Math.floor(t));
    return THREE.MathUtils.lerp(GLACIER_SPINE[k][2], GLACIER_SPINE[k + 1][2], t - k);
  });
  const g = ribbon(points, widths, detail === 2 ? 32 : detail === 1 ? 12 : 8, (x, z, t, u) =>
    heightAt(x, z) + 0.28 + (1 - u * u) * (1.5 + Math.sin(t * 110) ** 8 * 1.1)).toNonIndexed();
  b.add('plain', g, 0xd6f1f5);
  const p = g.attributes.position, c = g.attributes.color, blue = new THREE.Color(0x6cb4d1), white = new THREE.Color(0xeff8f5), tint = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const fissure = Math.sin(z * 0.59 + Math.sin(x * 0.21) * 3 + fbm(x / 9, z / 9, 2) * 2);
    tint.copy(blue).lerp(white, THREE.MathUtils.smoothstep(fissure, -0.95, 0.35));
    c.setXYZ(i, tint.r, tint.g, tint.b);
  }
  // Real snow surfaces on the upper horns, rather than a line over a green mountain.
  for (const horn of GLACIAL_HORNS) {
    const radius = horn.radius * 0.67, step = detail === 2 ? 4 : detail === 1 ? 9 : 17;
    const pos: number[] = [];
    const vertex = (x: number, z: number): number[] => [x, heightAt(x, z) + 0.18, z];
    for (let z = Math.max(-1018, horn.z - radius); z < horn.z + radius; z += step) {
      for (let x = horn.x - radius; x < horn.x + radius; x += step) {
        if (Math.hypot(x + step / 2 - horn.x, z + step / 2 - horn.z) > radius - step) continue;
        if (heightAt(x, z) < 290 + fbm(x / 19, z / 19, 2) * 90) continue;
        const z1 = z + step;
        pos.push(...vertex(x, z), ...vertex(x, z1), ...vertex(x + step, z),
          ...vertex(x + step, z), ...vertex(x, z1), ...vertex(x + step, z1));
      }
    }
    if (!pos.length) continue;
    const snow = new THREE.BufferGeometry(); snow.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); snow.computeVertexNormals();
    b.add('plain', snow, 0xe7f0f1, undefined, 0.07);
    const colors = snow.attributes.color;
    for (let i = 0; i < colors.count; i++) {
      const ny = snow.attributes.normal.getY(i), shade = THREE.MathUtils.smoothstep(ny, 0.25, 0.85);
      tint.set(0x799bb2).lerp(white, shade);
      colors.setXYZ(i, tint.r, tint.g, tint.b);
    }
  }
}
