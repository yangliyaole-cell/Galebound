import * as THREE from 'three';

/** WebGL2 can filter RGBA16F linearly, but rendering to it still needs a colour-buffer extension. */
export function supportsHalfFloatTarget(renderer: THREE.WebGLRenderer): boolean {
  return !!renderer.extensions && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
}
export function colorTargetType(renderer: THREE.WebGLRenderer): THREE.TextureDataType {
  return supportsHalfFloatTarget(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType;
}
