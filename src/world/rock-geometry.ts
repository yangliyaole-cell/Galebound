import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { fbm, seededRandom } from './noise';

/** A fractured prism with broad cleavage faces and narrow weathered bevels. */
function wallStoneGeometry(w: number, h: number, d: number, seed: number, tier: number, detail = 1): THREE.BufferGeometry {
  const random = seededRandom(seed * 163 + 701);
  const corners = 5 + Math.floor(random() * 3), phase = random() * 6.28;
  const shape = new THREE.Shape();
  for (let i = 0; i < corners; i++) {
    const angle = phase + (i + (random() - 0.5) * 0.24) * Math.PI * 2 / corners;
    const radius = 0.72 + random() * 0.28;
    const x = Math.cos(angle) * radius * w / 2, z = Math.sin(angle) * radius * d / 2;
    if (i) shape.lineTo(x, -z); else shape.moveTo(x, -z);
  }
  shape.closePath();
  const edge = tier ? Math.min(w, h, d) * (0.045 + random() * 0.025) : 0;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: h - edge * 2, bevelEnabled: tier > 0, bevelSize: edge,
    bevelThickness: edge, bevelSegments: tier > 1 ? 4 : 1, steps: 1,
  }).rotateX(-Math.PI / 2).translate(0, edge, 0);
  const p = geometry.attributes.position;
  const tiltX = (random() - 0.5) * 0.26, tiltZ = (random() - 0.5) * 0.22;
  const shearX = (random() - 0.5) * w * 0.15, shearZ = (random() - 0.5) * d * 0.16;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / h;
    // Planar tilted fracture caps; no equatorial rings or ellipsoid latitude bands.
    const grit = tier > 1 ? (fbm(x * 9 + seed, z * 9 + seed, 2) - 0.5) * 0.012 / Math.max(1, detail) : 0;
    p.setXYZ(i, x + shearX * t, y + tiltX * x + tiltZ * z + grit, z + shearZ * t);
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!, span = box.getSize(new THREE.Vector3());
  // Exact local envelope permits contact packing and keeps the old footprint conservative.
  for (let i = 0; i < p.count; i++) p.setXYZ(i,
    ((p.getX(i) - box.min.x) / span.x - 0.5) * w * 0.98,
    (p.getY(i) - box.min.y) / span.y * h,
    ((p.getZ(i) - box.min.z) / span.z - 0.5) * d * 0.98);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.userData.fracturedRock = { seed, tier, profile: 'wall', bevel: edge, corners, triangles: p.count / 3 };
  return geometry;
}

