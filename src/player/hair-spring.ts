import * as THREE from 'three';

/**
 * Secondary motion for the imported hair. The hair mesh is rigidly skinned to the head, so it
 * moved like a helmet. Games usually add a few spring bones for this; the asset has none, so the
 * spring runs once per frame on the CPU and the vertex shader bends each vertex by it, weighted
 * by how far that vertex sits from the scalp (roots stay put, fringe and nape tips swing most).
 *
 * The spring is driven by the head's acceleration (inertia: hair lags when you set off and
 * swings on when you stop), by the airflow over the head (wind minus head velocity, so running
 * and gliding stream it back), and by gravity relative to the head (prone flight lets it fall
 * toward the ground). A damped flutter rides on the airflow. Any offset that would push a vertex
 * toward the skull centre is removed in the shader, so the hair cannot sink into the head.
 */

/** Skull centre and radius in the asset's bind space (metres), measured from Traveler_Head. */
const SKULL = new THREE.Vector3(0, 1.69, -0.004);
const SCALP = 0.112;
/** Largest tip excursion, metres. The hair is short; more than this reads as rubber. */
const REACH = 0.065;

const HAIR_VERTEX = /* glsl */ `
#ifdef HAIR_SPRING
  {
    // Weight: 0 at the roots near the crown, rising toward loose tips at the fringe, sides and nape.
    vec3 fromSkull = position - uHairSkull;
    float tip = smoothstep(${(SCALP - 0.004).toFixed(3)}, ${(SCALP + 0.05).toFixed(3)}, length(fromSkull));
    float low = smoothstep(uHairSkull.y + 0.15, uHairSkull.y - 0.05, position.y);
    float w = clamp(0.2 * tip + 0.95 * low * (0.35 + 0.65 * tip), 0.0, 1.0);
    float seed = dot(position, vec3(41.0, 57.0, 33.0));
    vec3 offset = uHairOffset * w
      + uHairFlutter * (w * sin(uHairTime * 13.0 + seed) * 0.6 + w * sin(uHairTime * 21.0 + seed * 1.7) * 0.4);
    // Never toward the skull: keep only the tangential/outward part.
    vec3 n = normalize(transformed - uHairHead);
    float inward = dot(offset, n);
    if (inward < 0.0) offset -= n * inward;
    transformed += offset;
  }
#endif
`;

export class HairSpring {
  /** World-space spring state: tip offset from the rigid pose and its velocity. */
  private readonly offset = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly lastHead = new THREE.Vector3();
  private readonly lastVelocity = new THREE.Vector3();
  private readonly headVelocity = new THREE.Vector3();
  private readonly accel = new THREE.Vector3();
  private readonly air = new THREE.Vector3();
  private readonly sag = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly force = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly basis = new THREE.Matrix3();
  private initialized = false;
  private readonly uniforms = {
    uHairOffset: { value: new THREE.Vector3() },
    uHairFlutter: { value: new THREE.Vector3() },
    uHairSkull: { value: SKULL.clone() },
    uHairHead: { value: new THREE.Vector3() },
    uHairTime: { value: 0 },
  };

  /** Bind-space height of the head joint, so the skull centre can be placed relative to it. */
  constructor(private readonly mesh: THREE.SkinnedMesh, private readonly headJoint: THREE.Object3D, private readonly headBindY: number) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.defines = { ...shader.defines, HAIR_SPRING: '' };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec3 uHairOffset, uHairFlutter, uHairSkull, uHairHead;
uniform float uHairTime;`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${HAIR_VERTEX}`);
    };
    material.customProgramCacheKey = () => `${previousKey()}|hair-spring`;
    material.needsUpdate = true;
  }

  update(dt: number, time: number, wind: THREE.Vector3): void {
    if (!(dt > 0)) return;
    const head = this.headJoint.getWorldPosition(this.head);
    if (!this.initialized || head.distanceTo(this.lastHead) > 2) {
      // First frame or a teleport: start at rest.
      this.lastHead.copy(head);
      this.lastVelocity.set(0, 0, 0);
      this.offset.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
      this.initialized = true;
    }
    const step = Math.min(dt, 0.05);
    this.headVelocity.copy(head).sub(this.lastHead).divideScalar(step);
    this.accel.copy(this.headVelocity).sub(this.lastVelocity).divideScalar(step).clampLength(0, 60);
    this.lastHead.copy(head);
    this.lastVelocity.copy(this.headVelocity);

    // Gravity relative to the head: zero when upright, a sag toward the ground when prone.
    this.down.set(0, -1, 0).transformDirection(this.headJoint.matrixWorld);
    this.sag.set(0, -1, 0).sub(this.down).multiplyScalar(0.03);
    this.air.copy(wind).sub(this.headVelocity);
    const airSpeed = this.air.length();

    // Spring: about 1.6 Hz, lightly damped, plus aerodynamic drag on the tips.
    const k = 105, c = 7.5, drag = 0.5;
    for (let left = step; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.force.copy(this.sag).sub(this.offset).multiplyScalar(k)
        .addScaledVector(this.velocity, -c)
        .addScaledVector(this.accel, -0.25)
        // Streaming in the airflow saturates, so a 40 m/s dive does not stretch it further than a run.
        .addScaledVector(this.air, drag * Math.min(1, 9 / (airSpeed + 1e-3)));
      this.velocity.addScaledVector(this.force, h);
      this.offset.addScaledVector(this.velocity, h);
      if (this.offset.length() > REACH) {
        this.offset.setLength(REACH);
        this.velocity.multiplyScalar(0.5);
      }
    }

    // Into the mesh's skinned space (includes any root scale).
    this.mesh.updateMatrixWorld();
    this.inverse.copy(this.mesh.matrixWorld).invert();
    this.basis.setFromMatrix4(this.inverse);
    this.uniforms.uHairOffset.value.copy(this.offset).applyMatrix3(this.basis);
    // Flutter grows with airflow, across the stream rather than along it.
    const flutter = Math.min(0.012, airSpeed * 0.0011);
    this.uniforms.uHairFlutter.value.set(-this.air.z, 0.4 * airSpeed, this.air.x).normalize().multiplyScalar(flutter).applyMatrix3(this.basis);
    // Skull centre follows the posed head (the joint's axes match bind space at rest).
    this.headJoint.localToWorld(this.uniforms.uHairHead.value.set(0, SKULL.y - this.headBindY, SKULL.z)).applyMatrix4(this.inverse);
    this.uniforms.uHairTime.value = time;
  }
}
