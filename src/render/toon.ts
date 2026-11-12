import * as THREE from 'three';

// Four flat tones give the hand-painted, cel-shaded look.
const ramp = new THREE.DataTexture(new Uint8Array([105, 175, 230, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

export function toon(
  color: number,
  options: { vertexColors?: boolean; doubleSided?: boolean } = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: ramp,
    vertexColors: options.vertexColors ?? false,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}
