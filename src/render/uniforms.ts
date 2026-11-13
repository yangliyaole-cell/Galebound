import * as THREE from 'three';

/** Uniforms shared by every world shader. Updated once per frame. */
export const shared = {
  uTime: { value: 0 },
  /** Direction the wind blows toward, on the xz plane. */
  uWindDir: { value: new THREE.Vector2(0, -1) },
  /** 0.25 is a light breeze, 1 is a full gust. */
  uWindStrength: { value: 0.25 },
  /** 0 outside a gust, 1 at its peak. */
  uGust: { value: 0 },
  /** Distance the air has travelled, for scrolling wind patterns without jumps. */
  uWindTravel: { value: new THREE.Vector2() },
  uCloudDrift: { value: new THREE.Vector2() },
  uPlayer: { value: new THREE.Vector3() },
};
