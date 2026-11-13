import * as THREE from 'three';
import { Builder } from '../build';
import { heightAt } from '../heightmap';
import { fbm } from '../noise';
import { GLACIER_SPINE } from './plan';
import { ribbon } from './geometry';
import { iceFracture, snowRetention } from './geology';
import { addBox } from '../colliders';

export const alpineSurfaceStats = { rockVertices: 0, snowVertices: 0, steepSnowVertices: 0 };

/** Continuous rock/snow mantle: snow accumulates on shelves and exposes steep faces. */
function addAlpineSurface(b: Builder, detail: number): void {
  alpineSurfaceStats.rockVertices = 0; alpineSurfaceStats.snowVertices = 0; alpineSurfaceStats.steepSnowVertices = 0;
  const step = detail === 2 ? 2 : detail === 1 ? 6 : 12;
  const vertices: number[] = [], normals: number[] = [];
  const at = (x: number, z: number): number[] => [x, heightAt(x, z) + 0.24, z];
  for (let z = -1018; z < -452; z += step) for (let x = -1018; x < -305; x += step) {
    const y = heightAt(x + step / 2, z + step / 2);
    const canyon = x > -855 && x < -635 && z > -820;
    if (z >= -730 && !canyon || y < (canyon ? 25 : 145)) continue;
    if (canyon && y < 145) {
      const ny = 2 / Math.hypot(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1));
      if (ny > 0.78) continue;
    }
    const x1 = Math.min(-304, x + step), z1 = Math.min(-452, z + step);
    const a = at(x, z), c = at(x, z1), d = at(x1, z), e = at(x1, z1);
    vertices.push(...a, ...c, ...d, ...d, ...c, ...e);
  }
  // The physical mantle makes the shared scatter's existing surfaceTop exclusion
  // reject loose pebbles on the snow/rock shell. No scatter code or RNG is changed.
  addBox(-661, -874, 357, 144, 0, (lx, lz) => {
    const h = heightAt(-661 + lx, -874 + lz); return h + (h > 145 ? 0.24 : 0);
  });
  addBox(-745, -636, 110, 184, 0, (lx, lz) => {
    const x = -745 + lx, z = -636 + lz, h = heightAt(x, z);
    const ny = 2 / Math.hypot(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1));
    return h + (h > 25 && ny < 0.78 ? 0.24 : 0);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  // Preserve sharp dihedral ridge normals while avoiding a uniform flat-shaded grid.
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z);
    const normal = new THREE.Vector3(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1)).normalize();
    const face = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
    normal.lerp(face, normal.y < 0.62 ? 0.65 : 0.08).normalize(); normals.push(normal.x, normal.y, normal.z);
    if (!Number.isFinite(h)) throw new Error('Non-finite alpine mantle');
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  b.add('plain', g, 0xffffff);
  const colors = g.attributes.color, rock = new THREE.Color(), snow = new THREE.Color(0xe9f0f1);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = g.attributes.normal.getY(i);
    const strata = fbm(x / 14 + y / 9, z / 17 - y / 31, 3);
    rock.set(0x68788b).multiplyScalar(0.65 + strata * 0.65);
    const cover = snowRetention(x, y, z, ny);
    if (cover < 0.2) alpineSurfaceStats.rockVertices++;
    if (cover > 0.8) alpineSurfaceStats.snowVertices++;
    if (ny < 0.48 && cover > 0.1) alpineSurfaceStats.steepSnowVertices++;
    const tint = rock.lerp(snow, cover);
    colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
}

/** A domed body of ice with recessed, independently surveyed crevasses. */
export function addGlacier(b: Builder, detail: number): void {
  addAlpineSurface(b, detail);
  const curve = new THREE.CatmullRomCurve3(GLACIER_SPINE.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const count = detail === 2 ? 240 : detail === 1 ? 90 : 40;
  const points = curve.getPoints(count);
  const widths = points.map((_, i) => {
    const t = i / count * 5, k = Math.min(4, Math.floor(t));
    return THREE.MathUtils.lerp(GLACIER_SPINE[k][2], GLACIER_SPINE[k + 1][2], t - k);
  });
  const indexed = ribbon(points, widths, detail === 2 ? 64 : detail === 1 ? 18 : 8, (x, z, _t, u) => {
    const dome = (1 - u * u) * (detail === 0 ? 5 : 8.5);
    const fracture = iceFracture(x, z);
    return heightAt(x, z) + 0.4 + dome - fracture.depth * (1 - u * u);
  });
  const g = indexed.toNonIndexed(); indexed.dispose(); b.add('plain', g, 0xd8eef0);
  const p = g.attributes.position, colors = g.attributes.color, tint = new THREE.Color();
  const blue = new THREE.Color(0x377b9f), white = new THREE.Color(0xe3f0ee);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), fracture = iceFracture(x, z);
    const grain = fbm(x / 18 + 11, z / 21, 3);
    tint.copy(white).lerp(blue, Math.min(1, fracture.blue * 0.92 + grain * 0.13));
    colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
}
