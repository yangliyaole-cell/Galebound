import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from '../../render/uniforms';
import { Builder, archedProfile, place } from '../build';
import { addBox, addRound } from '../colliders';
import { createFlags, type FlagSpot } from '../flags';
import { ABBEY } from '../layout';
import { beam } from './common';

const STONE = 0xd4c9b4, WARM = 0xe9dcc0, SLATE = 0x5b708b;
const glassColors = [0xff3256, 0x3884ff, 0xffc348, 0x38dc9a];
export const ABBEY_ENTRY = { x: ABBEY.x, z: ABBEY.entranceZ, facing: '+Z (south)', width: 6.8 };
export const ABBEY_INTERIOR_RANGE = 155;
/** A pointed window shape with its foot at y=0. */
function lancet(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w * 0.65);
  s.quadraticCurveTo(w * 0.42, h - w * 0.2, 0, h);
  s.quadraticCurveTo(-w * 0.42, h - w * 0.2, -w / 2, h - w * 0.65); s.closePath();
  return s;
}

/** A hollow gothic abbey. Exterior and the near-only interior each merge by material. */
export function buildAbbey(): THREE.Group {
  const { x, z, floor: y } = ABBEY;
  const ext = new Builder(), inside = new Builder();
  const flags: FlagSpot[] = [];
  const glass: THREE.BufferGeometry[] = [], light: THREE.BufferGeometry[] = [], patches: THREE.BufferGeometry[] = [];
  const tint = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
    const c = new THREE.Color(color), n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  // A thin floor slab rests on the prepared rock shelf. No collider fills the room.
  ext.box('stone', x, y - 0.3, z, 36, 0.3, 74, 0, STONE);
  addBox(x, z, 18, 37, 0, y);
  // The approach has no abrupt foundation step.
  ext.box('stone', x, y - 0.2, z + 38.5, 7, 0.2, 3, 0, STONE);
  addBox(x, z + 38.5, 3.5, 1.5, 0, y);
  // West/east walls: tall real openings, divided glass panes and vertical stone mullions.
  for (const side of [-1, 1]) {
    const wx = x + side * 18;
    const wall = new THREE.Shape();
    wall.moveTo(-35, y - 0.5); wall.lineTo(35, y - 0.5); wall.lineTo(35, y + 16); wall.lineTo(-35, y + 16); wall.closePath();
    for (let k = -3; k <= 3; k++) {
      const u = k * 9;
      const hole = k === 1 ? lancet(8, 14) : lancet(3.8, 9.2);
      const pts = hole.getPoints(12).map((p) => new THREE.Vector2(p.x + u, p.y + y + (k === 1 ? 0 : 4)));
      wall.holes.push(new THREE.Path(pts));
      const gz = z - u;
      // The local shape XY plane is turned into a north-south wall.
      for (let pane = 0; k !== 1 && pane < 4; pane++) {
        const ph = pane === 3 ? 2.3 : 2.25;
        const shape = pane === 3 ? lancet(3.55, ph) : new THREE.Shape([
          new THREE.Vector2(-1.775, 0), new THREE.Vector2(1.775, 0),
          new THREE.Vector2(1.775, ph), new THREE.Vector2(-1.775, ph),
        ]);
        const geo = new THREE.ShapeGeometry(shape).applyMatrix4(place(wx, y + 4.1 + pane * 2.25, gz, Math.PI / 2));
        glass.push(tint(geo, glassColors[(k + pane + 8) % 4]));
      }
      if (k !== 1) {
        ext.box('stone', wx, y + 4, gz, 0.3, 8.3, 0.17, 0, WARM, 0);
        for (const h of [6.3, 8.55, 10.8]) ext.box('stone', wx, y + h, gz, 0.3, 0.16, 3.9, 0, WARM, 0);
      }
      // Colored shafts slant inward. Two crossing tapered planes keep them legible from the aisle.
      const color = glassColors[(k + 7) % 4];
      const start = new THREE.Vector3(wx - side * 0.4, y + 10, gz);
      const end = new THREE.Vector3(x - side * 3, y + 0.12, gz + 8);
      for (let cross = 0; cross < 2; cross++) {
        const v = cross ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        const vertices = [start.clone().addScaledVector(v, -2.1), start.clone().addScaledVector(v, 2.1),
          end.clone().addScaledVector(v, 7.5), end.clone().addScaledVector(v, -7.5)];
        const g = new THREE.BufferGeometry().setFromPoints(vertices); g.setIndex([0, 1, 2, 0, 2, 3]);
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        light.push(tint(g, color));
      }
      const patch = new THREE.PlaneGeometry(8, 10.5).rotateX(-Math.PI / 2).rotateY(side * 0.35).translate(end.x, y + 0.07, end.z);
      patches.push(tint(patch, color));
      const pewIndex = Math.max(0, Math.min(7, Math.round((25 - (end.z - z)) / 5.1)));
      const seatPatch = new THREE.PlaneGeometry(4.8, 0.95).rotateX(-Math.PI / 2)
        .translate(x + side * 4.8, y + 0.9, z + 25 - pewIndex * 5.1);
      patches.push(tint(seatPatch, color));
      // Each wall pier reaches the floor. Above the glazing only overhead collision is needed.
      const pierZ = gz + 4.5;
      ext.box('stone', wx, y - 1, pierZ, 2.6, 20, 1.8, 0, STONE);
      addBox(wx, pierZ, 1.3, 0.9, 0, y + 19);
      addBox(wx, gz, 0.7, 3.6, 0, y + 16, y + 13.2);
      if (k !== 1) addBox(wx, gz, 0.7, 3.6, 0, y + 4);
      // Flying buttresses spring from separate outer piers to the high nave.
      const bx = x + side * 24;
      ext.box('stone', bx, y - 7, pierZ, 2.4, 22, 2.2, 0, STONE);
      ext.pyramid('roof', bx, y + 15, pierZ, 3, 3, 5, 0, SLATE);
      beam(ext, 'stone', new THREE.Vector3(bx, y + 14, pierZ), new THREE.Vector3(x + side * 10.6, y + 25, pierZ), 1.0, WARM, 1.5);
      addBox(bx, pierZ, 1.2, 1.1, 0, y + 20);
    }
    ext.shape('stone', wall, 1.4, place(wx, 0, z, Math.PI / 2), STONE);
    // Aisle roofs, then the raised clerestory. The nave stays open below its vault.
    ext.roof(x + side * 14, y + 16, z, 8, 72, 4, 0, SLATE, 0.5);
    for (let k = -3; k <= 3; k++) {
      const cz = z + k * 9;
      ext.box('stone', x + side * 10, y + 16, cz + 4.5, 1, 12, 2.8, 0, WARM);
      ext.box('stone', x + side * 10, y + 24.5, cz, 1, 3.5, 6.2, 0, WARM);
      const g = new THREE.ShapeGeometry(lancet(2.4, 6.5)).applyMatrix4(place(x + side * 10, y + 18, cz, Math.PI / 2));
      glass.push(tint(g, glassColors[(k + 8) % 4]));
    }
    for (const h of [14, 16]) ext.box('stone', x + side * 10, y + h, z, 1, 2, 72, 0, WARM);
  }
  ext.roof(x, y + 28, z, 20, 75, 12, 0, SLATE, 1);
  for (const dz of [-37, 37]) {
    // Front/back nave gables, with a true south portal and a rose window cut through the wall.
    const front = archedProfile(-18, 18, y - 0.5, () => y + 28,
      dz > 0 ? [{ x: 0, w: 6.8, crown: y + 8 }] : []);
    const rose = new THREE.Path(); rose.absarc(0, y + 20, 4.2, 0, Math.PI * 2, true); front.holes.push(rose);
    ext.shape('stone', front, 1.6, place(x, 0, z + dz), STONE);
    ext.prism('stone', x, y + 28, z + dz, 20, 1.6, 12, 0, WARM);
    if (dz < 0) addBox(x, z + dz, 18, 0.8, 0, y + 28);
    else {
      for (const side of [-1, 1]) addBox(x + side * 10.7, z + dz, 7.3, 0.8, 0, y + 28);
      addBox(x, z + dz, 3.4, 0.8, 0, y + 28, y + 6.2);
    }
    // Rose sectors are alternating glass colors with radial tracery.
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const g = new THREE.CircleGeometry(4, 3, a, Math.PI / 6).translate(x, y + 20, z + dz);
      glass.push(tint(g, glassColors[k % 4]));
      beam(ext, 'stone', new THREE.Vector3(x, y + 20, z + dz + 0.06),
        new THREE.Vector3(x + Math.cos(a) * 4.1, y + 20 + Math.sin(a) * 4.1, z + dz + 0.06), 0.12, WARM);
    }
    ext.add('stone', new THREE.TorusGeometry(4.22, 0.28, 5, 32), WARM, place(x, y + 20, z + dz));
  }
  // Twin west-front bell towers and a crossing spire dominate the distant cliff.
  for (const [dx, dz, h, r] of [[-14, 29, 56, 4.8], [14, 29, 50, 4.5], [0, -9, 68, 5.2]]) {
    ext.box('stone', x + dx, y + (dx === 0 ? 32 : -3), z + dz, r * 2, h + (dx === 0 ? -32 : 3), r * 2, 0, WARM);
    ext.pyramid('roof', x + dx, y + h, z + dz, r * 2 + 1.5, r * 2 + 1.5, 21, 0, SLATE);
    addBox(x + dx, z + dz, r, r, 0, y + h, dx === 0 ? y + 32 : -Infinity);
    for (const side of [-1, 1]) ext.box('plain', x + dx + side * 1.7, y + h - 10, z + dz + r + 0.02, 1.3, 7, 0.1, 0, 0x354452, 0);
    ext.cyl('wood', x + dx, y + h + 21, z + dz, 0.08, 0.08, 4, 0x594b3c, 5, 0);
    flags.push({ x: x + dx, y: y + h + 24, z: z + dz, color: 0xb84135, size: 1.8 });
  }
  // Transept wings are visibly lower, with open north/south arcades beneath their eaves.
  for (const side of [-1, 1]) {
    const tx = x + side * 21;
    ext.roof(tx, y + 21, z - 9, 18, 19, 8, Math.PI / 2, SLATE);
    ext.box('stone', tx, y - 0.3, z - 9, 22, 0.3, 18, 0, STONE);
    addBox(tx, z - 9, 11, 9, 0, y);
    for (const dz of [-18, 0]) {
      ext.box('stone', tx, y - 1, z + dz, 19, 22, 1.3, 0, STONE);
      addBox(tx, z + dz, 9.5, 0.65, 0, y + 21);
    }
    ext.prism('stone', tx + side * 8, y + 21, z - 9, 18, 1.5, 8, Math.PI / 2, WARM);
    ext.box('stone', tx + side * 8, y - 2, z - 9, 1.5, 23, 19, 0, STONE);
    addBox(tx + side * 8, z - 9, 0.75, 9.5, 0, y + 21);
  }
  // Near-only warm interior: columns, open arcades, ribbed ceiling, pews and altar.
  inside.box('stone', x, y + 0.01, z, 34.5, 0.01, 72, 0, 0x625a50, 0);
  inside.box('cloth', x, y + 0.035, z + 1, 3.1, 0.018, 54, 0, 0x79313a, 0);
  for (const side of [-1, 1]) inside.box('cloth', x + side * 1.49, y + 0.055, z + 1, 0.055, 0.005, 54, 0, 0xb58a4b, 0);
  for (const side of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      const cx = x + side * 9.5, cz = z + k * 9;
      inside.cyl('stone', cx, y, cz, 0.7, 1, 14, WARM, 10, 0.06);
      inside.cyl('stone', cx, y + 13.3, cz, 1.25, 0.75, 0.7, WARM, 10);
      addRound(cx, cz, 0.85, y + 14);
      const rib = new THREE.CatmullRomCurve3([
        new THREE.Vector3(cx, y + 14, cz), new THREE.Vector3(x + side * 7, y + 24, cz), new THREE.Vector3(x, y + 28, cz),
      ]);
      inside.add('stone', new THREE.TubeGeometry(rib, 12, 0.26, 5, false), WARM);
      if (k < 3) inside.shape('stone', archedProfile(-4.5, 4.5, y + 13, () => y + 17, [{ x: 0, w: 7.8, crown: y + 16 }]), 0.8, place(cx, 0, cz + 4.5, Math.PI / 2), WARM);
    }
    for (let k = 0; k < 8; k++) {
      const px = x + side * 4.8, pz = z + 25 - k * 5.1;
      inside.box('wood', px, y + 0.7, pz, 5.6, 0.18, 1, 0, 0x8e6541, 0.04);
      inside.box('wood', px, y + 0.8, pz + 0.45, 5.6, 0.9, 0.12, 0, 0xa77a4c, 0.04);
      for (const dx of [-2.3, 2.3]) inside.box('wood', px + dx, y, pz, 0.18, 0.7, 0.8, 0, 0x6c5039);
      addBox(px, pz, 2.8, 0.52, 0, y + 1.7);
    }
  }
  // An inward-facing ceiling hides the exposed sky between the ribs.
  inside.roof(x, y + 27, z, 20, 72, 6, 0, 0xc4b79d, 0);
  inside.box('stone', x, y, z - 29, 6.5, 1.3, 3, 0, WARM);
  addBox(x, z - 29, 3.25, 1.5, 0, y + 1.3);
  for (const dx of [-2.5, -1.5, 1.5, 2.5]) {
    inside.cyl('plain', x + dx, y + 1.3, z - 29, 0.1, 0.12, 1.4, 0xf4d89e, 7);
    inside.add('plain', new THREE.SphereGeometry(0.15, 6, 5).scale(1, 1.9, 1), 0xffd37c, place(x + dx, y + 2.9, z - 29));
  }
  const exterior = ext.build(false), interior = inside.build(false);
  const glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  exterior.add(new THREE.Mesh(mergeGeometries(glass), glassMat));
  const beams = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.uTime }, vertexColors: true,
    vertexShader: `varying vec2 vUv; varying vec3 vColor; varying vec3 vPos;
      void main(){ vUv=uv; vColor=color; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vColor; varying vec3 vPos;
      void main(){ float edge=pow(max(0.,sin(vUv.x*3.14159)),1.6);
        float grain=sin(vPos.x*2.3+vPos.z*3.7+sin(uTime*.23))*sin(vPos.y*4.1-uTime*.4);
        float dust=pow(max(0.,grain),12.); float fade=(1.-vUv.y)*.20+.11;
        gl_FragColor=vec4(vColor*2.3*(1.+dust*1.5),edge*fade); }`,
  });
  const shafts = new THREE.Mesh(mergeGeometries(light), beams); shafts.renderOrder = 3;
  interior.add(shafts);
  interior.add(new THREE.Mesh(mergeGeometries(patches), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.70, color: new THREE.Color(1.8, 1.8, 1.8), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })));
  interior.visible = false;
  // Culling uses the existing player uniform; no additional frame loop or lights/shadows.
  exterior.children[0].onBeforeRender = () => {
    interior.visible = Math.hypot(shared.uPlayer.value.x - x, shared.uPlayer.value.z - z) < ABBEY_INTERIOR_RANGE;
  };
  const group = new THREE.Group(); group.name = 'Cloudfall Abbey';
  group.add(exterior, interior, createFlags(flags));
  group.userData.interior = interior;
  return group;
}
