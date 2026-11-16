import * as THREE from 'three';

/**
 * Bare rock on the terrain, one kind per region (see geology.ts).
 *
 * How open-world games make cliffs read: the shape of the rock is relief, not a drawing on a
 * smooth slope, so every kind here is a height field (in metres) that lights the face through a
 * bumped normal: joints are grooves in shadow, block tops catch the sun, undersides go dark.
 * Each kind has its own structure (limestone stands in buttresses, sandstone lies in ledges,
 * basalt rises in columns, schist breaks in dipping plates, granite swells in rounded domes),
 * its own colours, and moss, dust or snow lies on whatever its relief turns upward. Detail
 * smaller than a few pixels fades out by footprint, so the same rock holds at every distance.
 *
 * Terrain fragment shader only (screen-space derivatives); guarded by TERRAIN_ROCK.
 */

const lin = (hex: number): string => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** Light, dark and accent (stain or second mineral) for each kind, in ROCK_KINDS order. */
const PALETTE: [number, number, number][] = [
  [0xc2b8a4, 0x81786a, 0xc29e70], // limestone: pale buff, iron-stained
  [0xc2bdb3, 0x84817c, 0xc6a99a], // granite: grey with pink feldspar
  [0x77716a, 0x3e3c3d, 0x80604a], // basalt: dark, rusty
  [0xd9a272, 0xa2654a, 0xe8d0a2], // sandstone: red with cream beds
  [0x8e9198, 0x50555f, 0x93704f], // schist: blue-grey, rust
  [0xaba291, 0x6e685e, 0x8f8d6a], // gritstone: grey-brown, lichen
];

