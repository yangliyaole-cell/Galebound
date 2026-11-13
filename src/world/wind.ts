import * as THREE from 'three';
import { shared } from '../render/uniforms';

export type WindState = 'calm' | 'warning' | 'gust' | 'fading';

const WARNING = 5;
const FADING = 4;

/**
 * The gust cycle: calm, a few seconds of warning while the wind swings round
 * to its new heading, the gust itself, then a fade. Gliding needs a gust.
 */
export class Wind {
  state: WindState = 'calm';
  /** 0 outside a gust, 1 at full strength. */
  gust = 0;
  /** Direction the air moves toward. */
  readonly dir = new THREE.Vector2(0.12, -1).normalize();
  readonly velocity = new THREE.Vector3();
  /** Seconds left in the current state. */
  timer = 9;
  duration = 9;
  /** Distance travelled by fast air, for wind streaks. */
  readonly streak = new THREE.Vector2();
  onState: (state: WindState) => void = () => {};

  private angle = Math.atan2(this.dir.x, this.dir.y);
  private nextAngle = this.angle;
  private first = true;

  /** Compass bearing the wind blows toward, as text. */
  heading(): string {
    const names = ['南', '东南', '东', '东北', '北', '西北', '西', '西南'];
    const a = Math.atan2(this.dir.x, this.dir.y);
    return names[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }

  /** Start a gust now, optionally toward a given angle (for testing). */
  force(angle?: number): void {
    if (angle !== undefined) this.nextAngle = angle;
    this.enter('warning', 0.6);
  }

  private enter(state: WindState, seconds: number): void {
    this.state = state;
    this.timer = this.duration = seconds;
    this.onState(state);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'calm') {
        // The first gust blows from the starting hill toward the valley.
        if (!this.first) this.nextAngle = Math.random() * Math.PI * 2;
        this.first = false;
        this.enter('warning', WARNING);
      } else if (this.state === 'warning') this.enter('gust', 28 + Math.random() * 14);
      else if (this.state === 'gust') this.enter('fading', FADING);
      else this.enter('calm', 14 + Math.random() * 10);
    }

    let target = 0;
    if (this.state === 'warning') {
      // Swing toward the new heading by the shortest way round.
      const diff = Math.atan2(Math.sin(this.nextAngle - this.angle), Math.cos(this.nextAngle - this.angle));
      this.angle += diff * Math.min(1, dt * 1.6);
      target = 0.3 * (1 - this.timer / this.duration);
    } else if (this.state === 'gust') {
      this.angle = this.nextAngle;
      target = 1;
    }
    this.gust += (target - this.gust) * Math.min(1, dt * (this.state === 'fading' ? 0.9 : 1.6));
    if (this.state === 'calm' && this.gust < 0.01) this.gust = 0;

    this.dir.set(Math.sin(this.angle), Math.cos(this.angle));
    const speed = 3 + 11 * this.gust;
    this.velocity.set(this.dir.x * speed, 0, this.dir.y * speed);
    this.streak.addScaledVector(this.dir, dt * (5 + 17 * this.gust));

    const strength = 0.25 + 0.75 * this.gust;
    shared.uWindDir.value.copy(this.dir);
    shared.uWindStrength.value = strength;
    shared.uGust.value = this.gust;
    shared.uWindTravel.value.addScaledVector(this.dir, dt * (3 + 9 * this.gust));
    shared.uCloudDrift.value.addScaledVector(this.dir, dt * 0.004 * (0.5 + this.gust));
  }
}

const BOX = new THREE.Vector3(80, 30, 80);

/** Wind made visible: pale streaks during gusts, and petals that always drift. */
export function createWindFx(count: number, wind: Wind): THREE.Group {
  const group = new THREE.Group();
  const quad = new THREE.PlaneGeometry(1, 1);

  const make = (n: number, petals: boolean): THREE.Mesh => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', quad.attributes.position);
    geo.setIndex(quad.index);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTravel: { value: wind.streak },
        uWindDir: shared.uWindDir,
        uGust: shared.uGust,
        uTime: shared.uTime,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform vec2 uTravel;
        uniform vec2 uWindDir;
        uniform float uGust;
        uniform float uTime;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          const vec3 BOX = vec3(${BOX.x.toFixed(1)}, ${BOX.y.toFixed(1)}, ${BOX.z.toFixed(1)});
          vec3 base = aSeed.xyz * BOX;
          base.xz += uTravel * (0.7 + aSeed.w * 0.6);
          ${petals ? 'base.y -= uTime * (0.35 + aSeed.w * 0.5);' : ''}
          vec3 rel = mod(base - cameraPosition + BOX * 0.5, BOX) - BOX * 0.5;
          vec3 world = cameraPosition + rel;
          world.y += sin(uTime * 1.3 + aSeed.w * 40.0 + rel.x * 0.1) * 0.7;
          vec3 along = vec3(uWindDir.x, 0.0, uWindDir.y);
          vec3 toCam = normalize(cameraPosition - world);
          float edge = 1.0 - smoothstep(0.55, 0.98, length(rel / (BOX * 0.5)));
          ${
            petals
              ? `float spin = uTime * (2.0 + aSeed.w * 4.0) + aSeed.x * 20.0;
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 upv = cross(toCam, side);
          vec2 q = vec2(position.x * cos(spin) - position.y * sin(spin), position.x * sin(spin) + position.y * cos(spin));
          q.y *= 0.3 + 0.7 * abs(sin(spin * 0.7));
          world += (side * q.x + upv * q.y) * (0.09 + aSeed.y * 0.07);
          vAlpha = edge * (0.35 + 0.65 * uGust) * step(aSeed.z, 0.3 + 0.7 * uGust);
          vColor = aSeed.w < 0.55 ? vec3(1.0, 0.72, 0.82) : (aSeed.w < 0.8 ? vec3(1.0, 0.97, 0.9) : vec3(0.62, 0.86, 0.4));`
              : `float len = 2.5 + aSeed.w * 4.5;
          vec3 side = normalize(cross(along, toCam));
          world += along * position.x * len + side * position.y * 0.045;
          float life = sin(fract(uTime * 0.22 + aSeed.x * 7.0) * 3.14159);
          vAlpha = uGust * edge * life * sin((position.x + 0.5) * 3.14159) * 0.6;
          vColor = vec3(1.0);`
          }
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  };
  group.add(make(count, false), make(count, true));
  return group;
}
