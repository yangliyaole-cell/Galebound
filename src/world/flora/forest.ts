import * as THREE from 'three';
import { CLOUD_GLSL, NOISE_GLSL } from '../../render/glsl';
import { shared } from '../../render/uniforms';
import { seededRandom } from '../noise';
import { bloomTexture, makeShrub, makeTree, SHRUB_KINDS, sprayTextures, type BloomPaint, type FloraKind, type ShrubKind, type TreeKind, type TreeModel } from './tree-models';

/**
 * Everything that grows in the world, from great trees to window boxes. Near
 * the eye a plant is its full model; in the middle distance the same plant
 * with fewer, larger sprays; beyond that a flat picture of it, taken once when
 * the world is built and lit afresh every frame. The three fade into one
 * another by distance.
 */
interface Planted {
  x: number; y: number; z: number; scale: number; turn: number; color: THREE.Color;
  /** Flower colour, for kinds in bloom. */
  bloom: THREE.Color | null;
  stretch: [number, number, number];
}

interface Bloom {
  paint: BloomPaint;
  /** Share of the sprays in flower. */
  share: number;
  palette: [number, number, number, number];
  /** Every spray picks its own colour from the palette, as in a mixed border. */
  mixed?: boolean;
  /** Small close leaves rather than broad ones. */
  fine?: boolean;
}
interface KindInfo {
  variants: number; spray: keyof typeof sprayTextures; tints: number[]; seed: number; bloom?: Bloom;
  /** Too small to need a picture in the far distance. */
  near?: boolean;
}

const KINDS: Record<FloraKind, KindInfo> = {
  oak: { variants: 3, spray: 'leaf', tints: [0x4a8f36, 0x5b9f3c, 0x3f7f33, 0x6aa63f, 0x4f8a2e], seed: 11 },
  great: { variants: 1, spray: 'leaf', tints: [0x559b38], seed: 41 },
  blossom: { variants: 2, spray: 'blossom', tints: [0xf29bbb, 0xf5aec8, 0xee86aa, 0xf8c2d6], seed: 61 },
  cypress: { variants: 2, spray: 'leaf', tints: [0x2a5f38, 0x245639, 0x31683c], seed: 81 },
  pine: { variants: 3, spray: 'needle', tints: [0x2a6346, 0x2f6c4e, 0x245842, 0x35724f], seed: 101 },
  shrub: { variants: 3, spray: 'leaf', tints: [0x4a8a36, 0x56963a, 0x3f7d33, 0x62a043], seed: 201 },
  briar: { variants: 2, spray: 'leaf', tints: [0x4a8236, 0x55903a], seed: 221,
    bloom: { paint: 'briar', share: 0.45, palette: [0xf6c3cf, 0xfbeef0, 0xf2a6bb, 0xf8d6df] } },
  broom: { variants: 2, spray: 'fine', tints: [0x5a8a32, 0x66953a], seed: 241,
    bloom: { paint: 'broom', share: 0.55, palette: [0xf5d23a, 0xf2c230, 0xf7dc5a, 0xeec22a], fine: true } },
  rose: { variants: 2, spray: 'leaf', tints: [0x3f7533, 0x4a8038], seed: 261,
    bloom: { paint: 'rose', share: 0.42, palette: [0xd33447, 0xf08fb0, 0xfff1e6, 0xf2c55a] } },
  hydrangea: { variants: 1, spray: 'leaf', tints: [0x4f8a3a, 0x5a943e], seed: 281,
    bloom: { paint: 'hydrangea', share: 0.5, palette: [0x7e9ce6, 0xa58ade, 0xf09cc2, 0xf2f0ff] } },
  yew: { variants: 1, spray: 'fine', tints: [0x2d5a30, 0x30603a, 0x2a5530], seed: 301 },
  hedge: { variants: 1, spray: 'fine', tints: [0x3c6a30, 0x447536, 0x3a662f], seed: 311 },
  bed: { variants: 2, spray: 'leaf', tints: [0x4f8a3e, 0x5b9644], seed: 321,
    bloom: { paint: 'daisy', share: 0.75, palette: [0xffffff, 0x9a88e6, 0xf7e3a6, 0xf2a0bf], mixed: true } },
  spill: { variants: 2, spray: 'leaf', tints: [0x4f9442, 0x5c9e48], seed: 341, near: true,
    bloom: { paint: 'petunia', share: 0.55, palette: [0xe35b6a, 0xf2c94c, 0xf08fb0, 0xfff6ea], mixed: true } },
  ivy: { variants: 2, spray: 'leaf', tints: [0x3f6e30, 0x4a7a34, 0x557f38], seed: 361 },
  climber: { variants: 1, spray: 'leaf', tints: [0x4a7a34, 0x5b8a3c], seed: 381,
    bloom: { paint: 'rose', share: 0.36, palette: [0xa58ad6, 0xe57a9a, 0xf4efe8, 0xb48ad8] } },
};
const isShrub = (kind: FloraKind): kind is ShrubKind => (SHRUB_KINDS as string[]).includes(kind);

