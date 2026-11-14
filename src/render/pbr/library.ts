import type { Tier } from '../../core/quality';
import { MASONRY_LAYOUT_GLSL } from './masonry';

export const PBR_MATERIALS = {
  stone: { id: 0, label: '粗石', relief: 0.11 },
  masonry: { id: 1, label: '码砌石墙', relief: 0.14 },
  plaster: { id: 2, label: '灰泥', relief: 0.018 },
  wood: { id: 3, label: '木头', relief: 0.035 },
  roof: { id: 4, label: '红瓦', relief: 0.065 },
  dirt: { id: 5, label: '土路', relief: 0.025 },
  moss: { id: 6, label: '苔藓', relief: 0.03 },
  cliff: { id: 7, label: '岩壁', relief: 0.16 },
  paving: { id: 8, label: '石板路', relief: 0.1 },
} as const;
export type PbrKind = keyof typeof PBR_MATERIALS;

/** Fragment only: analytic antialiasing removes frequencies smaller than a pixel. */
export function pbrLibrary(tier: Tier): string {
  return /* glsl */ `
#define GALE_PBR_LAYERS ${tier === 'high' ? 5 : tier === 'medium' ? 3 : 0}
struct PbrSurface { vec3 albedo; float height; float roughness; float ao; };
float pHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(.1031,.1030,.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float pNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(pHash(i),pHash(i+vec2(1,0)),f.x),mix(pHash(i+vec2(0,1)),pHash(i+1.0),f.x),f.y);
}
float pFiltered(vec2 p) {
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  return mix(pNoise(p),.5,smoothstep(.35,1.2,footprint));
}
float pFbm(vec2 p) {
  float v=0.0, a=.5, total=0.0;
  for(int i=0;i<GALE_PBR_LAYERS;i++) {
    v+=pFiltered(p)*a; total+=a; p=mat2(.8,-.6,.6,.8)*p*2.07+vec2(17.31,9.17); a*=.5;
  }
  return v/max(total,.001);
}
PbrSurface pMix(PbrSurface a,PbrSurface b,float w) {
  return PbrSurface(mix(a.albedo,b.albedo,w),mix(a.height,b.height,w),mix(a.roughness,b.roughness,w),mix(a.ao,b.ao,w));
}
// Actual relief changes layer dominance; the painted mask only supplies coverage.
float pHeightBlend(float coverage,float underHeight,float overHeight,float width) {
  return smoothstep(-width,width,(coverage-.5)*2.0+(overHeight-underHeight)*.65);
}
PbrSurface pStone(vec2 p) {
  // Metre-scale folds dominate. Small mineral detail is sparse and low amplitude.
  float large=pFbm(p*.46+81.7), middle=pFbm(p*1.85+vec2(large*.8,0));
  float small=pFiltered(p*11.0);
  float weather=smoothstep(.52,.72,pNoise(p*.73+19.0));
  float fissure=(1.0-smoothstep(.012,.052,abs(pNoise(p*vec2(.8,2.3))-.51)))*weather;
  float h=.22+large*.53+middle*.25+(small-.5)*.022-fissure*.095;
  vec3 hue=mix(vec3(.69,.79,.88),vec3(1.16,1.055,.86),large);
  vec3 albedo=hue*(.72+middle*.48)*(1.0-weather*.08-fissure*.045);
  return PbrSurface(albedo,h,.79+middle*.14+small*.035,1.0-fissure*.12-weather*.035);
}
${MASONRY_LAYOUT_GLSL}
PbrSurface pMasonry(vec2 p) {
  // Continuous domain warp bends courses; independent subdivisions break long grid lines.
  vec2 warp=vec2(pNoise(p*.61+5.0),pNoise(p*.74+29.0))-.5;
  vec2 q=p+warp*vec2(.15,.19);
  vec2 origin,span; float seed;
  pMasonryCell(q,origin,span,seed);
  vec2 local=q-origin, toEdge=min(local,span-local);
  float corner=min(span.x,span.y)*(.12+seed*.21);
  float edge=min(min(toEdge.x,toEdge.y),(toEdge.x+toEdge.y-corner)*.7071);
  float erosion=smoothstep(.5,.73,pNoise(p*4.3+seed*17.0));
  float chips=pFiltered(p*7.0)*.008+erosion*(.012+seed*.024);
  float joint=.012+seed*.025+pNoise(p*1.5)*.014;
  float bevel=.028+seed*.052;
  float aa=max(fwidth(edge),.001);
  float body=smoothstep(joint+chips-aa,joint+chips+bevel+aa,edge);
  vec2 shape=(local/span-.5)*1.35;
  float dome=sqrt(max(.02,1.0-dot(shape,shape)));
  PbrSurface stone=pStone(p*.85+vec2(seed*31.0,seed*13.0));
  stone.albedo*=mix(vec3(.76,.84,.94),vec3(1.21,1.115,.92),seed)*(.82+seed*.36);
  stone.height=.31+stone.height*.39+dome*.15+seed*.13-erosion*.025;
  stone.ao*=.94+.06*body;
  // Mortar is a continuous, shallowly eroded surface; depth varies with each stone's lift.
  float mortarWear=pNoise(p*1.7+47.0);
  PbrSurface mortar=PbrSurface(vec3(.55,.53,.47)*(.91+mortarWear*.18),.07+mortarWear*.045,.96,.76+mortarWear*.09);
  return pMix(mortar,stone,body);
}
// Street setts: the masonry bond at a quarter of the scale, worn smoother and paler on top.
PbrSurface pPaving(vec2 p) {
  PbrSurface s=pMasonry(p*2.4+vec2(pNoise(p*.21)*.6,0));
  float wear=pNoise(p*.35);
  // Warm limestone setts: undo the masonry's cool cast and lift them towards cream.
  s.albedo=mix(vec3(dot(s.albedo,vec3(.33))),s.albedo,.4)*vec3(1.42,1.3,1.08)*(.96+wear*.14);
  // Matt worn stone: little sky sheen at grazing angles.
  s.roughness=mix(.86,.95,wear);
  // Once a sett is smaller than a pixel or two, show the even worn tone instead of moire.
  float footprint=length(fwidth(p*2.4));
  float far=smoothstep(.12,.45,footprint);
  s.albedo=mix(s.albedo,vec3(.93,.86,.74)*(.96+wear*.1),far);
  s.height=mix(s.height,.4,far);
  return s;
}
PbrSurface pPlaster(vec2 p) {
  float broad=pNoise(p*.12), trowel=pFbm(p*3.2+vec2(0,pNoise(p*.5)*2.0));
  float pores=pFiltered(p*62.0), worn=smoothstep(.62,.8,pFbm(p*.75));
  return PbrSurface(vec3(.93,.92,.88)*(.88+trowel*.2-broad*.035-worn*.1),.42+trowel*.22-pores*.08-worn*.16,.88+pores*.1,1.0-worn*.15);
}
PbrSurface pWood(vec2 p) {
  float board=floor(p.x/.28), x=fract(p.x/.28);
  float seed=pHash(vec2(board,72.0));
  vec2 grainP=vec2(p.x*28.0+pNoise(vec2(p.y*.35,board))*3.0,p.y*.9);
  float grain=pFbm(grainP), annual=.5+.5*sin(grain*22.0+p.x*95.0);
  annual=mix(annual,.5,smoothstep(.25,1.0,fwidth(p.x*95.0)));
  float seam=1.0-smoothstep(.012,.045,min(x,1.0-x));
  vec2 knotP=vec2((x-.45)*2.8,(fract(p.y/3.7+seed)-.5)*9.0);
  float knot=exp(-dot(knotP,knotP)*2.5);
  float h=.42+grain*.25+annual*.06-seam*.24-knot*.1;
  return PbrSurface(mix(vec3(.78,.65,.49),vec3(1.13,1.03,.82),grain)*(.88+seed*.2)*(1.0-seam*.25-knot*.24),h,.7+grain*.22,1.0-seam*.25-knot*.12);
}
PbrSurface pRoof(vec2 p) {
  vec2 q=p*vec2(3.3,3.8); float row=floor(q.y); q.x+=pHash(vec2(row,4.0))*.28;
  vec2 id=floor(q), f=fract(q); float seed=pHash(id);
  float aa=max(fwidth(q.x),.002), rim=smoothstep(.02-aa,.09+aa,min(f.x,1.0-f.x));
  float overlap=smoothstep(.015,.12+fwidth(q.y),f.y);
  float roundness=sin(f.x*3.14159)*rim;
  float grit=pFbm(p*15.0), weather=pNoise(p*.2);
  return PbrSurface(mix(vec3(.79,.65,.53),vec3(1.1,1.03,.86),seed)*(.86+grit*.18-weather*.1)*(.72+.28*overlap),.18+roundness*.38+f.y*.17,.72+grit*.2,(.72+.28*overlap)*(.84+.16*rim));
}
PbrSurface pDirt(vec2 p) {
  float macro=pNoise(p*.19), earth=pFbm(p*4.0), grains=pFiltered(p*67.0);
  float pebble=smoothstep(.69,.82,pFiltered(p*17.0));
  float rut=1.0-smoothstep(.025,.13,abs(pFbm(p*vec2(.45,2.1))-.48));
  return PbrSurface(mix(vec3(.72,.61,.44),vec3(1.05,.94,.75),earth)*(.91+macro*.14+pebble*.13),.18+earth*.4+pebble*.22-rut*.09,.91-grains*.08-pebble*.14,1.0-rut*.15-(1.0-grains)*.05);
}
PbrSurface pMoss(vec2 p) {
  float clump=pFbm(p*6.0), fibers=pFiltered(p*85.0), macro=pNoise(p*.3);
  return PbrSurface(mix(vec3(.16,.22,.065),vec3(.43,.52,.19),clump)*(.85+macro*.3),.35+clump*.42+fibers*.08,.96, .79+clump*.2);
}
PbrSurface pCliff(vec2 p) {
  PbrSurface s=pStone(p*.7);
  float folded=p.y*.67+pFbm(p*.3)*2.5;
  float layers=.5+.5*sin(folded*6.28318);
  layers=mix(layers,.5,smoothstep(.3,1.0,fwidth(folded*6.28318)));
  float fault=1.0-smoothstep(.018,.075,abs(pFbm(p*vec2(1.7,.38))-.5));
  s.albedo*=vec3(.90,.95,1.02)*(.87+layers*.17-fault*.1);
  s.height+=layers*.12-fault*.22; s.ao*=1.0-fault*.29; return s;
}
vec3 pWeights(vec3 n) { vec3 w=pow(abs(n),vec3(6.0)); return w/max(dot(w,vec3(1.0)),.0001); }
// All three axes retain their world phase. No per-triangle or UV seams.
#define PBR_TRIPLANAR(F,P,W) pMix(pMix(F((P).zy),(F((P).xz)),(W).y/max((W).x+(W).y,.0001)),F((P).xy),(W).z)
vec3 pBumpNormal(vec3 n,vec3 viewPosition,float height) {
  vec3 dx=dFdx(viewPosition), dy=dFdy(viewPosition);
  vec3 r1=cross(dy,n), r2=cross(n,dx);
  float det=dot(dx,r1);
  return normalize(abs(det)*n-sign(det)*(dFdx(height)*r1+dFdy(height)*r2));
}
`;
}
