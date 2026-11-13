import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { poseFor } from '../player/character';
import { HERO_STYLE, REST, applyPose, blendPose, buildRig, type Pose, type Rig, type RigStyle } from '../player/rig';
import { toon } from '../render/toon';
import { shared } from '../render/uniforms';
import { resolveWalls, supportHeight } from './colliders';
import { heightAt } from './heightmap';
import { BRIDGE, CITY, CITY_STREETS, SOUTH_GATE, FIELDS, LAKE, LIGHTHOUSE, PIER, START, WINDMILL } from './layout';
import { seededRandom } from './noise';
import type { CityInfo } from './structures/city';
import type { BuiltHouse } from './structures/house';
import type { VillageInfo } from './structures/village';

const TOPS = [0xc7d3bb, 0xd8ad88, 0x8ea6c6, 0xc7866a, 0xe7dbbf, 0x98ae78, 0xb58da6, 0xd9c27a];
const LEGS = [0x5a4a3c, 0x4a5568, 0x6a5a48, 0x3f4a44];
const HAIRS = [0x3a2a22, 0x6b4a2e, 0x8a6a3c, 0xb9a077, 0x9c9c9c, 0x241c1a];
const SKINS = [0xf2cfb2, 0xe8bf9c, 0xd9a882, 0xf6dcc4];

function villagerStyle(rand: () => number, kind: 'any' | 'farmer' | 'guard' = 'any'): RigStyle {
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const woman = kind === 'any' && rand() < 0.5;
  const style: RigStyle = {
    ...HERO_STYLE,
    skin: pick(SKINS),
    hair: pick(HAIRS),
    top: pick(TOPS),
    trim: 0x8a6a48,
    trousers: pick(LEGS),
    boots: 0x4a3a2c,
    leather: 0x6a4c34,
    scarf: rand() < 0.3 ? pick([0xb5523f, 0x4f7f8a, 0xd0a040]) : null,
    mantle: null,
    hairStyle: woman ? (rand() < 0.5 ? 'bun' : 'long') : rand() < 0.2 ? 'bald' : 'spiky',
    hat: 'none',
    dress: woman ? pick([0x7f9a6c, 0xa86a5a, 0x6c86a8, 0xb89a5c, 0x8a6a8c]) : null,
    apron: woman && rand() < 0.6 ? 0xf1e9d6 : null,
    scale: 0.92 + rand() * 0.1,
    build: 0.95 + rand() * 0.16,
    eye: 0x2a1d1a,
  };
  if (kind === 'farmer') style.hat = 'straw';
  if (kind === 'guard') {
    style.top = 0x4f6f96;
    style.trousers = 0x3a4250;
    style.hat = 'cap';
    style.trim = 0xb9b9c4;
    style.mantle = 0x3f5a7c;
    style.hairStyle = 'bald';
  }
  return style;
}

const plain = toon(0xffffff, { vertexColors: true, plain: true });

