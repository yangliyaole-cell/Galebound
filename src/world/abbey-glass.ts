import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from '../render/glsl';

/**
 * Stained glass for Cloudfall Abbey, painted entirely in the fragment shader.
 * Every window is cut into leaded pieces; each piece takes one colour from the
 * picture behind it, so the scenes read as glass rather than as a printed image.
 *
 * Kinds: 0 the great window (the Gale's own valley under a star),
 *        1 a castle on its crag, 2 pines and a falling river,
 *        3 a lattice of stars, 4 a rose (radial), 5 clear quarries.
 */
export const GLASS = { great: 0, castle: 1, river: 2, lattice: 3, rose: 4, quarry: 5 } as const;

export class GlassPanes {
  private readonly parts: THREE.BufferGeometry[] = [];
  /**
   * @param outline the opening in the wall's own XY frame
   * @param matrix the wall frame
   * @param inward unit vector pointing into the building, in world space
   */
  add(outline: THREE.Vector2[], matrix: THREE.Matrix4, kind: number, seed: number, inward: THREE.Vector3): void {
    const g = new THREE.ShapeGeometry(new THREE.Shape(outline)).toNonIndexed();
    const pos = g.attributes.position, n = pos.count;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of outline) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const uv = new Float32Array(n * 2), pane = new Float32Array(n * 4), into = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = (pos.getX(i) - x0) / (x1 - x0); uv[i * 2 + 1] = (pos.getY(i) - y0) / (y1 - y0);
      pane.set([kind, seed, x1 - x0, y1 - y0], i * 4);
      into.set([inward.x, inward.y, inward.z], i * 3);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aPane', new THREE.BufferAttribute(pane, 4));
    g.setAttribute('aInward', new THREE.BufferAttribute(into, 3));
    g.deleteAttribute('normal');
    g.applyMatrix4(matrix);
    this.parts.push(g);
  }
  get count(): number { return this.parts.length; }
  build(): THREE.Mesh {
    const mesh = new THREE.Mesh(mergeGeometries(this.parts), createGlassMaterial());
    mesh.name = 'Abbey stained glass';
    return mesh;
  }
}

