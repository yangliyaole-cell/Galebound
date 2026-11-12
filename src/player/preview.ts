import * as THREE from 'three';
import type { Character, Motion } from './character';

/**
 * Temporary showcase until real controls exist (stage 2): the character loops
 * around a circle, and a button or keys 1-4 switch between its motions.
 */
const MOTIONS: { id: Motion; label: string; speed: number; height: number }[] = [
  { id: 'idle', label: '待机', speed: 0, height: 0 },
  { id: 'walk', label: '行走', speed: 1.6, height: 0 },
  { id: 'run', label: '奔跑', speed: 5.6, height: 0 },
  { id: 'glide', label: '滑翔', speed: 10, height: 5 },
];

const CENTRE = new THREE.Vector2(10, -12);
const RADIUS = 14;

export function createPreview(
  character: Character,
  groundAt: (x: number, z: number) => number,
  wind: () => THREE.Vector3,
): { update: (dt: number, time: number) => void } {
  let current = 0;
  let angle = 2.2;
  let speed = 0;
  let height = 0;
  const velocity = new THREE.Vector3();

  const button = document.createElement('button');
  Object.assign(button.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'max(20px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    padding: '12px 22px',
    font: '600 16px system-ui, sans-serif',
    color: '#fff',
    background: 'rgba(30, 50, 70, 0.55)',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    borderRadius: '999px',
    backdropFilter: 'blur(6px)',
    cursor: 'pointer',
    touchAction: 'manipulation',
  } satisfies Partial<CSSStyleDeclaration>);
  const select = (i: number): void => {
    current = i;
    button.textContent = `动作：${MOTIONS[i].label}（点击切换）`;
  };
  button.addEventListener('click', () => select((current + 1) % MOTIONS.length));
  window.addEventListener('keydown', (e) => {
    const i = Number(e.key) - 1;
    if (i >= 0 && i < MOTIONS.length) select(i);
  });
  document.body.appendChild(button);
  select(0);

  const place = (): void => {
    const x = CENTRE.x + Math.cos(angle) * RADIUS;
    const z = CENTRE.y + Math.sin(angle) * RADIUS;
    character.root.position.set(x, groundAt(x, z) + height, z);
    // Heading is the tangent of the circle.
    character.root.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle));
  };
  place();

  return {
    update: (dt, time) => {
      const motion = MOTIONS[current];
      const ease = 1 - Math.exp(-dt * 3);
      speed += (motion.speed - speed) * ease;
      height += (motion.height - height) * (1 - Math.exp(-dt * 1.5));
      angle += (speed / RADIUS) * dt;
      place();
      velocity.set(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(speed);
      character.update(dt, time, motion.id, velocity, wind(), groundAt);
    },
  };
}