function stick(length: number, radius: number, color: number, head?: THREE.BufferGeometry, headColor = 0x8a8a92): THREE.Mesh {
  const paint = (g: THREE.BufferGeometry, c: number): THREE.BufferGeometry => {
    g.deleteAttribute('uv');
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const parts = [paint(new THREE.CylinderGeometry(radius, radius, length, 6), color)];
  if (head) parts.push(paint(head, headColor));
  const mesh = new THREE.Mesh(mergeGeometries(parts), plain);
  mesh.castShadow = true;
  return mesh;
}

type PoseFn = (time: number) => Pose;

const sit = (time: number): Pose => ({
  ...REST,
  bodyY: -0.44, legLX: -1.5, legRX: -1.5, kneeL: 1.5, kneeR: 1.5,
  spineX: 0.06, headY: Math.sin(time * 0.3) * 0.4, armLX: -0.5, armRX: -0.5, elbowL: -0.7, elbowR: -0.7,
});

/** Someone standing in one place, busy with something. */
interface Actor {
  rig: Rig;
  pose: Pose;
  fn: PoseFn;
}

interface Target {
  x: number;
  z: number;
  /** Seconds to linger on arrival. */
  wait: number;
  home?: BuiltHouse;
}

interface Walker {
  rig: Rig;
  pose: Pose;
  pos: THREE.Vector3;
  yaw: number;
  phase: number;
  targets: Target[];
  index: number;
  state: 'walk' | 'wait' | 'enter' | 'inside' | 'leave';
  timer: number;
  stuck: number;
  door: THREE.Object3D | null;
}

interface Sheep {
  root: THREE.Group;
  head: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  timer: number;
  grazing: boolean;
}

function sheepGeometry(): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const paint = (g: THREE.BufferGeometry, c: number): THREE.BufferGeometry => {
    g.deleteAttribute('uv');
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const wool = 0xf4efe2;
  const dark = 0x3a332e;
  const body = [
    paint(new THREE.SphereGeometry(0.42, 10, 8).scale(0.9, 0.82, 1.3).translate(0, 0.62, 0), wool),
    paint(new THREE.SphereGeometry(0.26, 8, 6).translate(0.12, 0.84, 0.3), wool),
    paint(new THREE.SphereGeometry(0.26, 8, 6).translate(-0.14, 0.82, -0.25), wool),
    paint(new THREE.SphereGeometry(0.2, 8, 6).translate(0, 0.7, -0.55), wool),
  ];
  for (const [x, z] of [[0.2, 0.32], [-0.2, 0.32], [0.2, -0.32], [-0.2, -0.32]]) {
    body.push(paint(new THREE.CylinderGeometry(0.05, 0.045, 0.42, 6).translate(x, 0.21, z), dark));
  }
  const head = [
    paint(new THREE.SphereGeometry(0.16, 8, 6).scale(0.85, 0.9, 1.25).translate(0, 0, 0.14), dark),
    paint(new THREE.SphereGeometry(0.06, 6, 4).scale(1.6, 0.5, 1).translate(0.15, 0.06, 0.04), dark),
    paint(new THREE.SphereGeometry(0.06, 6, 4).scale(1.6, 0.5, 1).translate(-0.15, 0.06, 0.04), dark),
    paint(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.1, 0.0), wool),
  ];
  return { body: mergeGeometries(body), head: mergeGeometries(head) };
}

