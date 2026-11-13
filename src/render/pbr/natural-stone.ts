import * as THREE from 'three';

export interface NaturalStoneAudit { components: number; vertices: number; triangles: number }
const cache = new WeakMap<THREE.BufferGeometry, NaturalStoneAudit>();

/** Recognize closed icosahedral rock components after Builder merges them with walls.
 * Only material attributes are added. Positions, indices, collision and silhouettes stay intact.
 */
export function classifyNaturalStone(geometry: THREE.BufferGeometry, knownRock = false): NaturalStoneAudit {
  const saved = cache.get(geometry);
  if (saved) return saved;
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const corners = geometry.index?.count ?? position.count, triangles = corners / 3;
  const vertexAt = (corner: number): number => geometry.index ? geometry.index.getX(corner) : corner;
  const parent = Int32Array.from({ length: triangles }, (_, i) => i);
  const root = (id: number): number => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
    return id;
  };
  const representatives = new Int32Array(corners);
  const vertices = new Map<string, number>();
  for (let corner = 0; corner < corners; corner++) {
    const v = vertexAt(corner), triangle = Math.floor(corner / 3);
    const key = `${Math.round(position.getX(v) * 10000)},${Math.round(position.getY(v) * 10000)},${Math.round(position.getZ(v) * 10000)}`;
    const first = vertices.get(key);
    if (first === undefined) { vertices.set(key, corner); representatives[corner] = corner; }
    else { representatives[corner] = first; parent[root(triangle)] = root(Math.floor(first / 3)); }
  }
  const faces = new Uint32Array(triangles), unique = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) faces[root(t)]++;
  for (const corner of vertices.values()) unique[root(Math.floor(corner / 3))]++;
  const candidates = new Map<number, THREE.Box3>();
  for (let t = 0; t < triangles; t++) {
    const subdivision = Math.round(Math.sqrt(faces[t] / 20));
    const icosahedral = subdivision > 0 && faces[t] === 20 * subdivision * subdivision && unique[t] === 10 * subdivision * subdivision + 2;
    if ((knownRock && faces[t] > 0) || icosahedral) candidates.set(t, new THREE.Box3());
  }
  const point = new THREE.Vector3();
  for (const corner of vertices.values()) {
    const box = candidates.get(root(Math.floor(corner / 3)));
    if (box) box.expandByPoint(point.fromBufferAttribute(position, vertexAt(corner)));
  }
  // A bevelled box can have the same Euler counts. Its corners fail the ellipsoid test.
  for (const corner of vertices.values()) {
    const id = root(Math.floor(corner / 3)), box = candidates.get(id);
    if (!box || knownRock) continue;
    const v = vertexAt(corner), cx = (box.min.x + box.max.x) * .5, cy = (box.min.y + box.max.y) * .5, cz = (box.min.z + box.max.z) * .5;
    const radius = Math.hypot((position.getX(v) - cx) / Math.max(.001, (box.max.x - box.min.x) * .5),
      (position.getY(v) - cy) / Math.max(.001, (box.max.y - box.min.y) * .5), (position.getZ(v) - cz) / Math.max(.001, (box.max.z - box.min.z) * .5));
    if (radius < .65 || radius > 1.3) candidates.delete(id);
  }
  const mask = new Uint8Array(position.count), smooth = new Int16Array(position.count * 3);
  const averaged = new Map<number, THREE.Vector3>();
  for (let corner = 0; corner < corners; corner++) {
    if (!candidates.has(root(Math.floor(corner / 3)))) continue;
    const first = representatives[corner], v = vertexAt(corner);
    let n = averaged.get(first);
    if (!n) { n = new THREE.Vector3(); averaged.set(first, n); }
    n.add(point.fromBufferAttribute(normal, v));
  }
  for (const n of averaged.values()) n.normalize();
  for (let corner = 0; corner < corners; corner++) {
    const n = averaged.get(representatives[corner]);
    if (!n) continue;
    const v = vertexAt(corner); mask[v] = 1;
    smooth[v * 3] = Math.round(n.x * 32767); smooth[v * 3 + 1] = Math.round(n.y * 32767); smooth[v * 3 + 2] = Math.round(n.z * 32767);
  }
  geometry.setAttribute('aPbrNatural', new THREE.Uint8BufferAttribute(mask, 1));
  geometry.setAttribute('aPbrNaturalNormal', new THREE.Int16BufferAttribute(smooth, 3, true));
  const audit = { components: candidates.size, vertices: mask.reduce((sum, value) => sum + value, 0), triangles: [...candidates.keys()].reduce((sum, id) => sum + faces[id], 0) };
  geometry.userData.pbrNaturalBounds = [...candidates.values()].map(box => [...box.min.toArray(), ...box.max.toArray()]);
  geometry.userData.pbrNatural = audit; cache.set(geometry, audit);
  return audit;
}