const DITHER = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';

/** Shared by full trees and their pictures: sun with a wrap, sky fill, light through the leaves. */
const FOLIAGE_LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  vec3 foliageLight(vec3 albedo, vec3 n, vec3 view, float open, float shadow) {
    float facing = dot(n, uSunDir);
    float wrap = clamp((facing + 0.3) / 1.3, 0.0, 1.0);
    // Leaves glow when the sun is behind them.
    float through = pow(clamp(dot(view, -uSunDir), 0.0, 1.0), 3.0) * (1.0 - wrap);
    // Sunlit foliage turns yellow-green; shade keeps the cool of the sky.
    vec3 hue = albedo * mix(vec3(0.8, 0.96, 1.1), vec3(1.26, 1.16, 0.66), wrap);
    vec3 sun = uSunColor * (wrap * mix(0.22, 1.0, open) + through * 0.45) * shadow;
    vec3 fill = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * mix(0.2, 1.0, open * open);
    return hue * (sun + fill) * 0.3183 + albedo * vec3(0.95, 1.0, 0.35) * uSunColor * through * 0.08 * shadow;
  }
  // Petals keep their own colour in the sun, and stay brighter in the shade than leaves do.
  vec3 petalLight(vec3 albedo, vec3 n, float open, float shadow) {
    float wrap = clamp((dot(n, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
    vec3 sun = uSunColor * wrap * mix(0.35, 1.0, open) * shadow;
    vec3 fill = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * mix(0.35, 1.0, open);
    return albedo * (sun + fill) * 0.3183;
  }
`;

export class Forest {
  private readonly planted = new Map<string, Planted[]>();
  private readonly pick = seededRandom(4107);
  /** Shrubs draw from their own sequence, so the trees grow as they always have. */
  private readonly shrubPick = seededRandom(5113);
  private updater: ((eye: THREE.Vector3) => void) | null = null;

  plant(kind: FloraKind, x: number, y: number, z: number, scale: number, turn?: number, stretch: [number, number, number] = [1, 1, 1]): void {
    const info = KINDS[kind], pick = isShrub(kind) ? this.shrubPick : this.pick;
    const key = `${kind}:${Math.floor(pick() * info.variants)}`;
    const color = new THREE.Color(info.tints[Math.floor(pick() * info.tints.length)])
      .offsetHSL((pick() - 0.5) * 0.04, (pick() - 0.5) * 0.08, (pick() - 0.5) * 0.09);
    let bloom: THREE.Color | null = null;
    if (info.bloom) {
      const palette = info.bloom.palette;
      // A mixed border shows every colour; its far picture shows their average.
      bloom = info.bloom.mixed
        ? palette.reduce((sum, c) => sum.add(new THREE.Color(c).multiplyScalar(0.25)), new THREE.Color(0, 0, 0))
        : new THREE.Color(palette[Math.floor(pick() * palette.length)]).offsetHSL((pick() - 0.5) * 0.03, 0, (pick() - 0.5) * 0.06);
    }
    const spin = pick() * Math.PI * 2;
    const list = this.planted.get(key) ?? [];
    list.push({ x, y, z, scale, turn: turn ?? spin, color, bloom, stretch });
    this.planted.set(key, list);
  }

  update(eye: THREE.Vector3): void { this.updater?.(eye); }

  build(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight, sunDir: THREE.Vector3, detail: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Forest';
    const nearEnd = detail === 2 ? 60 : detail === 1 ? 38 : 0;
    const midEnd = detail === 2 ? 340 : detail === 1 ? 200 : 90;
    const light = {
      uSunDir: { value: sunDir }, uSunColor: { value: new THREE.Color() }, uSkyColor: { value: new THREE.Color() }, uGroundColor: { value: new THREE.Color() },
    };
    const wind = { uTime: shared.uTime, uWindDir: shared.uWindDir, uWindTravel: shared.uWindTravel, uWindStrength: shared.uWindStrength, uCloudDrift: shared.uCloudDrift };
    // One texture per look, made only if something planted needs it.
    const textures = new Map<string, THREE.Texture>();
    const sprayFor = (kind: FloraKind): THREE.Texture => {
      const info = KINDS[kind], id = info.bloom ? `bloom:${info.bloom.paint}:${info.bloom.fine ? 1 : 0}` : info.spray;
      let tex = textures.get(id);
      if (!tex) textures.set(id, tex = info.bloom ? bloomTexture(info.bloom.paint, info.bloom.fine) : sprayTextures[info.spray]());
      return tex;
    };
    const bloomUniforms = (kind: FloraKind): Record<string, THREE.IUniform> => {
      const bloom = KINDS[kind].bloom;
      return {
        uBloomShare: { value: bloom?.share ?? 0 },
        uMixed: { value: bloom?.mixed ? 1 : 0 },
        uPalette: { value: (bloom?.palette ?? [0, 0, 0, 0]).map((c) => new THREE.Color(c)) },
      };
    };

    // ---- foliage cards
    const cardVertex = (capture: boolean): string => /* glsl */ `
      #include <common>
      attribute vec2 aCorner;
      attribute vec3 aCard;
      ${capture ? '' : 'attribute vec3 aBloomTint; uniform vec3 uPalette[4]; uniform float uMixed; varying vec3 vBloomColor;'}
      uniform float uBloomShare;
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform vec2 uWindTravel;
      uniform float uWindStrength;
      uniform vec4 uRange;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vTint;
      varying vec3 vWorld;
      varying float vDepth;
      varying float vSeed;
      varying float vCover;
      varying float vBloom;
      ${NOISE_GLSL}
      void main() {
        // Some sprays near the outside are in flower; they use the right half of the texture.
        vBloom = fract(aCard.y * 7.31 + 0.17) < uBloomShare && aCard.z < 0.6 ? 1.0 : 0.0;
        ${capture ? '' : `
        vBloomColor = uMixed > 0.5 ? uPalette[int(floor(fract(aCard.y * 3.71) * 3.999))] : aBloomTint;`}
        mat4 world = modelMatrix * instanceMatrix;
        vec4 wp = world * vec4(position, 1.0);
        vec3 origin = world[3].xyz;
        float scale = length(instanceMatrix[0].xyz);
        ${capture ? 'float flutter = 0.0; vCover = 1.0;' : `
        float lift = max(wp.y - origin.y, 0.0);
        float roll = gNoise((origin.xz - uWindTravel) * 0.03);
        float flutter = sin(uTime * (2.0 + aCard.y * 2.5) + aCard.y * 40.0 + wp.x);
        wp.xz += uWindDir * uWindStrength * lift * 0.02 * (0.35 + roll + 0.2 * flutter);
        float d = distance(cameraPosition, origin);
        vCover = smoothstep(uRange.x, uRange.y, d) * (1.0 - smoothstep(uRange.z, uRange.w, d));`}
        vec4 mvPosition = viewMatrix * wp;
        float turn = (aCard.y - 0.5) * 2.6 + flutter * 0.08 * (0.3 + uWindStrength);
        vec2 c = vec2(aCorner.x * cos(turn) - aCorner.y * sin(turn), aCorner.x * sin(turn) + aCorner.y * cos(turn));
        mvPosition.xy += c * aCard.x * scale;
        vUv = aCorner * 0.5 + 0.5;
        if (uBloomShare > 0.0) vUv.x = (vUv.x + vBloom) * 0.5;
        vN = normalize(mat3(world) * normal);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif
        vWorld = wp.xyz;
        vDepth = aCard.z;
        vSeed = aCard.y;
        gl_Position = projectionMatrix * mvPosition;
        ${capture ? '' : 'if (vCover <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);'}
      }`;
    const leafMaterial = (kind: FloraKind, range: [number, number, number, number]): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      uniforms: { ...light, ...wind, ...bloomUniforms(kind), uLeaf: { value: sprayFor(kind) }, uRange: { value: new THREE.Vector4(...range) } },
      vertexShader: cardVertex(false),
      fragmentShader: /* glsl */ `
        uniform sampler2D uLeaf;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vTint;
        varying vec3 vWorld;
        varying float vDepth;
        varying float vSeed;
        varying float vCover;
        varying float vBloom;
        varying vec3 vBloomColor;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        ${FOLIAGE_LIGHT_GLSL}
        void main() {
          vec4 t = texture2D(uLeaf, vUv);
          if (t.a < 0.42 || ${DITHER} >= vCover) discard;
          vec3 albedo = vTint * (0.5 + 0.85 * t.r) * (0.82 + 0.36 * vSeed);
          vec3 n = normalize(vN + (vec3(vSeed, fract(vSeed * 7.3), fract(vSeed * 13.7)) - 0.5) * 0.7);
          float open = (1.0 - vDepth * 0.9) * (0.55 + 0.45 * smoothstep(-0.5, 0.6, n.y));
          float shade = cloudShadow(vWorld.xz);
          vec3 col = foliageLight(albedo, n, normalize(cameraPosition - vWorld), open, shade);
          // Petals are painted with no green: that is how they are told from leaves.
          float petal = vBloom * clamp(1.0 - t.g / max(t.r, 0.02), 0.0, 1.0);
          if (petal > 0.0) col = mix(col, petalLight(vBloomColor * (0.5 + 0.62 * t.r), n, open, shade), petal);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const leafDepth = (kind: FloraKind): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      uniforms: { ...wind, uBloomShare: bloomUniforms(kind).uBloomShare, uLeaf: { value: sprayFor(kind) }, uRange: { value: new THREE.Vector4(-2, -1, 1e8, 1e9) } },
      vertexShader: cardVertex(true),
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D uLeaf;
        varying vec2 vUv;
        void main() {
          if (texture2D(uLeaf, vUv).a < 0.42) discard;
          gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
        }`,
    });

    // ---- wood
    const woodMaterial = (range: [number, number]): THREE.MeshStandardMaterial => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
      mat.customProgramCacheKey = () => `wood-${range[0]}-${range[1]}`;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, wind);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uTime; uniform vec2 uWindDir; uniform vec2 uWindTravel; uniform float uWindStrength;
            varying float vCover; varying vec3 vBark;
            ${NOISE_GLSL}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            mat4 treeWorld = modelMatrix * instanceMatrix;
            vec3 treeOrigin = treeWorld[3].xyz;
            vec4 treeP = treeWorld * vec4(transformed, 1.0);
            float treeLift = max(treeP.y - treeOrigin.y, 0.0);
            float treeRoll = gNoise((treeOrigin.xz - uWindTravel) * 0.03);
            vec2 treePush = uWindDir * uWindStrength * treeLift * 0.02 * (0.35 + treeRoll);
            mat3 treeBasis = mat3(treeWorld);
            transformed += (vec3(treePush.x, 0.0, treePush.y) * treeBasis) / dot(treeBasis[0], treeBasis[0]);
            vCover = 1.0 - smoothstep(${range[0].toFixed(1)}, ${range[1].toFixed(1)}, distance(cameraPosition, treeOrigin));
            vBark = treeP.xyz;`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying float vCover; varying vec3 vBark;\n${NOISE_GLSL}`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            if (${DITHER} >= vCover) discard;
            // Furrowed bark with lichen on the weather side.
            float furrow = gNoise(vec2(atan(vBark.x, vBark.z) * 0.0 + vBark.x * 9.0 + vBark.z * 7.0, vBark.y * 1.6));
            diffuseColor.rgb *= 0.72 + 0.5 * furrow;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.47, 0.3), smoothstep(0.62, 0.8, gNoise(vBark.xy * 2.3 + vBark.z)) * 0.35);`);
      };
      return mat;
    };

    // ---- models, and one picture of each from two sides
    const keys = [...this.planted.keys()].sort();
    const kindOf = (key: string): FloraKind => key.split(':')[0] as FloraKind;
    const models = new Map<string, TreeModel>();
    for (const key of keys) {
      const kind = kindOf(key), seed = KINDS[kind].seed + Number(key.split(':')[1]) * 7;
      models.set(key, isShrub(kind) ? makeShrub(kind, seed, detail) : makeTree(kind as TreeKind, seed, detail));
    }
    // Pictures only of what can be seen that far off.
    const pictured = keys.filter((key) => !KINDS[kindOf(key)].near);
    const tile = detail === 2 ? 256 : 128, columns = 8, rows = Math.max(1, Math.ceil(pictured.length * 2 / columns));
    const atlas = new THREE.WebGLRenderTarget(tile * columns, tile * rows, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: true,
    });
    {
      const stage = new THREE.Scene(), lens = new THREE.OrthographicCamera();
      const previous = renderer.getRenderTarget(), auto = renderer.autoClear, clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(atlas);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      pictured.forEach((key, k) => {
        const model = models.get(key)!, kind = kindOf(key);
        // Red: tone. Green: 1 on foliage (to be tinted), a half on petals, 0 on wood. Blue: how open to the sky.
        const wood = new THREE.Mesh(model.wood, new THREE.ShaderMaterial({
          vertexShader: 'attribute vec3 color; varying vec3 vC; void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'varying vec3 vC; void main() { gl_FragColor = vec4(dot(vC, vec3(1.6)), 0.0, 0.6, 1.0); }',
        }));
        const leaves = new THREE.InstancedMesh(model.leaves, new THREE.ShaderMaterial({
          uniforms: { ...wind, uBloomShare: bloomUniforms(kind).uBloomShare, uLeaf: { value: sprayFor(kind) }, uRange: { value: new THREE.Vector4() } },
          vertexShader: cardVertex(true),
          fragmentShader: /* glsl */ `
            uniform sampler2D uLeaf; varying vec2 vUv; varying float vDepth; varying float vBloom;
            void main() {
              vec4 t = texture2D(uLeaf, vUv);
              if (t.a < 0.42) discard;
              float petal = vBloom * clamp(1.0 - t.g / max(t.r, 0.02), 0.0, 1.0);
              gl_FragColor = vec4(0.5 + 0.85 * t.r, 1.0 - petal * 0.5, 1.0 - vDepth * 0.85, 1.0);
            }`,
        }), 1);
        leaves.setMatrixAt(0, new THREE.Matrix4());
        leaves.frustumCulled = false;
        stage.add(wood, leaves);
        const half = model.radius * 1.06, top = model.height * 1.03;
        lens.left = -half; lens.right = half; lens.bottom = -0.4; lens.top = top; lens.near = 0.1; lens.far = 200;
        lens.updateProjectionMatrix();
        for (let view = 0; view < 2; view++) {
          const slot = k * 2 + view;
          lens.position.set(view ? 60 : 0, 0, view ? 0 : 60);
          lens.lookAt(0, 0, 0);
          lens.position.y = 0; lens.updateMatrixWorld();
          atlas.viewport.set((slot % columns) * tile, Math.floor(slot / columns) * tile, tile, tile);
          atlas.scissor.copy(atlas.viewport);
          atlas.scissorTest = true;
          renderer.setRenderTarget(atlas);
          renderer.render(stage, lens);
        }
        stage.remove(wood, leaves);
        (wood.material as THREE.Material).dispose();
        (leaves.material as THREE.Material).dispose();
      });
      atlas.scissorTest = false;
      atlas.viewport.set(0, 0, tile * columns, tile * rows);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = auto;
    }

    // ---- far: one quad per plant, all kinds in a few regional batches
    const REGION = 512;
    const regions = new Map<string, { tree: number[]; look: number[]; color: number[]; bloom: number[] }>();
    pictured.forEach((key, k) => {
      const model = models.get(key)!;
      for (const t of this.planted.get(key)!) {
        const id = `${Math.floor(t.x / REGION)},${Math.floor(t.z / REGION)}`;
        const r = regions.get(id) ?? { tree: [], look: [], color: [], bloom: [] };
        r.tree.push(t.x, t.y, t.z, t.scale * Math.max(t.stretch[0], t.stretch[2]));
        r.look.push(k * 2 + (t.turn > Math.PI ? 1 : 0), model.radius * 1.06, model.height * 1.03 + 0.4, t.turn);
        r.color.push(t.color.r, t.color.g, t.color.b);
        if (t.bloom) r.bloom.push(t.bloom.r, t.bloom.g, t.bloom.b); else r.bloom.push(0, 0, 0);
        regions.set(id, r);
      }
    });
    const pictureMaterial = new THREE.ShaderMaterial({
      uniforms: { ...light, uCloudDrift: shared.uCloudDrift, uAtlas: { value: atlas.texture }, uFadeIn: { value: new THREE.Vector2(midEnd - 46, midEnd) } },
      vertexShader: /* glsl */ `
        attribute vec4 aTree;
        attribute vec4 aLook;
        attribute vec3 aTint;
        attribute vec3 aBloom;
        uniform vec2 uFadeIn;
        varying vec2 vUv;
        varying vec2 vTile;
        varying vec3 vTint;
        varying vec3 vBloom;
        varying vec3 vRight;
        varying vec3 vToEye;
        varying vec3 vWorld;
        varying float vCover;
        void main() {
          vec3 base = aTree.xyz;
          vec3 toEye = cameraPosition - base;
          float d = length(toEye);
          vCover = smoothstep(uFadeIn.x, uFadeIn.y, d);
          toEye = normalize(vec3(toEye.x, 0.0, toEye.z));
          vec3 right = vec3(toEye.z, 0.0, -toEye.x);
          float flip = fract(aLook.w * 3.7) > 0.5 ? -1.0 : 1.0;
          vec3 p = base + right * (position.x * aLook.y * aTree.w) + vec3(0.0, (position.y * aLook.z - 0.4) * aTree.w, 0.0);
          vUv = vec2(position.x * flip * 0.5 + 0.5, position.y);
          vTile = vec2(mod(aLook.x, ${columns.toFixed(1)}), floor(aLook.x / ${columns.toFixed(1)}));
          vTint = aTint; vBloom = aBloom; vRight = right * flip; vToEye = toEye; vWorld = p;
          gl_Position = vCover > 0.0 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec2 vTile;
        varying vec3 vTint;
        varying vec3 vBloom;
        varying vec3 vRight;
        varying vec3 vToEye;
        varying vec3 vWorld;
        varying float vCover;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        ${FOLIAGE_LIGHT_GLSL}
        void main() {
          vec4 t = texture2D(uAtlas, (vTile + clamp(vUv, 0.004, 0.996)) / vec2(${columns.toFixed(1)}, ${rows.toFixed(1)}));
          if (t.a < 0.35 || ${DITHER} >= vCover) discard;
          float cover = max(t.a, 0.35);
          vec3 albedo = mix(vec3(0.2, 0.15, 0.11), vTint, t.g) * t.r / cover;
          // The picture is flat; shade it as the rounded crown it shows.
          vec3 n = normalize(vRight * (vUv.x * 2.0 - 1.0) * 0.95 + vec3(0.0, vUv.y * 1.5 - 0.55, 0.0) + vToEye * 0.7);
          float open = t.b / cover, shade = cloudShadow(vWorld.xz);
          vec3 col = foliageLight(albedo, n, normalize(cameraPosition - vWorld), open, shade);
          // Flowers were drawn into the picture at half green; a plant without flowers has none.
          float petal = step(0.001, dot(vBloom, vec3(1.0))) * clamp((1.0 - t.g / cover) * 2.0, 0.0, 1.0);
          if (petal > 0.0) col = mix(col, petalLight(vBloom * 0.95, n, open, shade), petal);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [id, r] of regions) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', quad.attributes.position);
      geo.setIndex(quad.index);
      geo.setAttribute('aTree', new THREE.InstancedBufferAttribute(new Float32Array(r.tree), 4));
      geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(r.look), 4));
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(r.color), 3));
      geo.setAttribute('aBloom', new THREE.InstancedBufferAttribute(new Float32Array(r.bloom), 3));
      geo.instanceCount = r.tree.length / 4;
      const [ix, iz] = id.split(',').map(Number);
      let low = Infinity, high = -Infinity;
      for (let i = 1; i < r.tree.length; i += 4) { low = Math.min(low, r.tree[i]); high = Math.max(high, r.tree[i]); }
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((ix + 0.5) * REGION, (low + high) / 2 + 10, (iz + 0.5) * REGION), Math.hypot(REGION * 0.75, (high - low) / 2 + 30));
      const mesh = new THREE.Mesh(geo, pictureMaterial);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }

    // ---- near and middle: instance buffers refilled as the eye moves
    interface Stream {
      key: string; trees: Planted[]; cells: Map<number, number[]>; wood: THREE.InstancedMesh | null; leaves: THREE.InstancedMesh;
      bloom: THREE.InstancedBufferAttribute; cap: number; reach: number; at: THREE.Vector3;
    }
    const CELL = 64, cellKey = (ix: number, iz: number): number => (ix + 1024) * 2048 + iz + 1024;
    const streams: Stream[] = [];
    const matrix = new THREE.Matrix4(), turnQ = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), position = new THREE.Vector3(), size = new THREE.Vector3();
    const woodNear = woodMaterial([nearEnd + 4, nearEnd + 12]), woodMid = woodMaterial([midEnd - 30, midEnd - 6]);
    for (const key of keys) {
      const kind = kindOf(key), model = models.get(key)!, trees = this.planted.get(key)!, shrub = isShrub(kind);
      const cells = new Map<number, number[]>();
      trees.forEach((t, i) => {
        const id = cellKey(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
        const list = cells.get(id);
        if (list) list.push(i); else cells.set(id, [i]);
      });
      const depth = leafDepth(kind);
      const hasWood = model.wood.attributes.position.count > 0;
      // A plant too small to be pictured simply fades out at the far edge of the middle distance.
      const tiers: [number, THREE.BufferGeometry, THREE.Material, THREE.BufferGeometry, [number, number, number, number]][] = [];
      if (nearEnd > 0) tiers.push([nearEnd + 14, model.wood, woodNear, model.leaves, [-2, -1, nearEnd - 10, nearEnd]]);
      tiers.push([midEnd + 6, model.wood, woodMid, model.leavesMid, [nearEnd - 10, nearEnd, midEnd - 46, midEnd]]);
      tiers.forEach(([reach, woodGeo, woodMat, leafGeo, range], tier) => {
        const near = tier === 0 && nearEnd > 0;
        const cap = Math.min(trees.length, shrub ? (near ? 1600 : 6000) : near ? 400 : 4000);
        const woodMesh = hasWood ? new THREE.InstancedMesh(woodGeo, woodMat, cap) : null;
        // Each tier has its own view of the shared cards, carrying its own flower colours.
        const cards = new THREE.BufferGeometry();
        cards.setIndex(leafGeo.index);
        for (const [name, attribute] of Object.entries(leafGeo.attributes)) cards.setAttribute(name, attribute);
        const bloom = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
        cards.setAttribute('aBloomTint', bloom);
        const leafMesh = new THREE.InstancedMesh(cards, leafMaterial(kind, range), cap);
        leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        leafMesh.name = `${key}-${near ? 'near' : 'mid'}`;
        for (const mesh of woodMesh ? [woodMesh, leafMesh] : [leafMesh]) {
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          // Shrubs throw shadows only close by: the middle distance would cost a great many for little.
          mesh.castShadow = !shrub || near || nearEnd === 0;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          group.add(mesh);
        }
        if (woodMesh) woodMesh.receiveShadow = true;
        leafMesh.customDepthMaterial = depth;
        streams.push({ key, trees, cells, wood: woodMesh, leaves: leafMesh, bloom, cap, reach, at: new THREE.Vector3(Infinity, 0, 0) });
      });
    }
    const none = new THREE.Color(0, 0, 0);
    this.updater = (eye) => {
      light.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
      light.uSkyColor.value.copy(hemisphere.color).multiplyScalar(hemisphere.intensity);
      light.uGroundColor.value.copy(hemisphere.groundColor).multiplyScalar(hemisphere.intensity);
      for (const s of streams) {
        const slack = s.reach < 100 ? 6 : 20;
        if (s.at.distanceToSquared(eye) < slack * slack) continue;
        s.at.copy(eye);
        const reach = s.reach + slack;
        let count = 0;
        const i0 = Math.floor((eye.x - reach) / CELL), i1 = Math.floor((eye.x + reach) / CELL);
        const j0 = Math.floor((eye.z - reach) / CELL), j1 = Math.floor((eye.z + reach) / CELL);
        for (let j = j0; j <= j1 && count < s.cap; j++) for (let i = i0; i <= i1 && count < s.cap; i++) {
          const list = s.cells.get(cellKey(i, j));
          if (!list) continue;
          for (const index of list) {
            const t = s.trees[index];
            if ((t.x - eye.x) ** 2 + (t.z - eye.z) ** 2 > reach * reach || count >= s.cap) continue;
            matrix.compose(position.set(t.x, t.y, t.z), turnQ.setFromAxisAngle(yAxis, t.turn),
              size.set(t.scale * t.stretch[0], t.scale * t.stretch[1], t.scale * t.stretch[2]));
            s.wood?.setMatrixAt(count, matrix);
            s.leaves.setMatrixAt(count, matrix);
            s.leaves.setColorAt(count, t.color);
            const b = t.bloom ?? none;
            s.bloom.setXYZ(count, b.r, b.g, b.b);
            count++;
          }
        }
        for (const mesh of s.wood ? [s.wood, s.leaves] : [s.leaves]) {
          mesh.count = count;
          mesh.visible = count > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        s.bloom.needsUpdate = true;
      }
    };
    const count = (shrubs: boolean): number => keys.filter((key) => isShrub(kindOf(key)) === shrubs).reduce((n, key) => n + this.planted.get(key)!.length, 0);
    group.userData.trees = count(false);
    group.userData.shrubs = count(true);
    return group;
  }
}