/** Flocks of birds wheeling over the land; entirely animated in the shader. */
function createBirds(): THREE.Mesh {
  const flocks: [number, number, number, number, number][] = [
    // x, z, height above ground, radius, brightness
    [START.x + 30, START.z - 60, 38, 46, 0.25],
    [LAKE.x, LAKE.z, 26, 70, 0.95],
    [CITY.x, CITY.z, 78, 90, 0.3],
    [LIGHTHOUSE.x + 20, LIGHTHOUSE.z + 30, 34, 60, 0.95],
    [WINDMILL.x, WINDMILL.z, 30, 50, 0.25],
  ];
  const per = 9;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.28, 0, 0, -0.22, -0.62, 0, -0.08, 0, 0, 0.28, 0.62, 0, -0.08, 0, 0, -0.22], 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 0], 1));
  const centre = new Float32Array(flocks.length * per * 4);
  const orbit = new Float32Array(flocks.length * per * 4);
  const rand = seededRandom(808);
  flocks.forEach(([x, z, up, radius, bright], f) => {
    for (let i = 0; i < per; i++) {
      const o = (f * per + i) * 4;
      centre.set([x, heightAt(x, z) + up + rand() * 8, z, bright], o);
      orbit.set([radius * (0.7 + rand() * 0.5), (0.1 + rand() * 0.05) * (f % 2 ? 1 : -1), rand() * 6.28, 0.8 + rand() * 0.5], o);
    }
  });
  geo.setAttribute('aCentre', new THREE.InstancedBufferAttribute(centre, 4));
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  geo.instanceCount = flocks.length * per;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aWing;
      attribute vec4 aCentre;
      attribute vec4 aOrbit;
      uniform float uTime;
      varying float vShade;
      void main() {
        float a = aOrbit.z + uTime * aOrbit.y * 6.0 / max(aOrbit.x * 0.05, 1.0);
        vec3 c = aCentre.xyz + vec3(cos(a) * aOrbit.x, sin(a * 2.0 + aOrbit.z) * 3.0, sin(a) * aOrbit.x);
        // Heading is the tangent of the circle.
        float dir = sign(aOrbit.y);
        vec3 fwd = vec3(-sin(a), 0.0, cos(a)) * dir;
        vec3 side = vec3(fwd.z, 0.0, -fwd.x);
        float flap = sin(uTime * 9.0 * aOrbit.w + aOrbit.z * 5.0);
        vec3 p = position * 1.5;
        vec3 world = c + side * p.x + fwd * p.z + vec3(0.0, aWing * (flap * 0.42 + 0.1) * 1.5, 0.0);
        vShade = aCentre.w * (0.8 + 0.2 * aWing);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vShade;
      void main() {
        gl_FragColor = vec4(vec3(vShade), 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = shared.uTime;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function createLife(village: VillageInfo, city: CityInfo, count: number): {
  object: THREE.Group;
  update: (dt: number, time: number, player: THREE.Vector3) => void;
} {
  const group = new THREE.Group();
  const rand = seededRandom(515);
  const actors: Actor[] = [];
  const walkers: Walker[] = [];

  const ground = (x: number, z: number): number => supportHeight(x, z, heightAt(x, z) + 1.2, 1.2);

  const actor = (x: number, z: number, yaw: number, style: RigStyle, fn: PoseFn, y?: number): Rig => {
    const rig = buildRig(style, false, false);
    rig.root.position.set(x, y ?? ground(x, z), z);
    rig.root.rotation.y = yaw;
    group.add(rig.root);
    actors.push({ rig, pose: { ...REST }, fn });
    return rig;
  };

  // ---- people at work
  {
    const f = FIELDS[1];
    const rig = actor(f.x + 4, f.z - 3, 0.6, villagerStyle(rand, 'farmer'), (t) => {
      const swing = Math.sin(t * 2.4);
      const up = Math.max(0, swing);
      return {
        ...REST, spineX: 0.25 + 0.3 * (1 - up), chestX: 0.1,
        armLX: -0.7 - 1.3 * up, armRX: -0.7 - 1.3 * up, armLZ: -0.25, armRZ: 0.25,
        elbowL: -0.5, elbowR: -0.5, legLX: -0.2, legRX: 0.2, kneeL: 0.2, kneeR: 0.1, bodyY: -0.04,
      };
    });
    const hoe = stick(1.5, 0.022, 0x8a6a48, new THREE.BoxGeometry(0.2, 0.05, 0.12).translate(0.08, 0.72, 0));
    hoe.rotation.x = Math.PI / 2;
    hoe.position.set(0, -0.06, 0.45);
    rig.handR.add(hoe);
  }
  {
    // Fishing from the end of the pier.
    const x = PIER.x - 15.5;
    const rig = actor(x, PIER.z + 0.3, -Math.PI / 2, villagerStyle(rand, 'farmer'), (t) => ({
      ...sit(t), armLX: -0.9, armRX: -0.9, elbowL: -0.5, elbowR: -0.5, armLZ: -0.2, armRZ: 0.2,
      headY: Math.sin(t * 0.25) * 0.2, spineX: 0.1 + Math.sin(t * 0.6) * 0.02,
    }), 1.0);
    const rod = stick(3.2, 0.014, 0x9a7a52);
    rod.rotation.x = Math.PI / 2 - 0.5;
    rod.position.set(0, 0.5, 1.3);
    rig.handR.add(rod);
  }
  for (const side of [1, -1]) {
    // Guards at the south gate, each leaning on a spear.
    const x = SOUTH_GATE.x + 5.4 * side;
    const z = SOUTH_GATE.z + 4.5;
    const rig = actor(x, z, 0, villagerStyle(rand, 'guard'), (t) => ({
      ...REST, armRX: -0.25, elbowR: -1.1, armRZ: -0.25,
      headY: Math.sin(t * 0.35 + side) * 0.5, chestX: 0.02 + 0.01 * Math.sin(t * 1.6),
    }));
    const spear = stick(2.5, 0.022, 0x7a5a3c, new THREE.ConeGeometry(0.05, 0.3, 6).translate(0, 1.4, 0));
    spear.rotation.x = 1.1;
    spear.position.set(0, -0.08, 0.02);
    rig.handR.add(spear);
  }
  village.stalls.slice(0, 3).forEach((s, i) => {
    // Stallholders behind their counters.
    const x = s.x - Math.sin(s.rot) * 1.3;
    const z = s.z - Math.cos(s.rot) * 1.3;
    actor(x, z, s.rot, villagerStyle(rand), (t) => {
      const wave = Math.max(0, Math.sin(t * 0.5 + i * 2)) ** 6;
      return {
        ...REST, armRX: -0.4 - 1.6 * wave, armRZ: -0.2 - 0.5 * wave, elbowR: -0.6 - 0.6 * wave,
        wristR: Math.sin(t * 9) * 0.3 * wave, headY: Math.sin(t * 0.4 + i) * 0.35, chestX: 0.03,
      };
    });
  });
  village.benches.forEach((b) => {
    actor(b.x + Math.sin(b.rot) * 0.05, b.z + Math.cos(b.rot) * 0.05, b.rot, villagerStyle(rand), sit, heightAt(b.x, b.z));
  });
  {
    // Sweeping the city square.
    const rig = actor(city.plaza.x + 7, city.plaza.z + 5, 2.2, villagerStyle(rand), (t) => {
      const s = Math.sin(t * 2.2);
      return {
        ...REST, spineX: 0.22, bodyYaw: 0.25 * s, armLX: -0.9, armRX: -0.7, armLZ: -0.3 + 0.2 * s, armRZ: 0.3 + 0.2 * s,
        elbowL: -0.5, elbowR: -0.7, legLX: -0.12, legRX: 0.12,
      };
    });
    const broom = stick(1.5, 0.02, 0x9a7a52, new THREE.ConeGeometry(0.13, 0.32, 7).translate(0, -0.85, 0), 0xc9a24a);
    broom.rotation.x = Math.PI / 2 + 0.7;
    broom.position.set(0, -0.1, 0.35);
    rig.handR.add(broom);
  }

  // ---- people on the move
  const doorMaterial = toon(0x6d4c33);
  const doorGeo = new THREE.BoxGeometry(1.05, 2.05, 0.09).translate(0.525, 1.025, 0);
  const doors = new Map<BuiltHouse, THREE.Object3D>();
  for (const h of village.homes) {
    const door = new THREE.Mesh(doorGeo, doorMaterial);
    door.position.set(h.doorX, h.doorY, h.doorZ);
    door.rotation.y = h.rot;
    door.castShadow = true;
    group.add(door);
    doors.set(h, door);
  }
  const villageSpots: Target[] = [
    { x: village.well.x + 2.2, z: village.well.z + 1.5, wait: 5 },
    ...village.stalls.map((s) => ({ x: s.x + Math.sin(s.rot) * 1.6, z: s.z + Math.cos(s.rot) * 1.6, wait: 6 })),
    { x: BRIDGE.x + 0.8, z: BRIDGE.z, wait: 7 },
    { x: BRIDGE.x - 1, z: BRIDGE.z + 40, wait: 2 },
    { x: FIELDS[0].x + 20, z: FIELDS[0].z + 22, wait: 6 },
    { x: 14, z: -150, wait: 2 },
  ];
  const walker = (targets: Target[], style: RigStyle): void => {
    const rig = buildRig(style, false, false);
    const start = targets[0];
    const w: Walker = {
      rig, pose: { ...REST }, pos: new THREE.Vector3(start.x, ground(start.x, start.z), start.z), yaw: 0,
      phase: rand() * 6, targets, index: 1 % targets.length, state: 'walk', timer: 0, stuck: 0, door: null,
    };
    group.add(rig.root);
    walkers.push(w);
  };
  const shuffled = (list: Target[]): Target[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  village.homes.slice(0, Math.min(count, village.homes.length)).forEach((home) => {
    const route: Target[] = [{ x: home.stepX, z: home.stepZ, wait: 0, home }, ...shuffled(villageSpots).slice(0, 3)];
    walker(route, villagerStyle(rand));
  });
  // Townsfolk follow the generated market lane in both directions, rather than
  // cutting straight through houses between old circular-city waypoints.
  const marketLane = CITY_STREETS.find((r) => r.id === 'market-lane')!;
  const lanePoints = marketLane.pts.filter((_, i) => i % 3 === 0).map(([x, z], i) => ({ x, z, wait: i % 5 === 0 ? 2 : 0 }));
  const townLoop: Target[] = [...lanePoints, ...lanePoints.slice(1, -1).reverse()];
  for (let i = 0; i < Math.min(count, 5); i++) {
    const offset = Math.floor(townLoop.length * i / 5);
    walker([...townLoop.slice(offset), ...townLoop.slice(0, offset)], villagerStyle(rand));
  }

  // ---- animals
  const sheepGeo = sheepGeometry();
  const flock: Sheep[] = [];
  const pastures: [number, number, number][] = [[START.x + 62, START.z - 52, 6], [WINDMILL.x + 4, WINDMILL.z + 42, 5]];
  for (const [px, pz, n] of pastures) {
    for (let i = 0; i < Math.min(n, count + 1); i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(sheepGeo.body, plain);
      body.castShadow = true;
      const head = new THREE.Group();
      head.position.set(0, 0.78, 0.5);
      head.add(new THREE.Mesh(sheepGeo.head, plain));
      root.add(body, head);
      root.scale.setScalar(0.9 + rand() * 0.3);
      const x = px + (rand() - 0.5) * 22;
      const z = pz + (rand() - 0.5) * 22;
      group.add(root);
      flock.push({ root, head, x, z, yaw: rand() * 6.28, homeX: px, homeZ: pz, timer: rand() * 5, grazing: true });
    }
  }
  group.add(createBirds());

  const tmp = { x: 0, z: 0 };
  const near = (x: number, z: number, p: THREE.Vector3, range: number): boolean =>
    (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < range * range;

  return {
    object: group,
    update: (dt, time, player) => {
      for (const a of actors) {
        const p = a.rig.root.position;
        const shown = near(p.x, p.z, player, 170);
        a.rig.root.visible = shown;
        if (!shown) continue;
        blendPose(a.pose, a.fn(time), 1 - Math.exp(-dt * 10));
        applyPose(a.rig, a.pose);
      }

      for (const w of walkers) {
        const target = w.targets[w.index];
        let motion: 'walk' | 'idle' = 'idle';
        if (w.state === 'walk' || w.state === 'enter' || w.state === 'leave') {
          let tx = target.x;
          let tz = target.z;
          if (w.state === 'enter' && target.home) {
            // Through the doorway and a couple of paces inside.
            tx = target.x - Math.sin(target.home.rot) * 3.0;
            tz = target.z - Math.cos(target.home.rot) * 3.0;
          }
          const dx = tx - w.pos.x;
          const dz = tz - w.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.35) {
            motion = 'walk';
            const speed = 1.35;
            const before = w.pos.x + w.pos.z;
            w.pos.x += (dx / d) * speed * dt;
            w.pos.z += (dz / d) * speed * dt;
            if (w.state === 'walk') {
              tmp.x = w.pos.x;
              tmp.z = w.pos.z;
              if (resolveWalls(tmp, 0.3, w.pos.y, w.pos.y + 1.6, 0.5)) {
                w.pos.x = tmp.x;
                w.pos.z = tmp.z;
              }
              // Give up on a target that cannot be reached.
              w.stuck = Math.abs(w.pos.x + w.pos.z - before) < speed * dt * 0.3 ? w.stuck + dt : 0;
              if (w.stuck > 2.5) {
                w.stuck = 0;
                w.index = (w.index + 1) % w.targets.length;
              }
              w.pos.y = supportHeight(w.pos.x, w.pos.z, w.pos.y + 0.6, 0.6);
            }
            const want = Math.atan2(dx, dz);
            w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * Math.min(1, dt * 8);
            w.phase += (dt * Math.PI * 2 * speed) / 1.3;
          } else if (w.state === 'walk') {
            if (target.home) {
              w.state = 'enter';
              w.door = doors.get(target.home) ?? null;
            } else {
              w.state = 'wait';
              w.timer = target.wait * (0.7 + Math.random() * 0.8);
            }
          } else if (w.state === 'enter') {
            w.state = 'inside';
            w.timer = 8 + Math.random() * 14;
            w.rig.root.visible = false;
          } else {
            w.state = 'walk';
            w.index = (w.index + 1) % w.targets.length;
          }
        } else if ((w.timer -= dt) <= 0) {
          if (w.state === 'inside') {
            w.state = 'leave';
            w.rig.root.visible = true;
          } else {
            w.state = 'walk';
            w.index = (w.index + 1) % w.targets.length;
          }
        }
        // The door swings open while someone is passing through.
        if (w.door && target.home) {
          const open = w.state === 'enter' || w.state === 'leave';
          const goal = target.home.rot + (open ? 1.65 : 0);
          w.door.rotation.y += (goal - w.door.rotation.y) * Math.min(1, dt * 6);
        }
        const shown = w.state !== 'inside' && near(w.pos.x, w.pos.z, player, 170);
        w.rig.root.visible = shown;
        if (!shown) continue;
        w.rig.root.position.copy(w.pos);
        w.rig.root.rotation.y = w.yaw;
        blendPose(w.pose, poseFor(motion, w.phase, time + w.phase, 0, 0), 1 - Math.exp(-dt * 10));
        applyPose(w.rig, w.pose);
      }

      for (const s of flock) {
        const shown = near(s.x, s.z, player, 200);
        s.root.visible = shown;
        if (!shown) continue;
        if ((s.timer -= dt) <= 0) {
          s.grazing = !s.grazing;
          s.timer = s.grazing ? 4 + Math.random() * 7 : 1.5 + Math.random() * 3;
          if (!s.grazing) {
            // Wander, but turn back toward the middle of the pasture when far out.
            const home = Math.atan2(s.homeX - s.x, s.homeZ - s.z);
            s.yaw = Math.hypot(s.homeX - s.x, s.homeZ - s.z) > 16 ? home : s.yaw + (Math.random() - 0.5) * 2.4;
          }
        }
        if (!s.grazing) {
          s.x += Math.sin(s.yaw) * 0.55 * dt;
          s.z += Math.cos(s.yaw) * 0.55 * dt;
        }
        s.root.position.set(s.x, heightAt(s.x, s.z), s.z);
        s.root.rotation.y += Math.atan2(Math.sin(s.yaw - s.root.rotation.y), Math.cos(s.yaw - s.root.rotation.y)) * Math.min(1, dt * 3);
        const down = s.grazing ? 0.95 + Math.sin(time * 5 + s.x) * 0.06 : 0.1 + Math.abs(Math.sin(time * 6 + s.x)) * 0.06;
        s.head.rotation.x += (down - s.head.rotation.x) * Math.min(1, dt * 4);
      }
    },
  };
}
