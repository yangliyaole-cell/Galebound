import * as THREE from 'three';
import { shared } from '../render/uniforms';

/** Scene-linear RGB/alpha caps. Both are below cinematic's 0.58 bloom threshold. */
export const ABBEY_OPTICS = {
  shaft: { radiance: 0.32, alpha: 0.10 },
  patch: { radiance: 0.38, alpha: 0.28 },
} as const;

/** CPU envelope used to check the production uniforms and compositing bounds. */
export function abbeyOpticalEnvelope(kind: keyof typeof ABBEY_OPTICS, u: number, v: number, dust = 1): { radiance: number; alpha: number } {
  const limits = ABBEY_OPTICS[kind];
  const edge = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 2);
  const along = kind === 'shaft' ? THREE.MathUtils.smoothstep(v, 0, 0.06) * (1 - THREE.MathUtils.smoothstep(v, 0.80, 1))
    : Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.8);
  return { radiance: limits.radiance, alpha: limits.alpha * edge * along * (0.85 + 0.15 * THREE.MathUtils.clamp(dust, 0, 1)) };
}

export function createAbbeyLightMaterial(kind: keyof typeof ABBEY_OPTICS): THREE.ShaderMaterial {
  const limits = ABBEY_OPTICS[kind], shaft = kind === 'shaft';
  const mat = new THREE.ShaderMaterial({
    name: `abbey-${kind}`, transparent: true, depthTest: true, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.NormalBlending, vertexColors: true,
    // Keep scene-linear values in the HDR target; OutputPass owns ACES/sRGB.
    toneMapped: false,
    uniforms: { uTime: shared.uTime, uPlayer: shared.uPlayer,
      uLimits: { value: new THREE.Vector2(limits.radiance, limits.alpha) } },
    vertexShader: `uniform vec3 uPlayer;
      varying vec2 vUv; varying vec3 vColor; varying vec3 vPos;
      varying vec4 vClip; varying vec4 vPlayerClip; varying vec2 vPlayerRadius;
      void main() {
        vUv=uv; vColor=color; vPos=position;
        vClip=projectionMatrix*modelViewMatrix*vec4(position,1.);
        vec4 playerView=viewMatrix*vec4(uPlayer+vec3(0.,1.05,0.),1.);
        vPlayerClip=projectionMatrix*playerView;
        vPlayerRadius=vec2(projectionMatrix[0][0]*.85,projectionMatrix[1][1]*1.45)/max(.1,-playerView.z);
        gl_Position=vClip;
      }`,
    fragmentShader: `uniform float uTime; uniform vec2 uLimits;
      varying vec2 vUv; varying vec3 vColor; varying vec3 vPos;
      varying vec4 vClip; varying vec4 vPlayerClip; varying vec2 vPlayerRadius;
      void main() {
        float edge=pow(max(0.,sin(vUv.x*3.14159265)),2.);
        float grain=sin(vPos.x*2.3+vPos.z*3.7+sin(uTime*.23))*sin(vPos.y*4.1-uTime*.4);
        float dust=pow(max(0.,grain),12.);
        float along=${shaft ? 'smoothstep(0.,.06,vUv.y)*(1.-smoothstep(.80,1.,vUv.y))' : 'pow(max(0.,sin(vUv.y*3.14159265)),.8)'};
        float alpha=uLimits.y*edge*along*(.85+.15*dust);
        ${shaft ? `// Protect the opaque traveller's projected silhouette from foreground haze.
        if(vPlayerClip.w>0.) {
          vec2 delta=(vClip.xy/vClip.w-vPlayerClip.xy/vPlayerClip.w)/max(vPlayerRadius,vec2(.0001));
          alpha*=smoothstep(1.,1.25,length(delta));
        }` : ''}
        if(alpha<.001) discard;
        gl_FragColor=vec4(clamp(vColor,0.,1.)*uLimits.x,alpha);
        #include <colorspace_fragment>
      }`,
  });
  mat.userData.abbeyOptics = { kind, ...limits };
  return mat;
}
