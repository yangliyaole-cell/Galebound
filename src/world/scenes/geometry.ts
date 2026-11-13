import * as THREE from 'three';
import { Builder, place } from '../build';
import { addRound } from '../colliders';
import { fbm } from '../noise';

export const sceneSolids: { kind: string; x: number; z: number; radius: number }[] = [];

/** Continuous coordinate displacement keeps shared vertices watertight and smooth. */
export function landscapeRock(b: Builder, x: number, y: number, z: number, radius: number, detail: number, collider = true): void {
  const g = new THREE.IcosahedronGeometry(1, detail === 2 ? 4 : detail === 1 ? 2 : 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const n = 0.91 + fbm(px * 2.3 + x, pz * 2.3 + py * 1.8 + z, 3) * 0.09;
    p.setXYZ(i, px * radius * n, py * radius * 0.78 * n, pz * radius * n);
  }
  g.computeVertexNormals();
  // Analytic radial normals remove the triangulation facets without flattening the form.
  const normal = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const n = new THREE.Vector3(p.getX(i), p.getY(i) / (0.78 * 0.78), p.getZ(i)).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  b.add('stone', g, 0xa3a99c, place(x, y + radius * 0.3, z), 0.18);
  const colors = g.attributes.color, moss = new THREE.Color(0x667d42), stone = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const amount = THREE.MathUtils.smoothstep(normal.getY(i) + (fbm(p.getX(i) + x, p.getZ(i) + z, 2) - 0.5) * 0.8, 0.18, 0.85);
    stone.fromBufferAttribute(colors, i).lerp(moss, amount * 0.82);
    colors.setXYZ(i, stone.r, stone.g, stone.b);
  }
  if (collider) {
    addRound(x, z, radius * 0.95, (lx, lz) => y + radius * 0.3 + radius * 0.78 *
      Math.sqrt(Math.max(0, 0.95 ** 2 - (lx * lx + lz * lz) / (radius * radius))));
    sceneSolids.push({ kind: 'boulder', x, z, radius });
  }
}

/** A terrain-following ribbon with an upward winding, shared by ice and wheel ruts. */
export function ribbon(points: THREE.Vector3[], widths: number[], across: number,
  height: (x: number, z: number, t: number, u: number) => number): THREE.BufferGeometry {
  const p: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
    for (let j = 0; j <= across; j++) {
      const u = j / across * 2 - 1, t = i / (points.length - 1);
      const x = points[i].x - dz / len * widths[i] * u, z = points[i].z + dx / len * widths[i] * u;
      p.push(x, height(x, z, t, u), z); uv.push(j / across, t);
      if (i < points.length - 1 && j < across) {
        const k = i * (across + 1) + j; indices.push(k, k + 1, k + across + 1, k + 1, k + across + 2, k + across + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