export const ROCK_GLSL = /* glsl */ `
  uniform sampler2D uGeology;
  // Set by the terrain fragment before groundCover runs; rkOutN is written back.
  vec3 rkN = vec3(0.0, 1.0, 0.0);
  // A smooth normal from the height field: the triangles' own normals jump at every edge, and
  // choosing the projection by them would tear the pattern along the mesh.
  vec3 rkNs = vec3(0.0, 1.0, 0.0);
  vec3 rkDx = vec3(1.0, 0.0, 0.0);
  vec3 rkDy = vec3(0.0, 0.0, 1.0);
  float rkFp = 1.0;
  float rkDist = 0.0;
  vec3 rkOutN = vec3(0.0, 1.0, 0.0);

  // 0 for features too small to resolve here, 1 once they span several pixels.
  float rkLod(float size) { return smoothstep(1.5, 5.0, size / rkFp); }
  // Quarter-round falloff: 0 at an edge, 1 once r metres in.
  float rkBevel(float d, float r) { float t = clamp(d / r, 0.0, 1.0); return sqrt(t * (2.0 - t)); }
  // Irregular intervals along a line: id, distance (m) to the nearer boundary, fraction across.
  vec3 rkSpan(float x, float size, float seed) {
    float w = x / size;
    w += (gNoise(vec2(w * 0.6, seed)) - 0.5) * 0.8;
    float f = fract(w);
    return vec3(floor(w), min(f, 1.0 - f) * size, f);
  }
  // Facets: the rock surface as the upper envelope of irregular pyramids, one per slab. Each slab
  // has four faces of unequal steepness turned to its own bearing, so the surface is all flat
  // planes meeting at straight ridges and valleys, and it is continuous everywhere: an edge is a
  // change of angle in the light, never a line in the paint, never a tear. bias leans every slab
  // the same way (negative y: tops tilt up into ledges). Returns (height m, tone, cavity, 0).
  vec4 rkFacets(vec2 p, vec2 size, vec2 bias, vec2 slope, float seed) {
    vec2 q = p / size + seed;
    q += (vec2(gFbm3(q * 0.35), gFbm3(q * 0.35 + 5.0)) - 0.5) * 0.4;
    vec2 i = floor(q);
    float span = min(size.x, size.y);
    float rise = (slope.x + slope.y) * 0.5 * span;
    float best = -1e9; vec2 cell = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 n = i + vec2(float(x), float(y));
      vec2 dq = q - n - 0.15 - vec2(gHash(n), gHash(n + 31.7)) * 0.7;
      vec2 d = dq * size;
      float a = gHash(n + 2.2) * 6.2831853;
      vec2 r = vec2(cos(a), sin(a));
      vec2 e = vec2(dot(d, r), dot(d, vec2(-r.y, r.x)));
      vec4 s = (0.45 + vec4(gHash(n + 3.3), gHash(n + 5.5), gHash(n + 7.7), gHash(n + 9.9)) * 0.9) * slope.xxyy;
      // The faces turn with the slab, but each keeps to the face's own steepness range.
      float fall = max(max(e.x * s.x, -e.x * s.y), max(e.y * s.z, -e.y * s.w));
      // A slab leaves the 3x3 search only when it is at least 1.15 cells off along an axis, so
      // sink every slab smoothly before that: the envelope never jumps when the window moves.
      float far = smoothstep(0.7, 1.12, max(abs(dq.x), abs(dq.y)));
      float v = (gHash(n + 4.1) - 0.5) * rise + dot(d, bias) - fall - far * (rise * 3.0 + span);
      if (v > best) { best = v; cell = n; }
    }
    float lod = rkLod(span * 0.6);
    float h = best * lod;
    float cavity = clamp(-best / (rise + 0.01) - 0.2, 0.0, 1.0) * 0.4 * lod;
    return vec4(h, (gHash(cell + 6.7) - 0.5) * 0.5 * lod, cavity, 0.0);
  }
  // Two scales of facets, the lesser broken into the greater.
  vec4 rkBroken(vec2 p, vec2 size, vec2 bias, vec2 slope, float minor, float seed) {
    vec4 a = rkFacets(p, size, bias, slope, seed);
    #ifdef ROCK_LITE
    return a;
    #endif
    vec4 b = rkFacets(p, size * 0.3, bias * 0.6, slope * 0.9, seed + 17.0);
    return vec4(a.x + b.x * minor, a.y + b.y * 0.5, max(a.z, b.z * 0.7), 0.0);
  }

  // Each face pattern takes p = (along the face, up) in metres and returns
  // (height m, tone -1..1, cavity 0..1, streak 0..1).

  // Limestone: tall pillars and buttresses, turned this way and that, fluted by rain, with black
  // stains running down from every overhang.
  vec4 rkLimestone(vec2 p) {
    vec4 r = rkBroken(p, vec2(6.0, 13.0), vec2(0.0, -0.12), vec2(0.6, 0.18), 0.25, 11.0);
    float flute = (gNoise(vec2(p.x * 2.2, p.y * 0.12)) - 0.5) * 0.18 * rkLod(0.6);
    r.x += flute;
    r.w = smoothstep(0.5, 0.82, gNoise(vec2(p.x * 0.55, p.y * 0.03 + 11.0)));
    return r;
  }
  // Sandstone: long low slabs whose tops tilt up into ledges, with thin cross-bedding in the tone.
  vec4 rkSandstone(vec2 p) {
    vec4 r = rkBroken(p, vec2(11.0, 3.2), vec2(0.0, -0.4), vec2(0.3, 0.2), 0.35, 23.0);
    float set = floor((p.y + gFbm3(p * 0.03) * 4.0) / 2.6);
    float dip = (gHash(vec2(set, 2.0)) - 0.5) * 0.7;
    float lam = sin((p.y + p.x * dip) * 21.0) * 0.5 + 0.5;
    r.y += (lam - 0.5) * 0.22 * rkLod(0.2) + (gHash(vec2(set, 5.0)) - 0.5) * 0.35;
    r.w = smoothstep(0.55, 0.85, gNoise(vec2(p.x * 0.4, p.y * 0.05 + 3.0)));
    return r;
  }
  // Granite: big rounded masses with few joints, dark seeps below.
  vec4 rkGranite(vec2 p) {
    vec4 r = rkBroken(p, vec2(14.0, 10.0), vec2(0.0, -0.15), vec2(0.45, 0.25), 0.3, 4.0);
    r.y += (gFbm3(p * 0.07) - 0.5) * 0.5;
    r.w = smoothstep(0.55, 0.9, gNoise(vec2(p.x * 0.45, p.y * 0.02 + 4.0)));
    return r;
  }
  // Gritstone: middling blocks, rounded and mossy.
  vec4 rkGrit(vec2 p) {
    vec4 r = rkBroken(p, vec2(8.0, 5.0), vec2(0.0, -0.25), vec2(0.45, 0.22), 0.35, 37.0);
    r.w = smoothstep(0.55, 0.85, gNoise(vec2(p.x * 0.5, p.y * 0.04 + 37.0)));
    return r;
  }
  // Basalt: polygonal columns side-on, each broken across at its own heights.
  vec4 rkBasalt(vec2 p) {
    float lean = (gNoise(vec2(p.x * 0.02, 2.0)) - 0.5) * 0.25;
    vec3 c = rkSpan(p.x + p.y * lean, 1.6, 2.0);
    float ch = gHash(vec2(c.x, 2.0));
    float lodC = rkLod(0.6);
    float facet = mix(1.0, min(1.0, c.y / 0.4), lodC);
    vec3 r = rkSpan(p.y + ch * 9.0, 0.8 + ch * 1.2, 2.0 + c.x * 1.7);
    float lodR = rkLod(0.3);
    float ring = mix(1.0, rkBevel(r.y, 0.12), lodR);
    float seg = gHash(vec2(c.x, r.x));
    float h = facet * ring * (mix(0.62, 0.3 + 0.7 * ch, lodC) + 0.18 * (seg - 0.5) * lodR);
    // Whole sections of the colonnade have fallen away, leaving steps.
    vec4 big = rkFacets(p, vec2(12.0, 9.0), vec2(0.0, -0.2), vec2(0.3, 0.15), 2.0);
    float tone = (ch - 0.5) * 0.4 * lodC + (seg - 0.5) * 0.18 * lodR + (gFbm3(p * 0.05) - 0.5) * 0.4 + big.y * 0.5;
    float streak = smoothstep(0.55, 0.85, gNoise(vec2(p.x * 0.6, p.y * 0.02 + 2.0)));
    return vec4(h + big.x, tone, max(1.0 - facet * ring, big.z), streak);
  }
  // Schist: plates along a steep, wandering foliation, split across by joints.
  vec4 rkSchist(vec2 p) {
    float a = 0.95 + (gFbm3(p * 0.006 + 1.0) - 0.5) * 1.3;
    vec2 d = vec2(cos(a), sin(a));
    vec2 q = vec2(dot(p, vec2(-d.y, d.x)), dot(p, d));
    vec4 r = rkBroken(q, vec2(9.0, 1.6), vec2(0.0, -0.45), vec2(0.35, 0.2), 0.4, 5.0);
    r.y += (gFbm3(p * 0.04 + 3.0) - 0.5) * 0.4;
    r.w = smoothstep(0.58, 0.82, gFbm3(p * 0.06 + 9.0));
    return r;
  }

  vec4 rkFace(int k, vec2 p) {
    if (k == 0) return rkLimestone(p);
    if (k == 1) return rkGranite(p);
    if (k == 2) return rkBasalt(p);
    if (k == 3) return rkSandstone(p);
    if (k == 4) return rkSchist(p);
    return rkGrit(p);
  }
  vec4 rkTop(int k, vec2 p) {
    if (k == 2) return rkFacets(p, vec2(1.6), vec2(0.0), vec2(0.12), 2.0);  // column ends
    if (k == 4) return rkBroken(p, vec2(5.0, 2.5), vec2(0.0), vec2(0.25), 0.4, 5.0);
    return rkBroken(p, vec2(9.0, 7.0), vec2(0.0), vec2(0.22), 0.4, float(k) * 7.0);
  }
  // Height-aware blend: where two samples overlap, the higher one shows.
  float rkPick(vec4 a, vec4 b, float t) { return smoothstep(0.0, 1.0, clamp((t - 0.5) * 2.0 + (b.x - a.x) * 0.3 + 0.5, 0.0, 1.0)); }

  // One kind on a surface of any attitude: the face pattern projected along the nearest two of
  // eight compass directions, and the top pattern on whatever faces up.
  vec4 rkSample(int k, vec3 wp, vec3 n) {
    vec4 r = vec4(0.0);
    float wTop = smoothstep(0.55, 0.9, n.y);
    if (wTop < 0.99) {
      float a = atan(n.z, n.x) / 0.7853982 + 8.0;
      float s0 = floor(a), w1 = smoothstep(0.1, 0.9, a - s0);
      float a0 = s0 * 0.7853982, a1 = a0 + 0.7853982;
      vec4 f0 = w1 < 0.99 ? rkFace(k, vec2(dot(wp.xz, vec2(-sin(a0), cos(a0))), wp.y)) : vec4(0.0);
      vec4 f1 = w1 > 0.01 ? rkFace(k, vec2(dot(wp.xz, vec2(-sin(a1), cos(a1))), wp.y)) : vec4(0.0);
      r = mix(f0, f1, rkPick(f0, f1, w1));
    }
    if (wTop > 0.01) {
      vec4 tp = rkTop(k, wp.xz);
      r = wTop > 0.99 ? tp : mix(r, tp, rkPick(r, tp, wTop));
    }
    return r;
  }

  vec3 rkPalette(int k, float tone, vec4 r, vec3 wp) {
    vec3 light, dark, accent;
    ${PALETTE.map(([l, d, a], i) => `${i ? 'else ' : ''}${i < PALETTE.length - 1 ? `if (k == ${i}) ` : ''}{ light = ${lin(l)}; dark = ${lin(d)}; accent = ${lin(a)}; }`).join('\n    ')}
    vec3 c = mix(dark, light, smoothstep(-0.7, 0.7, tone));
    float stain = smoothstep(0.6, 0.85, gFbm3(vec2(wp.x + wp.z, wp.y * 2.0) * 0.018 + float(k) * 3.1));
    c = mix(c, accent, stain * 0.55);
    // Streaks: black water stains on limestone and granite, rust on schist, salt and guano on basalt.
    if (k == 4) c = mix(c, accent * 0.9, r.w * 0.5);
    else if (k == 2) c = mix(c, vec3(0.62, 0.62, 0.58), r.w * 0.3);
    else c *= 1.0 - r.w * (k == 0 ? 0.42 : 0.28);
    return c;
  }

  // Bare rock where the slope is steep. Returns the rock colour (rgb) and how much it shows (a);
  // the perturbed normal goes to rkOutN.
  vec4 terrainRock(vec3 wp, float rock, vec3 grass, float alt, float alpine, float fine) {
    rkOutN = rkN;
    if (rock < 0.01) return vec4(0.0);
    vec4 geo = texture2D(uGeology, worldUv(wp.xz)) * insideWorld(wp.xz);
    float schist = smoothstep(540.0, 820.0, alt);
    geo *= 1.0 - schist;
    float w[6];
    w[0] = geo.r; w[1] = geo.g; w[2] = geo.b; w[3] = geo.a; w[4] = schist;
    w[5] = max(0.0, 1.0 - geo.r - geo.g - geo.b - geo.a - schist);
    int k1 = 5, k2 = 5; float w1 = -1.0, w2 = -1.0;
    for (int i = 0; i < 6; i++) {
      if (w[i] > w1) { w2 = w1; k2 = k1; w1 = w[i]; k1 = i; }
      else if (w[i] > w2) { w2 = w[i]; k2 = i; }
    }
    float second = smoothstep(0.05, 0.2, w2 / max(w1 + w2, 1e-3));
    vec4 r1 = rkSample(k1, wp, rkNs);
    vec4 r2 = second > 0.0 ? rkSample(k2, wp, rkNs) : r1;
    float b = second > 0.0 ? rkPick(r1, r2, w2 / (w1 + w2)) * second : 0.0;
    vec4 r = mix(r1, r2, b);
    // Large-scale weathering, the same for every kind.
    float weather = gFbm(vec2(wp.x + wp.z, wp.y * 1.6) * 0.03) - 0.5;
    float grain = (gNoise(vec2(wp.x + wp.z, wp.y) * 3.0) - 0.5) * rkLod(0.4);
    float h = r.x + grain * 0.05;
    // Light the relief: the bump is in world space so moss and snow can find the tops.
    vec3 bn = rkN;
    {
      vec3 r1v = cross(rkDy, rkN), r2v = cross(rkN, rkDx);
      float det = dot(rkDx, r1v);
      float hh = h * rock;
      bn = normalize(abs(det) * rkN - sign(det) * (dFdx(hh) * r1v + dFdy(hh) * r2v));
    }
    vec3 col = mix(rkPalette(k1, r1.y + weather * 1.5, r1, wp), rkPalette(k2, r2.y + weather * 1.5, r2, wp), b);
    // Old faces go grey-green under lichen and algae in broad patches; fresh breaks stay pale.
    float patina = smoothstep(0.5, 0.78, gFbm3(vec2(wp.x - wp.z, wp.y * 1.3) * 0.011 + 3.7));
    col = mix(col, col * vec3(0.6, 0.64, 0.56), patina * 0.7);
    col *= 1.0 + grain * 0.25;
    col *= mix(1.0, 0.5, clamp(r.z, 0.0, 1.0));
    // What lies on the ledges: moss and turf low down, grit higher up, snow near the peaks.
    // Growth comes in clumps, thickest where the ledge is flattest, never as a flat fill.
    vec2 wq = vec2(wp.x + wp.z, wp.y);
    float clump = gNoise(wq * 0.35) * 0.65 + gNoise(wq * 1.7) * 0.35 * rkLod(0.5);
    float ledge = smoothstep(0.66, 0.9, bn.y + (fine - 0.5) * 0.2) * smoothstep(0.3, 0.6, clump + (bn.y - 0.75) * 0.8);
    vec3 moss = mix(grass * 0.72, vec3(0.13, 0.17, 0.06), 0.4) * (0.75 + 0.5 * clump);
    vec3 grit = mix(col, vec3(0.42, 0.38, 0.33), 0.6);
    vec3 cover = mix(moss, grit, smoothstep(0.2, 0.8, alpine));
    float snowy = smoothstep(uSnowLine - 420.0, uSnowLine - 60.0, alt);
    cover = mix(cover, uSnow * 0.95, snowy);
    float dry = (k1 == 3 || k1 == 2) ? 0.5 : 1.0;
    col = mix(col, cover, ledge * mix(0.85 * dry, 1.0, snowy));
    // At the margin the turf creeps into the joints and the high blocks stand clear of it.
    float edge = 4.0 * rock * (1.0 - rock);
    float shows = clamp(rock + clamp(r.x * 0.4, -0.6, 0.6) * edge, 0.0, 1.0);
    rkOutN = normalize(mix(rkN, bn, shows));
    return vec4(col, shows);
  }
`;