/** Natural boulders: random 3D hull, individually chamfered faces/edges, no extrusion axis. */
export function fracturedRock(w: number, h: number, d: number, seed: number, tier: number, detail = 1, profile: 'rubble' | 'wall' = 'rubble'): THREE.BufferGeometry {
  if (profile === 'wall') return wallStoneGeometry(w,h,d,seed,tier,detail);
  const random = seededRandom(seed * 163 + 701), points: THREE.Vector3[] = [];
  const count = tier > 1 ? 24 : tier ? 16 : 12;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(random()*6.28,random()*6.28,random()*6.28));
  const shear = new THREE.Vector3((random()-.5)*.4,(random()-.5)*.3,(random()-.5)*.35);
  for(let i=0;i<count;i++) {
    const y=1-2*(i+.5)/count, angle=i*2.399963+random()*.35;
    const ring=Math.sqrt(1-y*y), radius=.68+random()*.45;
    const p=new THREE.Vector3(Math.cos(angle)*ring,y,Math.sin(angle)*ring).applyQuaternion(rotation).multiplyScalar(radius);
    p.x+=shear.x*p.y; p.z+=shear.z*p.y; p.y+=shear.y*p.x;
    points.push(p);
  }
  const hull = new ConvexGeometry(points), hp=hull.attributes.position;
  const vertices: THREE.Vector3[] = [], lookup=new Map<string,number>();
  const vertexId=(p: THREE.Vector3): number => {
    const key=`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    let i=lookup.get(key);if(i===undefined){i=vertices.length;vertices.push(p.clone());lookup.set(key,i);}return i;
  };
  const faces: {ids:number[];inset:THREE.Vector3[];normal:THREE.Vector3}[]=[];
  const bevel=tier ? tier>1 ? .12 : .09 : 0;
  for(let i=0;i<hp.count;i+=3) {
    const tri=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(hp,i+k));
    const centre=tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1/3);
    const normal=new THREE.Vector3().subVectors(tri[1],tri[0]).cross(new THREE.Vector3().subVectors(tri[2],tri[0])).normalize();
    faces.push({ids:tri.map(vertexId),inset:tri.map(p=>p.clone().lerp(centre,bevel)),normal});
  }
  const pos:number[]=[], normals:number[]=[];
  const triangle=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,na:THREE.Vector3,nb=na,nc=na):void=>{
    for(const v of [a,b,c]) pos.push(v.x,v.y,v.z);
    for(const n of [na,nb,nc]) normals.push(n.x,n.y,n.z);
  };
  const edges=new Map<string,{face:number;a:number;b:number}[]>();
  faces.forEach((face,fi)=>{
    const [a,b,c]=face.inset;
    if(tier>1) {
      const centre=a.clone().add(b).add(c).multiplyScalar(1/3).addScaledVector(face.normal,(random()-.5)*.012);
      triangle(a,b,centre,face.normal);triangle(b,c,centre,face.normal);triangle(c,a,centre,face.normal);
    } else triangle(a,b,c,face.normal);
    for(let k=0;k<3;k++) {
      const a=face.ids[k],b=face.ids[(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
      const list=edges.get(key)??[];list.push({face:fi,a:k,b:(k+1)%3});edges.set(key,list);
    }
  });
  if(tier) {
    for(const pair of edges.values()) {
      const [e,f]=pair,A=faces[e.face],B=faces[f.face];
      const a=A.inset[e.a],b=A.inset[e.b],c=B.inset[f.a],d=B.inset[f.b];
      triangle(b,a,d,A.normal,A.normal,B.normal);triangle(b,d,c,A.normal,B.normal,B.normal);
    }
    vertices.forEach((_vertex,vi)=>{
      const incident=faces.filter(f=>f.ids.includes(vi));
      const n=incident.reduce((n,f)=>n.add(f.normal),new THREE.Vector3()).normalize();
      const u=new THREE.Vector3().crossVectors(n,Math.abs(n.y)<.8?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize();
      const v=new THREE.Vector3().crossVectors(n,u);
      const ring=incident.map(f=>({p:f.inset[f.ids.indexOf(vi)],n:f.normal}));
      const centre=ring.reduce((c,r)=>c.add(r.p),new THREE.Vector3()).multiplyScalar(1/ring.length);
      ring.sort((a,b)=>Math.atan2(a.p.clone().sub(centre).dot(v),a.p.clone().sub(centre).dot(u))-Math.atan2(b.p.clone().sub(centre).dot(v),b.p.clone().sub(centre).dot(u)));
      for(let i=0;i<ring.length;i++) {const a=ring[i],b=ring[(i+1)%ring.length];triangle(centre,a.p,b.p,n,a.n,b.n);}
    });
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.computeBoundingBox();
  const box=geometry.boundingBox!,span=box.getSize(new THREE.Vector3()),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++) {
    p.setXYZ(i,((p.getX(i)-box.min.x)/span.x-.5)*w*.98,(p.getY(i)-box.min.y)/span.y*h,((p.getZ(i)-box.min.z)/span.z-.5)*d*.98);
    const normal=new THREE.Vector3(n.getX(i)*span.x/w,n.getY(i)*span.y/h,n.getZ(i)*span.z/d).normalize();n.setXYZ(i,normal.x,normal.y,normal.z);
  }
  geometry.computeBoundingBox();
  geometry.userData.fracturedRock={seed,tier,profile,bevel,corners:vertices.length,triangles:p.count/3};
  return geometry;
}

const ray = new THREE.Ray(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
/** Actual triangle surface, independent of the unchanged gameplay collider. */
export function rockSurfaceAt(geometry: THREE.BufferGeometry, x: number, z: number, top = true): number | undefined {
  const p = geometry.attributes.position;
  ray.origin.set(x, top ? 10000 : -10000, z); ray.direction.set(0, top ? -1 : 1, 0);
  let result: number | undefined;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    if (ray.intersectTriangle(a, b, c, false, hit)) result = result === undefined ? hit.y : top ? Math.max(result, hit.y) : Math.min(result, hit.y);
  }
  return result;
}

export const rockContacts: { x: number; z: number; clearance: number; buried: boolean; burialFraction?: number }[] = [];
/** Seat broad fracture faces against actual supporting rock triangles, with slight burial. */
export function seatRock(geometry: THREE.BufferGeometry, supports: THREE.BufferGeometry[], ground: (x: number, z: number) => number): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!, centre = box.getCenter(new THREE.Vector3());
  const p = geometry.attributes.position;
  let lift = -Infinity, contactX = centre.x, contactZ = centre.z, contactY = 0;
  const seen = new Set<string>();
  const sample = (x: number, z: number): void => {
    const key = `${x.toFixed(4)},${z.toFixed(4)}`; if (seen.has(key)) return; seen.add(key);
    const bottom = rockSurfaceAt(geometry, x, z, false); if (bottom === undefined) return;
    let surface = ground(x, z) - (supports.length ? 0.04 : 0.24);
    for (const support of supports) {
      const y = rockSurfaceAt(support, x, z);
      if (y !== undefined) surface = Math.max(surface, y - 0.035);
    }
    if (surface - bottom > lift) { lift = surface - bottom; contactX = x; contactZ = z; contactY = surface; }
  };
  sample(centre.x, centre.z);
  for (let i = 0; i < p.count; i++) sample(centre.x + (p.getX(i) - centre.x) * 0.92, centre.z + (p.getZ(i) - centre.z) * 0.92);
  let burialFraction: number | undefined;
  if (!supports.length && geometry.userData.fracturedRock?.profile === 'rubble') {
    const height=box.max.y-box.min.y;
    burialFraction=.14+seededRandom(geometry.userData.fracturedRock.seed+992)()*.12;
    lift=ground(centre.x,centre.z)-height*burialFraction-box.min.y;
    contactY=rockSurfaceAt(geometry,contactX,contactZ,false)!+lift;
  }
  geometry.translate(0, lift, 0);
  geometry.computeBoundingBox();
  const bottom = rockSurfaceAt(geometry, contactX, contactZ, false)!;
  rockContacts.push({ x: contactX, z: contactZ, clearance: bottom - contactY, buried: !supports.length, burialFraction });
}