export function createGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'abbey-glass', side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uGlow: { value: 1.02 } },
    vertexShader: /* glsl */ `
      attribute vec4 aPane; attribute vec3 aInward;
      varying vec2 vUv; varying vec4 vPane; varying float vInside; varying vec3 vView;
      void main() {
        vUv = uv; vPane = aPane;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = cameraPosition - wp.xyz;
        vInside = dot(vView, aInward);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      varying vec2 vUv; varying vec4 vPane; varying float vInside; varying vec3 vView;
      ${NOISE_GLSL}
      float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      // An eight-rayed star: 1 inside. Long and short rays alternate.
      float star(vec2 p, float r) {
        float a = atan(p.x, p.y), d = length(p);
        float ray = pow(abs(cos(a * 4.0)), 7.0) * (0.62 + 0.38 * pow(abs(cos(a * 2.0)), 3.0));
        return step(d, r * (0.3 + 0.7 * ray));
      }
      float ridge(float x, float seed, float rough) {
        return gFbm(vec2(x * 3.0 + seed, seed * 1.7)) * 0.7 + gNoise(vec2(x * 11.0 + seed, 4.0)) * 0.3 * rough;
      }
      // Sky: deep blue overhead paling to the horizon, with heaped summer cloud.
      vec3 sky(vec2 p, float seed) {
        vec3 c = mix(vec3(0.62, 0.8, 0.96), vec3(0.13, 0.32, 0.78), smoothstep(0.1, 1.0, p.y));
        float cloud = gFbm(vec2(p.x * 2.6 + seed, p.y * 4.2 - seed)) - (0.52 + 0.1 * sin(p.x * 7.0 + seed));
        c = mix(c, vec3(0.86, 0.9, 0.97), smoothstep(-0.02, 0.03, cloud) * 0.9);
        return mix(c, vec3(1.0, 0.99, 0.95), smoothstep(0.05, 0.12, cloud));
      }
      // Pines as a comb of triangles along a hillside.
      float pines(vec2 p, float base, float n, float h, float seed) {
        float i = floor(p.x * n), f = fract(p.x * n) - 0.5;
        float tall = h * (0.55 + 0.45 * hash1(vec2(i, seed)));
        float y = p.y - base - 0.02 * sin(i * 1.7 + seed);
        return step(0.0, y) * step(abs(f) * 2.0, 1.0 - y / tall);
      }
      // The Gale's valley: the white peak, its glacier, Cloudfall, the river among pines and meadows.
      vec3 valley(vec2 p, float seed) {
        vec3 c = sky(p, seed);
        float x = p.x - 0.5;
        // The great peak, snow lit from the left and blue in shadow.
        float peak = 0.9 - abs(x + 0.02) * 1.15 - 0.09 * ridge(p.x, 3.0 + seed, 1.0) + 0.05 * gNoise(vec2(p.x * 23.0, 1.0));
        float rangeL = 0.6 - abs(x + 0.38) * 0.7 + 0.1 * ridge(p.x, 9.0, 1.0);
        float rangeR = 0.64 - abs(x - 0.36) * 0.8 + 0.1 * ridge(p.x, 15.0, 1.0);
        float far = max(rangeL, rangeR);
        if (p.y < far) {
          float lit = step(0.0, sin(p.x * 40.0 + p.y * 34.0 + gNoise(p * 9.0) * 5.0));
          c = mix(vec3(0.47, 0.56, 0.8), vec3(0.9, 0.94, 1.0), lit * smoothstep(far - 0.22, far - 0.02, p.y));
          c = mix(c, vec3(0.36, 0.44, 0.66), smoothstep(far - 0.1, far - 0.3, p.y));
        }
        if (p.y < peak) {
          float face = smoothstep(-0.04, 0.04, x + 0.02 + 0.05 * sin(p.y * 30.0) + 0.05 * (gNoise(p * 14.0) - 0.5));
          c = mix(vec3(1.0, 1.0, 0.99), vec3(0.6, 0.7, 0.93), face);
          float rock = smoothstep(0.52, 0.62, gFbm(p * vec2(13.0, 22.0) + seed)) * smoothstep(peak - 0.02, peak - 0.3, p.y);
          c = mix(c, vec3(0.42, 0.4, 0.56), rock * 0.85);
        }
        // The glacier spills between the shoulders, banded with blue crevasses.
        float tongue = 0.085 + 0.06 * smoothstep(0.62, 0.36, p.y) + 0.014 * sin(p.y * 37.0);
        float ice = step(abs(x - 0.02 - 0.05 * sin(p.y * 9.0)), tongue) * step(p.y, 0.62) * step(0.37, p.y);
        c = mix(c, mix(vec3(0.72, 0.9, 0.98), vec3(0.4, 0.7, 0.93), step(0.5, fract(p.y * 21.0 + gNoise(p * 8.0)))), ice);
        // Green shoulders, darker with distance, step down to the valley.
        float hillL = 0.5 - (x + 0.5) * 0.42 + 0.05 * ridge(p.x, 21.0, 0.6);
        float hillR = 0.47 + (x - 0.5) * 0.5 + 0.05 * ridge(p.x, 27.0, 0.6);
        float hill = max(hillL * step(x, -0.06), hillR * step(0.1, x));
        if (p.y < hill) c = mix(vec3(0.2, 0.47, 0.36), vec3(0.42, 0.68, 0.36), smoothstep(hill - 0.2, hill, p.y) * 0.6 + 0.4 * gNoise(p * 12.0));
        // Cloudfall: a white thread down the right-hand scarp.
        float fall = step(abs(x - 0.27 - 0.01 * sin(p.y * 60.0)), 0.016) * step(0.24, p.y) * step(p.y, 0.43);
        c = mix(c, vec3(0.96, 0.99, 1.0), fall);
        float trees = max(pines(p, 0.33 + 0.03 * sin(p.x * 9.0), 26.0, 0.1, 2.0) * step(abs(x), 0.5), pines(p, 0.24, 18.0, 0.13, 5.0) * step(0.2, abs(x)));
        c = mix(c, mix(vec3(0.07, 0.3, 0.26), vec3(0.16, 0.44, 0.3), hash1(floor(p.xx * 26.0))), trees);
        // Meadows and the river winding toward us.
        float ground = 0.26 + 0.03 * sin(p.x * 6.0 + 1.0);
        if (p.y < ground) c = mix(vec3(0.5, 0.74, 0.3), vec3(0.76, 0.85, 0.36), gNoise(p * vec2(9.0, 26.0)) );
        float bend = 0.07 * sin(p.y * 15.0 + 0.6) * smoothstep(0.0, 0.25, p.y) + 0.26 * smoothstep(0.02, 0.3, p.y) * 0.9 - 0.1;
        float river = step(abs(x - bend), 0.022 + 0.11 * (1.0 - smoothstep(0.0, 0.26, p.y))) * step(p.y, 0.3);
        c = mix(c, mix(vec3(0.3, 0.62, 0.9), vec3(0.8, 0.93, 1.0), step(0.6, gNoise(vec2(p.x * 30.0, p.y * 70.0)))), river);
        // Red-roofed cottages on the left bank; grey stones in the foreground.
        vec2 h = (p - vec2(0.2, 0.2)) * vec2(22.0, 26.0);
        float house = step(abs(fract(h.x) - 0.5), 0.3) * step(0.0, h.y) * step(h.y, 1.0) * step(abs(floor(h.x) - 0.0), 1.2) * (1.0 - river);
        c = mix(c, mix(vec3(0.95, 0.9, 0.78), vec3(0.8, 0.3, 0.18), step(0.5, h.y)), house);
        float stone = step(length((p - vec2(0.8, 0.06)) * vec2(1.0, 1.7)), 0.07) + step(length((p - vec2(0.1, 0.04)) * vec2(1.0, 1.9)), 0.06);
        return mix(c, vec3(0.62, 0.64, 0.7), min(1.0, stone) * (1.0 - river));
      }
      vec3 castle(vec2 p, float seed) {
        vec3 c = sky(p, seed);
        float x = p.x - 0.5;
        float hill = 0.42 - x * x * 1.5 + 0.03 * ridge(p.x, seed, 1.0);
        float far = 0.5 + 0.08 * ridge(p.x, seed + 7.0, 1.0) - 0.1;
        if (p.y < far) c = mix(vec3(0.5, 0.62, 0.86), vec3(0.72, 0.8, 0.95), step(0.5, gNoise(p * 14.0)));
        // Keep, two towers with blue caps and a curtain wall.
        vec2 q = vec2(x, p.y - hill);
        float keep = step(abs(q.x), 0.07) * step(-0.05, q.y) * step(q.y, 0.24);
        float towers = step(abs(abs(q.x) - 0.15), 0.035) * step(-0.08, q.y) * step(q.y, 0.17 - 0.03 * step(0.0, q.x));
        float curtain = step(abs(q.x), 0.2) * step(-0.1, q.y) * step(q.y, 0.07 + 0.012 * step(0.5, fract(q.x * 36.0)));
        float caps = step(abs(q.x), 0.085 * (1.0 - (q.y - 0.24) / 0.13)) * step(0.24, q.y)
          + step(abs(abs(q.x) - 0.15), 0.05 * (1.0 - (q.y - 0.15) / 0.1)) * step(0.15, q.y) * step(q.y, 0.25);
        c = mix(c, vec3(0.94, 0.9, 0.8), max(keep, max(towers, curtain)));
        c = mix(c, vec3(0.6, 0.62, 0.7), step(abs(q.x), 0.012) * step(0.05, q.y) * step(q.y, 0.12));
        c = mix(c, vec3(0.2, 0.36, 0.72), min(1.0, caps));
        if (p.y < hill - 0.05 * step(0.2, abs(x))) c = mix(vec3(0.34, 0.6, 0.3), vec3(0.6, 0.78, 0.34), gNoise(p * vec2(8.0, 20.0)));
        float trees = pines(p, 0.2 + 0.05 * sin(p.x * 7.0 + seed), 14.0, 0.16, seed) * step(0.24, abs(x));
        c = mix(c, vec3(0.08, 0.32, 0.26), trees);
        if (p.y < 0.14 + 0.02 * sin(p.x * 9.0)) c = mix(vec3(0.72, 0.84, 0.4), vec3(0.95, 0.86, 0.45), step(0.6, gNoise(p * 30.0)));
        return c;
      }
      vec3 riverScene(vec2 p, float seed) {
        vec3 c = sky(p, seed + 3.0);
        float x = p.x - 0.5;
        float scarp = 0.66 + 0.07 * ridge(p.x, seed + 2.0, 1.0);
        if (p.y < scarp) c = mix(vec3(0.44, 0.5, 0.7), vec3(0.66, 0.7, 0.84), step(0.5, fract(p.y * 16.0 + gNoise(p * 6.0) * 2.0)));
        float fall = step(abs(x + 0.03 * sin(p.y * 20.0)), 0.07 + 0.04 * (0.66 - p.y)) * step(0.3, p.y) * step(p.y, scarp);
        c = mix(c, mix(vec3(1.0), vec3(0.74, 0.88, 1.0), step(0.55, gNoise(vec2(p.x * 40.0, p.y * 9.0)))), fall);
        float mist = smoothstep(0.12, 0.0, length((p - vec2(0.5, 0.31)) * vec2(1.0, 1.6)));
        c = mix(c, vec3(0.95, 0.98, 1.0), mist * 0.8);
        float trees = pines(p, 0.26, 12.0, 0.2, seed) * step(0.16, abs(x)) + pines(p, 0.4, 20.0, 0.12, seed + 4.0) * step(0.26, abs(x));
        c = mix(c, mix(vec3(0.06, 0.28, 0.24), vec3(0.14, 0.42, 0.28), hash1(floor(p.xx * 12.0))), min(1.0, trees));
        if (p.y < 0.27) c = mix(vec3(0.42, 0.68, 0.3), vec3(0.7, 0.82, 0.36), gNoise(p * vec2(8.0, 22.0)));
        float river = step(abs(x - 0.1 * sin(p.y * 13.0)), 0.07 + 0.2 * (0.3 - p.y)) * step(p.y, 0.3);
        return mix(c, mix(vec3(0.28, 0.6, 0.9), vec3(0.82, 0.94, 1.0), step(0.6, gNoise(vec2(p.x * 26.0, p.y * 60.0)))), river);
      }
      // Blue quarries powdered with gold stars inside a border.
      vec3 lattice(vec2 m, vec2 size, float seed) {
        vec2 q = m / 0.62 + seed;
        vec2 d = vec2(q.x + q.y, q.x - q.y);
        vec2 id = floor(d), f = fract(d) - 0.5;
        float tone = hash1(id + seed);
        vec3 c = mix(vec3(0.1, 0.26, 0.74), vec3(0.3, 0.56, 0.96), tone);
        c = mix(c, vec3(0.8, 0.9, 1.0), step(0.86, tone));
        c = mix(c, vec3(1.0, 0.8, 0.3), star(f, 0.36) * step(tone, 0.45));
        float border = min(min(m.x, size.x - m.x), m.y);
        c = mix(c, vec3(1.0, 0.78, 0.26), step(border, 0.2) * step(0.07, border));
        return mix(c, vec3(0.95, 0.96, 1.0), step(border, 0.07));
      }
      vec3 rose(vec2 p, float seed) {
        vec2 q = (p - 0.5) * 2.0;
        float r = length(q), a = atan(q.x, q.y);
        float petal = floor(a / 6.2831853 * 12.0 + 0.5);
        vec3 c = mix(vec3(0.1, 0.25, 0.74), vec3(0.28, 0.55, 0.95), hash1(vec2(petal, floor(r * 5.0) + seed)));
        c = mix(c, vec3(0.86, 0.93, 1.0), step(0.8, hash1(vec2(petal + 3.0, floor(r * 5.0)))));
        float ray = pow(abs(cos(a * 6.0)), 5.0);
        c = mix(c, vec3(1.0, 0.82, 0.32), step(r, 0.2 + 0.42 * ray));
        c = mix(c, vec3(1.0, 0.97, 0.82), step(r, 0.13));
        c = mix(c, vec3(1.0, 0.8, 0.3), step(0.045, abs(r - 0.66)) < 0.5 ? 1.0 : 0.0);
        return mix(c, vec3(1.0, 0.84, 0.4), star((q - vec2(sin(petal * 0.5236), cos(petal * 0.5236)) * 0.82) , 0.09));
      }
      vec3 picture(vec2 p, vec2 m, vec2 size, float kind, float seed) {
        if (kind < 0.5) {
          // The landscape fills the lights; the head of the window holds the star in its glory.
          float head = smoothstep(0.6, 0.64, p.y);
          vec3 land = valley(vec2(p.x, p.y / 0.62), seed);
          vec2 q = vec2((p.x - 0.5) * size.x, (p.y - 0.795) * size.y) / (size.x * 0.25);
          float r = length(q), a = atan(q.x, q.y);
          vec3 glory = mix(vec3(0.12, 0.3, 0.8), vec3(0.34, 0.6, 0.97), hash1(floor(vec2(a * 3.8, r * 2.6))));
          glory = mix(glory, vec3(1.0, 0.86, 0.4), step(r, 0.3 + 0.62 * pow(abs(cos(a * 8.0)), 9.0) + 0.3 * pow(abs(cos(a * 4.0)), 5.0)));
          glory = mix(glory, vec3(1.0, 0.98, 0.86), star(q, 0.5));
          glory = mix(glory, vec3(1.0, 0.82, 0.34), step(abs(r - 1.02), 0.045));
          vec2 sq = fract(q * 1.9) - 0.5;
          glory = mix(glory, vec3(1.0, 0.86, 0.45), star(sq, 0.2) * step(1.12, r) * step(0.5, hash1(floor(q * 1.9))));
          return mix(land, glory, head);
        }
        vec3 c;
        if (kind < 1.5) c = castle(vec2(p.x, clamp((p.y - 0.12) / 0.6, 0.0, 1.0)), seed);
        else if (kind < 2.5) c = riverScene(vec2(p.x, clamp((p.y - 0.12) / 0.6, 0.0, 1.0)), seed);
        else if (kind < 3.5) return lattice(m, size, seed);
        else if (kind < 4.5) return rose(p, seed);
        else {
          vec2 d = vec2(m.x + m.y, m.x - m.y) / 0.3;
          vec3 clear = mix(vec3(0.56, 0.7, 0.82), vec3(0.78, 0.8, 0.7), hash1(floor(d) + seed)) * (0.82 + 0.18 * hash1(floor(d) * 3.0));
          vec2 e = abs(fract(d) - 0.5);
          clear *= 1.0 - 0.8 * smoothstep(0.44, 0.48, max(e.x, e.y));
          float border = min(min(m.x, size.x - m.x), m.y);
          return mix(clear, vec3(0.2, 0.42, 0.86), step(border, 0.16) * step(0.05, border));
        }
        // Lancets: a scene set in a field of starred quarries, with a gold border.
        float scene = step(0.12, p.y) * step(p.y, 0.72);
        c = mix(lattice(m, size, seed), c, scene);
        float rule = step(abs(p.y - 0.12) * size.y, 0.05) + step(abs(p.y - 0.72) * size.y, 0.05);
        return mix(c, vec3(1.0, 0.8, 0.3), min(1.0, rule));
      }
      void main() {
        float kind = vPane.x, seed = vPane.y;
        vec2 size = vPane.zw, m = vUv * size;
        // Leaded pieces: a jittered lattice of cells about a hand across; the picture is sampled once per piece.
        float cell = kind < 0.5 ? 0.4 : 0.32;
        vec2 g = m / cell, base = floor(g), f = fract(g);
        float best = 9.0, second = 9.0; vec2 centre = vec2(0.0), id = vec2(0.0);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j)), jitter = 0.5 + 0.36 * (hash2(base + o + seed) - 0.5) * 2.0 * 0.6;
          float d = length(o + jitter - f);
          if (d < best) { second = best; best = d; centre = base + o + jitter; id = base + o; }
          else if (d < second) second = d;
        }
        // Lattice, rose and quarry windows keep their own exact geometry; scenes are painted across
        // their pieces, each piece of glass a little lighter or darker than its neighbours.
        bool cut = kind < 2.5;
        vec2 pieceUv = mix(vUv, centre * cell / size, 0.3);
        vec3 col = picture(cut ? pieceUv : vUv, cut ? mix(m, centre * cell, 0.3) : m, size, kind, seed);
        // Pot-metal colours: deeper than paint, so the light that comes through is saturated.
        col = mix(col, col * col * 1.1, 0.5);
        float pieceTone = 0.84 + 0.28 * hash1(id + seed * 3.0);
        float streak = 0.92 + 0.16 * gNoise(m * vec2(9.0, 2.0) + id);
        col *= pieceTone * streak;
        float aa = fwidth(g.x) + fwidth(g.y);
        float lead = cut ? smoothstep(0.022, 0.022 + aa, second - best) : 1.0;
        if (!cut && kind < 3.5) {
          vec2 q = m / 0.62 + seed, d = vec2(q.x + q.y, q.x - q.y), e = abs(fract(d) - 0.5);
          lead = 1.0 - smoothstep(0.47 - fwidth(d.x) * 1.5, 0.485, max(e.x, e.y));
        }
        // Seen from inside the glass is the brightest thing in the building; from outside it is dark and takes the sky's sheen.
        lead = mix(0.16, 1.0, lead);
        vec3 lit = col * lead * uGlow;
        float fresnel = pow(1.0 - abs(normalize(vView).y) * 0.3, 3.0);
        vec3 outside = col * lead * 0.2 + vec3(0.2, 0.3, 0.42) * (0.25 + 0.5 * fresnel);
        gl_FragColor = vec4(vInside > 0.0 ? lit : outside, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
