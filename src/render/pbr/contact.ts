import * as THREE from 'three';
import { inspectColliders } from '../../world/colliders';
import { heightAt } from '../../world/heightmap';
import { SIZE } from '../../world/layout';

/** Read-only rasterization of solid footprints. No changes to placement/collision. */
export function createContactTexture(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size), cell = SIZE / size;
  for (const c of inspectColliders()) {
    const ground = heightAt(c.x, c.z);
    // Raised bridges, roofs and thin decorative slabs don't soil the terrain.
    if (c.bottom > ground + .65 || c.top(0, 0) < ground + .6) continue;
    const extent = Math.hypot(c.hx, c.hz) + 4;
    const x0 = Math.max(0, Math.floor((c.x - extent + SIZE / 2) / cell));
    const x1 = Math.min(size - 1, Math.ceil((c.x + extent + SIZE / 2) / cell));
    const z0 = Math.max(0, Math.floor((c.z - extent + SIZE / 2) / cell));
    const z1 = Math.min(size - 1, Math.ceil((c.z + extent + SIZE / 2) / cell));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const dx = (i + .5) * cell - SIZE / 2 - c.x, dz = (j + .5) * cell - SIZE / 2 - c.z;
      const x = dx * c.cos - dz * c.sin, z = dx * c.sin + dz * c.cos;
      const distance = c.round ? Math.max(0, Math.hypot(x, z) - c.hx) : Math.hypot(Math.max(0, Math.abs(x) - c.hx), Math.max(0, Math.abs(z) - c.hz));
      const mask = Math.round(Math.exp(-distance * distance / 3.2) * 255);
      data[j * size + i] = Math.max(data[j * size + i], mask);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
