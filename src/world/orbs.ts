import * as THREE from 'three';
import { shared } from '../render/uniforms';
import { orbAt, orbSpots } from './build';
import { surfaceTop } from './colliders';
import { heightAt, normalAt } from './heightmap';
import { CITY, HALF, LAKE, PLATEAU, START, WATCHTOWER, WINDMILL } from './layout';
import { seededRandom } from './noise';

/** Orbs out in the open country, beyond the ones the buildings register. */
function addWildSpots(): void {
  // The first one is in plain sight, to show what to look for.
  orbAt('start-first', START.x + 4, START.z - 12, 1.2);
  // Hanging in the air along the natural glide lines off each height.
  orbAt('air-start', START.x + 3, START.z - 62, 7);
  orbAt('air-start-far', START.x + 8, START.z - 130, 9);
  orbAt('air-windmill', WINDMILL.x - 50, WINDMILL.z + 10, 9);
  orbAt('air-watch', WATCHTOWER.x + 10, WATCHTOWER.z - 55, 16);
  orbAt('air-plateau', PLATEAU.x - 175, PLATEAU.z + 60, 22);
  orbAt('air-city-south', CITY.x - 20, CITY.z + CITY.wall + 40, 10);
  orbAt('air-lake', LAKE.x + 20, LAKE.z + 10, 5);
  orbAt('lake-shore', LAKE.x + 128, LAKE.z + 62, 1.2);

  // The rest are hidden wherever the land is interesting: seeded, so the same every time.
  const rand = seededRandom(1234);
  const chosen: [number, number][] = [];
  const normal = new THREE.Vector3();
  let guard = 0;
  while (chosen.length < 26 && guard++ < 6000) {
    const x = (rand() - 0.5) * (HALF * 2 - 240);
    const z = (rand() - 0.5) * (HALF * 2 - 240) - 40;
    const h = heightAt(x, z);
    if (h < 2.4 || h > 170 || z > 520) continue;
    if (normalAt(x, z, normal).y < 0.7) continue;
    if (surfaceTop(x, z) - h > 0.05) continue;
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.wall + 20) continue;
    if (chosen.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 150)) continue;
    // Prefer hilltops and high ground: reject most low, flat candidates.
    const prominence = h - (heightAt(x + 30, z) + heightAt(x - 30, z) + heightAt(x, z + 30) + heightAt(x, z - 30)) / 4;
    if (prominence < 1.5 && rand() < 0.75) continue;
    chosen.push([x, z]);
    orbAt(`wild-${chosen.length}`, x, z, 1.3);
  }
}

export interface OrbField {
  object: THREE.Object3D;
  total: number;
  found: number;
  /** @returns ids collected this frame */
  update: (dt: number, player: THREE.Vector3, reach: number) => string[];
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,236,170,0.75)');
  g.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function createOrbs(collected: Set<string>): OrbField {
  addWildSpots();
  const spots = orbSpots.map((s) => ({ ...s, y: surfaceTop(s.x, s.z) + s.up }));
  const n = spots.length;
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', quad.attributes.position);
  geo.setIndex(quad.index);
  const centre = new Float32Array(n * 3);
  const state = new Float32Array(n * 2);
  spots.forEach((s, i) => {
    centre.set([s.x, s.y, s.z], i * 3);
    state.set([collected.has(s.id) ? 0 : 1, (i * 0.618) % 1], i * 2);
  });
  geo.setAttribute('aCentre', new THREE.InstancedBufferAttribute(centre, 3));
  const stateAttr = new THREE.InstancedBufferAttribute(state, 2);
  stateAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aState', stateAttr);
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.uTime },
    vertexShader: /* glsl */ `
      attribute vec3 aCentre;
      attribute vec2 aState;
      uniform float uTime;
      varying vec2 vUv;
      varying float vPulse;
      varying float vAlive;
      void main() {
        float phase = aState.y * 6.28;
        vec3 c = aCentre;
        c.y += sin(uTime * 1.4 + phase) * 0.18;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        // Grow with distance so far orbs still twinkle on the horizon.
        float size = max(0.95, -mv.z * 0.011) * (0.9 + 0.12 * sin(uTime * 3.0 + phase));
        mv.xy += position.xy * size * aState.x;
        vUv = position.xy;
        vPulse = 0.5 + 0.5 * sin(uTime * 2.2 + phase);
        vAlive = aState.x;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vPulse;
      varying float vAlive;
      void main() {
        float d = length(vUv);
        float core = smoothstep(0.2, 0.05, d);
        float halo = pow(max(0.0, 1.0 - d), 2.6);
        // Four thin rays, like a star seen through half-closed eyes.
        float rays = pow(max(0.0, 1.0 - abs(vUv.x) * 9.0), 2.0) * max(0.0, 1.0 - abs(vUv.y))
          + pow(max(0.0, 1.0 - abs(vUv.y) * 9.0), 2.0) * max(0.0, 1.0 - abs(vUv.x));
        vec3 col = vec3(1.0, 0.9, 0.62) * halo * (0.7 + 0.3 * vPulse) + vec3(1.0) * core
          + vec3(1.0, 0.95, 0.8) * rays * (0.35 + 0.4 * vPulse);
        gl_FragColor = vec4(col * vAlive, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // A few sprites reused for the flash when one is picked up.
  const group = new THREE.Group();
  group.add(mesh);
  const flashTex = glowTexture();
  const flashes = Array.from({ length: 4 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.visible = false;
    sprite.renderOrder = 4;
    group.add(sprite);
    return { sprite, age: 1 };
  });
  let nextFlash = 0;

  const field: OrbField = {
    object: group,
    total: n,
    found: spots.filter((s) => collected.has(s.id)).length,
    update: (dt, player, reach) => {
      const got: string[] = [];
      for (let i = 0; i < n; i++) {
        if (state[i * 2] === 0) continue;
        const s = spots[i];
        const dx = s.x - player.x;
        const dz = s.z - player.z;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (Math.abs(s.y - (player.y + 1)) > reach + 0.6) continue;
        state[i * 2] = 0;
        stateAttr.needsUpdate = true;
        field.found++;
        got.push(s.id);
        const f = flashes[nextFlash++ % flashes.length];
        f.age = 0;
        f.sprite.position.set(s.x, s.y, s.z);
        f.sprite.visible = true;
      }
      for (const f of flashes) {
        if (!f.sprite.visible) continue;
        f.age += dt * 1.8;
        const k = Math.min(1, f.age);
        f.sprite.scale.setScalar(1.5 + k * 9);
        f.sprite.material.opacity = (1 - k) * (1 - k);
        if (k >= 1) f.sprite.visible = false;
      }
      return got;
    },
  };
  return field;
}
