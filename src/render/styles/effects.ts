/** All sampling and grading happens in linear light. OutputPass alone encodes sRGB. */
export const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const fragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tPaper;
  uniform vec2 uPixel;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform vec2 uClip;
  uniform vec4 uGrade;
  uniform float uContrast;
  uniform vec3 uInk;
  uniform vec2 uEdge;
  #if STYLE == 1
    uniform vec2 uLuminanceEdge;
  #elif STYLE == 3
    uniform vec3 uPaperQuiet;
  #endif
  uniform vec4 uPaper;
  uniform vec3 uBloom;
  uniform vec3 uAtmosphere;
  uniform vec3 uSplitShadow;
  uniform vec3 uSplitLight;
  uniform float uSplitStrength;
  uniform vec3 uShadowFloor;
  uniform float uTime;
  uniform float uHeavy;
  uniform mat4 uInverseProjection;
  uniform mat4 uCameraWorld;
  uniform vec3 uFog;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float depthAt(vec2 uv) { return texture2D(tDepth, clamp(uv, 0.0, 1.0)).r; }
  float distanceAt(vec2 uv) { return -perspectiveDepthToViewZ(depthAt(uv), uClip.x, uClip.y); }
  vec3 colorAt(vec2 uv) { return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb; }
  vec3 perceptual(vec3 c) { return sqrt(max(c, vec3(0.0))); }

  void main() {
    vec2 cssPixel = uPixel * uPixelRatio;
    vec2 paperUV = vUv * uResolution / (256.0 * uPixelRatio);
    vec2 uv = vUv;
    #if STYLE == 3
      vec3 paperNoise = texture2D(tPaper, paperUV).rgb;
      vec2 warp = vec2(paperNoise.b - 0.5, texture2D(tPaper, paperUV.yx + 0.37).b - 0.5);
      uv += warp * cssPixel * uPaper.y;
    #endif
    vec3 col = colorAt(uv);
    float rawDepth = depthAt(uv);
    float z = distanceAt(uv);
    float lineMask = 0.0;

    #if STYLE == 1 || STYLE == 3
      vec2 stepUV = cssPixel * uEdge.x;
      float leftZ = distanceAt(uv - vec2(stepUV.x, 0.0));
      float rightZ = distanceAt(uv + vec2(stepUV.x, 0.0));
      float downZ = distanceAt(uv - vec2(0.0, stepUV.y));
      float upZ = distanceAt(uv + vec2(0.0, stepUV.y));
      float curvature = abs(leftZ + rightZ - 2.0 * z) + abs(downZ + upZ - 2.0 * z);
      float depthEdge = smoothstep(0.028, 0.12, curvature / max(z, 1.0));
      depthEdge *= 1.0 - smoothstep(400.0, 2200.0, z);
      // Colour edges also catch clouds, ridges and internal roof/stone boundaries.
      vec2 colorStep = cssPixel * max(0.8, uEdge.x * 0.65);
      vec3 leftC = colorAt(uv - vec2(colorStep.x, 0.0));
      vec3 rightC = colorAt(uv + vec2(colorStep.x, 0.0));
      vec3 downC = colorAt(uv - vec2(0.0, colorStep.y));
      vec3 upC = colorAt(uv + vec2(0.0, colorStep.y));
      float gradient = max(length(perceptual(leftC) - perceptual(rightC)), length(perceptual(downC) - perceptual(upC)));
      #if STYLE == 1
        float luminanceStep = max(abs(sqrt(max(luma(leftC), 0.0)) - sqrt(max(luma(rightC), 0.0))),
          abs(sqrt(max(luma(downC), 0.0)) - sqrt(max(luma(upC), 0.0))));
        // Keep cloud/ridge ink; solid surfaces need a large brightness discontinuity.
        float colorEdge = rawDepth >= 0.99999 ? smoothstep(0.15, 0.4, gradient)
          : smoothstep(uLuminanceEdge.x, uLuminanceEdge.y, luminanceStep);
      #else
        float colorEdge = smoothstep(0.08, 0.3, gradient);
      #endif
      float edge = max(depthEdge * mix(0.3, 1.0, colorEdge), colorEdge * uEdge.y);
    #endif

    #if STYLE == 1
      // Grass writes zero alpha while keeping its RGB; ink stays on solid silhouettes.
      lineMask = edge * texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).a;
    #elif STYLE == 2
      vec3 bloom = vec3(0.0);
      float occlusion = 0.0;
      if (uHeavy > 0.5) {
        for (int i = 0; i < 8; i++) {
          float angle = float(i) * 2.399963;
          vec2 axis = vec2(cos(angle), sin(angle));
          float radius = uBloom.z * (0.35 + float(i) * 0.093);
          vec3 lightSample = colorAt(uv + axis * cssPixel * radius);
          bloom += lightSample * smoothstep(uBloom.x, uBloom.x + 0.35, luma(lightSample));
          float dz = z - distanceAt(uv + axis * cssPixel * 6.0);
          occlusion += smoothstep(0.12, 0.6, dz) * (1.0 - smoothstep(1.0, 3.0, dz));
        }
        col *= 1.0 - occlusion * 0.025 * (1.0 - smoothstep(60.0, 160.0, z));
        col += bloom * (uBloom.y / 8.0);
      }
      vec2 radial = (uv - 0.5) * cssPixel * 0.9;
      col.r = mix(col.r, colorAt(uv + radial).r, 0.24);
      col.b = mix(col.b, colorAt(uv - radial).b, 0.24);
      vec4 viewP = uInverseProjection * vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
      vec3 worldP = (uCameraWorld * vec4(viewP.xyz / viewP.w, 1.0)).xyz;
      float mist = (1.0 - exp(-z * uAtmosphere.x)) * exp(-max(worldP.y, 0.0) * uAtmosphere.y);
      col = mix(col, uFog, min(uAtmosphere.z, mist) * step(rawDepth, 0.99999));
      float tone = smoothstep(0.07, 0.72, luma(col));
      vec3 shadowTint = uSplitShadow / max(luma(uSplitShadow), 0.01);
      vec3 lightTint = uSplitLight / max(luma(uSplitLight), 0.01);
      col *= mix(vec3(1.0), mix(shadowTint, lightTint, tone), uSplitStrength);
      col += (hash(gl_FragCoord.xy + floor(uTime * 24.0)) - 0.5) * 0.012;
    #elif STYLE == 3
      // Select the least variable wash; variable radii make pigment boundaries irregular.
      vec3 best = col;
      float bestVariance = 1e5;
      for (int quadrant = 0; quadrant < 4; quadrant++) {
        vec2 signUV = vec2((quadrant == 0 || quadrant == 2) ? -1.0 : 1.0, quadrant < 2 ? -1.0 : 1.0);
        vec2 delta = signUV * cssPixel * (2.5 + paperNoise.b * 3.0);
        vec3 a = colorAt(uv + vec2(delta.x, 0.0));
        vec3 b = colorAt(uv + vec2(0.0, delta.y));
        vec3 c = colorAt(uv + delta);
        vec3 mean = (col + a + b + c) * 0.25;
        vec3 variance = (col * col + a * a + b * b + c * c) * 0.25 - mean * mean;
        float score = dot(variance, vec3(1.0));
        if (score < bestVariance) { bestVariance = score; best = mean; }
      }
      col = mix(col, best, uPaper.z);
      // Pigment collects at wash boundaries and catches on coarse grain and fibres.
      float pigmentEdge = max(colorEdge, depthEdge * 0.65);
      col *= 1.0 - pigmentEdge * uPaper.z * (0.30 + paperNoise.b * 0.18);
      float relief = (paperNoise.r - 0.5) * 1.4 + (paperNoise.g - 0.5) * 0.7;
      float quiet = max(step(0.99999, rawDepth), 1.0 - smoothstep(uPaperQuiet.y, uPaperQuiet.z, gradient));
      col *= exp2(relief * uPaper.x * mix(1.0, uPaperQuiet.x, quiet));
      float wet = max(step(0.99999, rawDepth), smoothstep(600.0, 1800.0, z));
      col = mix(col, vec3(1.0, 0.95, 0.83), wet * uPaper.w * (0.65 + paperNoise.b * 0.7));
      float pencil = smoothstep(0.36, 0.68, paperNoise.g + paperNoise.r * 0.18);
      lineMask = edge * pencil;
    #endif

    // Contrast and saturation operate on positive luminance; never round individual channels.
    col = max(col, vec3(0.0));
    float y = max(luma(col), 0.00001);
    float contrastY = 0.22 * pow(y / 0.22, uContrast);
    col *= contrastY / y;
    col = max(mix(vec3(luma(col)), col, uGrade.x), vec3(0.0)) * uGrade.y;
    col = mix(col, uInk, clamp(lineMask * uGrade.z, 0.0, 1.0));
    vec2 lens = (vUv - 0.5) * vec2(1.0, 0.8);
    col *= 1.0 - smoothstep(0.23, 0.65, length(lens)) * uGrade.w;
    #if STYLE == 4
      // Preserve the dusk sky. Dark surfaces converge to a readable indigo-purple floor.
      float floorY = luma(uShadowFloor);
      if (rawDepth < 0.99999) col = mix(uShadowFloor, col, smoothstep(0.0, floorY * 2.0, luma(col)));
    #endif
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`;
