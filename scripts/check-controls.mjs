import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

// A small DOM event harness: exercise the actual TS classes without WebGL or dependencies.
class Element extends EventTarget {
  style = {};
  className = '';
  appendChild() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  requestPointerLock() { return Promise.resolve(); }
}
const win = Object.assign(new EventTarget(), {
  innerWidth: 1000, innerHeight: 800, matchMedia: () => ({ matches: false }),
});
const doc = Object.assign(new EventTarget(), {
  body: new Element(), createElement: () => new Element(), hidden: false,
  pointerLockElement: null, hasFocus: () => true,
});
let pads = [];
Object.defineProperties(globalThis, {
  window: { value: win, configurable: true },
  document: { value: doc, configurable: true },
  navigator: { value: { getGamepads: () => pads }, configurable: true },
});
const emit = (target, type, fields = {}) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
const pointer = (target, type, fields = {}) => emit(target, type, {
  pointerType: 'touch', pointerId: 1, clientX: 700, clientY: 400,
  movementX: 0, movementY: 0, button: 0, buttons: 1, ...fields,
});
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let failures = 0;
try {
  const { Input } = await server.ssrLoadModule('/src/core/input.ts');
  const { FollowCamera } = await server.ssrLoadModule('/src/player/camera.ts');
  const { Player } = await server.ssrLoadModule('/src/player/controller.ts');
  const { addBox } = await server.ssrLoadModule('/src/world/colliders.ts');
  const { buildHeightmap } = await server.ssrLoadModule('/src/world/heightmap.ts');
  buildHeightmap(32);
  const player = { pos: new THREE.Vector3(0, 100, 0), yaw: 0, speed: 0, gliding: false, mode: 'ground' };
  const fresh = () => {
    pads = [];
    doc.hidden = false;
    doc.pointerLockElement = null;
    emit(win, 'focus');
    const canvas = new Element();
    return { input: new Input(canvas), canvas };
  };
  const camera = () => {
    const cam = new THREE.PerspectiveCamera();
    const follow = new FollowCamera(cam, true);
    follow.update(1 / 60, player);
    return { cam, follow };
  };
  const degrees = (radians) => radians * 180 / Math.PI;
  const angleAfter = (input, dt = 1 / 60) => {
    const { cam, follow } = camera();
    const before = cam.getWorldDirection(new THREE.Vector3());
    input.poll(dt);
    follow.look(...input.takeLook());
    follow.update(1 / 60, player);
    return degrees(before.angleTo(cam.getWorldDirection(new THREE.Vector3())));
  };
  const check = (name, fn) => {
    try { fn(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  };

  // Frozen pre-fix input formula. Keep the regression reproducible after Git history moves.
  const mouseTrace = [[2, 0], [1200, 0], [0, -900], [3, 2], [-1200, 0], [1, 0]];
  const legacyMax = Math.max(...mouseTrace.map(([x, y]) => angleAfter({
    poll() {}, takeLook: () => [x * 0.0026, y * 0.0026],
  })));
  console.log(`Legacy unfiltered mouse trace max = ${legacyMax.toFixed(2)} degrees`);
  assert.ok(legacyMax > 150, 'the original input formula must reproduce a flip');

  check('locked mouse spike: maximum camera direction change < 21 degrees', () => {
    const { input, canvas } = fresh();
    pointer(canvas, 'pointerdown', { pointerType: 'mouse' });
    doc.pointerLockElement = canvas;
    emit(doc, 'pointerlockchange');
    pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 1 });
    input.takeLook();
    const angles = [];
    for (const [x, y] of mouseTrace) {
      pointer(win, 'pointermove', { pointerType: 'mouse', movementX: x, movementY: y });
      angles.push(angleAfter(input));
    }
    const max = Math.max(...angles);
    console.log(`  mouse trace max = ${max.toFixed(2)} degrees`);
    assert.ok(max < 21, `${max.toFixed(2)} degrees`);
  });
  check('normal mouse/touch motion is preserved; non-finite events cannot poison a frame', () => {
    const { input, canvas } = fresh();
    doc.pointerLockElement = canvas;
    emit(doc, 'pointerlockchange');
    pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 1200 });
    for (let i = 0; i < 4; i++) pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 3, movementY: 2 });
    pointer(win, 'pointermove', { pointerType: 'mouse', movementX: NaN });
    pointer(win, 'pointermove', { pointerType: 'mouse', movementY: Infinity });
    const look = input.takeLook();
    assert.ok(Math.abs(look[0] - 12 * 0.0026) < 1e-8);
    assert.ok(Math.abs(look[1] - 8 * 0.0026) < 1e-8);
    doc.pointerLockElement = null;
    emit(doc, 'pointerlockchange');
    pointer(canvas, 'pointerdown', { pointerId: 30 });
    pointer(win, 'pointermove', { pointerId: 30, clientX: 705, clientY: 403 });
    const touch = input.takeLook();
    assert.ok(Math.abs(touch[0] - 5 * 0.0052) < 1e-8);
    assert.ok(Math.abs(touch[1] - 3 * 0.0052) < 1e-8);
    pointer(win, 'pointermove', { pointerId: 30, clientX: 1200 });
    assert.deepEqual(input.takeLook(), [0, 0]);
  });
  check('many valid events in one stalled frame are bounded', () => {
    const { input, canvas } = fresh();
    doc.pointerLockElement = canvas;
    emit(doc, 'pointerlockchange');
    for (let i = 0; i < 100; i++) pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 12 });
    const max = angleAfter(input);
    console.log(`  event burst max = ${max.toFixed(2)} degrees`);
    assert.ok(max < 21, `${max.toFixed(2)} degrees`);
    assert.deepEqual(input.takeLook(), [0, 0]);
  });
  check('unlocked drag uses client coordinates, lock exit clears drag and pending deltas', () => {
    const { input, canvas } = fresh();
    pointer(canvas, 'pointerdown', { pointerType: 'mouse', clientX: 200 });
    pointer(win, 'pointermove', { pointerType: 'mouse', clientX: 210, movementX: 1200 });
    assert.ok(Math.abs(input.takeLook()[0] - 0.026) < 1e-8);
    doc.pointerLockElement = canvas;
    emit(doc, 'pointerlockchange');
    pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 1200 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    doc.pointerLockElement = null;
    emit(doc, 'pointerlockchange');
    pointer(win, 'pointermove', { pointerType: 'mouse', movementX: 8 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    pointer(canvas, 'pointerdown', { pointerType: 'mouse', clientX: 200 });
    pointer(win, 'pointermove', { pointerType: 'mouse', clientX: 400, movementX: 200 });
    const fast = angleAfter(input);
    assert.ok(fast > 15 && fast < 21, 'fast valid drags should turn, within the frame limit');
  });
  check('touch roles: second left finger does not rotate, third look finger does not rotate', () => {
    const { input, canvas } = fresh();
    pointer(canvas, 'pointerdown', { pointerId: 10, clientX: 100 });
    pointer(canvas, 'pointerdown', { pointerId: 11, clientX: 140 });
    pointer(win, 'pointermove', { pointerId: 11, clientX: 400 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    for (const [id, x] of [[20, 600], [21, 700], [22, 800]]) pointer(canvas, 'pointerdown', { pointerId: id, clientX: x });
    pointer(win, 'pointermove', { pointerId: 22, clientX: 850 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    assert.equal(input.takeZoom(), 0);
    pointer(win, 'pointerup', { pointerId: 20 });
    pointer(win, 'pointermove', { pointerId: 21, clientX: 700 });
    assert.equal(input.takeZoom(), 0, 'changing the pinch pair must rebase its distance');
  });
  check('pinch, pointer handoff, cancellation and pointer ID reuse', () => {
    const { input, canvas } = fresh();
    pointer(canvas, 'pointerdown', { pointerId: 2, clientX: 600 });
    pointer(canvas, 'pointerdown', { pointerId: 3, clientX: 700 });
    pointer(win, 'pointermove', { pointerId: 3, clientX: 710 });
    pointer(win, 'pointermove', { pointerId: 2, clientX: 590 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    assert.ok(input.takeZoom() < 0);
    pointer(win, 'pointerup', { pointerId: 2 });
    pointer(win, 'pointermove', { pointerId: 3, clientX: 1000 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    pointer(win, 'pointermove', { pointerId: 3, clientX: 1005 });
    assert.ok(Math.abs(input.takeLook()[0] - 0.026) < 1e-8);
    pointer(win, 'pointercancel', { pointerId: 3 });
    pointer(win, 'pointermove', { pointerId: 3, clientX: 500 });
    assert.deepEqual(input.takeLook(), [0, 0]);
    pointer(canvas, 'pointerdown', { pointerId: 3, clientX: 700 });
    pointer(win, 'pointermove', { pointerId: 3, clientX: 710 });
    assert.ok(Math.abs(input.takeLook()[0] - 0.052) < 1e-8);
    emit(canvas, 'lostpointercapture', { pointerId: 3, pointerType: 'touch' });
    pointer(win, 'pointermove', { pointerId: 3, clientX: 720 });
    assert.deepEqual(input.takeLook(), [0, 0]);
  });
  check('blur/hidden clear keys, stick, pending jump/look/zoom; hidden gamepad is idle', () => {
    const { input, canvas } = fresh();
    emit(win, 'keydown', { code: 'KeyW', repeat: false });
    input.pressJump();
    pointer(canvas, 'pointerdown', { clientX: 100 });
    pointer(win, 'pointermove', { clientX: 100, clientY: 320 });
    emit(canvas, 'wheel', { deltaY: 100 });
    emit(win, 'blur');
    input.poll(1 / 60);
    assert.equal(input.moveY, 0);
    assert.equal(input.takeJump(), false);
    assert.equal(input.takeZoom(), 0);
    assert.deepEqual(input.takeLook(), [0, 0]);
    pads = [{ connected: true, mapping: 'standard', axes: [1, 1, 1, 1], buttons: [] }];
    doc.hidden = true;
    emit(doc, 'visibilitychange');
    input.poll(1 / 60);
    assert.equal(input.moveX, 0);
    assert.deepEqual(input.takeLook(), [0, 0]);
  });
  check('standard gamepad at a sparse slot: continuous deadzone, bounded dt and jump reconnect', () => {
    const { input } = fresh();
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    pads = [null, { connected: true, mapping: 'standard', axes: [0.161, 0, 1, 1], buttons }];
    input.poll(1 / 60);
    assert.ok(input.moveX > 0 && input.moveX < 0.01);
    input.takeLook();
    const max = angleAfter(input, 5);
    console.log(`  gamepad 5s stall = ${max.toFixed(2)} degrees`);
    assert.ok(max < 10);
    buttons[0].pressed = true;
    input.poll(1 / 60);
    assert.equal(input.takeJump(), true);
    input.poll(1 / 60);
    assert.equal(input.takeJump(), false);
    pads = [];
    input.poll(1 / 60);
    pads = [null, { connected: true, mapping: 'standard', axes: [], buttons }];
    input.poll(1 / 60);
    assert.equal(input.takeJump(), false);
    buttons[0].pressed = false;
    input.poll(1 / 60);
    buttons[0].pressed = true;
    input.poll(1 / 60);
    assert.equal(input.takeJump(), true);
  });
  check('camera stays finite and bounded with invalid input, huge yaw, pitch and distance', () => {
    const { cam, follow } = camera();
    follow.look(NaN, Infinity);
    follow.zoom(NaN);
    follow.update(Infinity, player);
    assert.ok(cam.position.toArray().every(Number.isFinite));
    assert.ok(cam.quaternion.toArray().every(Number.isFinite));
    follow.yaw = 1e12;
    follow.pitch = 10;
    follow.distance = -1;
    follow.update(1 / 60, player);
    assert.ok(Math.abs(follow.yaw) <= Math.PI);
    assert.ok(follow.pitch <= 1.3);
    assert.ok(follow.distance >= 2.2);
  });
  check('auto-follow crosses +/- pi on the short arc and respects active glide look', () => {
    const { cam, follow } = camera();
    const p = { ...player, gliding: true, speed: 12, yaw: 0.01 };
    follow.yaw = Math.PI - 0.01;
    follow.update(1 / 60, p);
    const q = cam.quaternion.clone();
    follow.update(1 / 60, p);
    assert.ok(degrees(q.angleTo(cam.quaternion)) < 1);
    follow.look(0.02, 0.01);
    const yaw = follow.yaw;
    const pitch = follow.pitch;
    follow.update(1 / 60, p);
    assert.equal(follow.yaw, yaw);
    assert.equal(follow.pitch, pitch);
  });
  check('collision at first sample and water clamp keep the viewing hemisphere', () => {
    addBox(800, 800, 1, 1, 0, 110);
    const { cam, follow } = camera();
    let previous;
    let previousRotation;
    let max = 0;
    for (let i = 0; i < 720; i++) {
      follow.look(0.01, 0);
      follow.update(1 / 60, { ...player, pos: new THREE.Vector3(800, 100, 800) });
      const direction = cam.getWorldDirection(new THREE.Vector3());
      if (previous) max = Math.max(max, degrees(previous.angleTo(direction)));
      if (previousRotation) max = Math.max(max, degrees(previousRotation.angleTo(cam.quaternion)));
      previous = direction;
      previousRotation = cam.quaternion.clone();
      assert.ok(cam.position.distanceTo(new THREE.Vector3(800, 101.45, 800)) >= 0.79);
    }
    assert.ok(max < 1);
    for (const height of [-1.2, -0.5, 0]) {
      for (const pitch of [-0.75, 0, 1.3]) {
        follow.pitch = pitch;
        follow.update(1 / 60, { ...player, pos: new THREE.Vector3(0, height, 1000), mode: 'swim' });
        assert.ok(cam.quaternion.toArray().every(Number.isFinite));
        assert.ok(cam.position.y >= 0.25);
        assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).y > 0, 'camera must stay upright');
        assert.ok(cam.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(-Math.sin(follow.yaw), 0, -Math.cos(follow.yaw))) > 0);
      }
    }
  });
  check('WASD movement follows camera forward/right in each quadrant', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const [moveX, moveY] of [[0, 1], [1, 0]]) {
        // Avoid constructing the visual rig; this exercises Player.update itself.
        const p = Object.assign(Object.create(Player.prototype), {
          pos: new THREE.Vector3(0, 100, 0), vel: new THREE.Vector3(), yaw: 0, mode: 'air',
          coyote: 0, landTimer: 0, glideLock: 0, normal: new THREE.Vector3(),
          state: { wind: new THREE.Vector3() },
          character: { root: new THREE.Object3D(), update() {} },
        });
        p.update(1 / 60, 0, { moveX, moveY, run: false, takeJump: () => false }, yaw,
          { gust: 0, velocity: new THREE.Vector3(), dir: new THREE.Vector2(0, 1) });
        const expected = new THREE.Vector3(-Math.sin(yaw) * moveY + Math.cos(yaw) * moveX, 0,
          -Math.cos(yaw) * moveY - Math.sin(yaw) * moveX).normalize();
        assert.ok(new THREE.Vector3(p.vel.x, 0, p.vel.z).normalize().dot(expected) > 0.999);
      }
    }
  });
} finally {
  await server.close();
}
console.log(`${failures ? 'FAIL' : 'PASS'}: ${failures} failed checks`);
process.exitCode = failures ? 1 : 0;
