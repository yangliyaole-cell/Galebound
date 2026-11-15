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
  // The abbey, the gorge and the viaduct have their own palette. `clean` surfaces are kept
  // free of moss and damp; `minRough` lets polished stone and metal take a sheen.
  marble: { id: 9, label: '白大理石', relief: 0.012, clean: true, minRough: 0.26 },
  tile: { id: 10, label: '抛光地砖', relief: 0.01, clean: true, minRough: 0.14 },
  ashlar: { id: 11, label: '琢石', relief: 0.07 },
  slate: { id: 12, label: '蓝板岩瓦', relief: 0.06 },
  gilt: { id: 13, label: '鎏金', relief: 0.02, clean: true, minRough: 0.2, metal: 0.45 },
  bronze: { id: 14, label: '青铜', relief: 0.02, clean: true, minRough: 0.3, metal: 0.5 },
  fresco: { id: 15, label: '星空彩绘', relief: 0.01, clean: true },
  oak: { id: 16, label: '橡木', relief: 0.03, clean: true, minRough: 0.3 },
  velvet: { id: 17, label: '织物', relief: 0.015, clean: true },
  strata: { id: 18, label: '层状崖岩', relief: 0.19 },
  spanstone: { id: 19, label: '桥石', relief: 0.09 },
  // Town fronts of fired brick (the city's houses).
  brick: { id: 20, label: '砖墙', relief: 0.07 },
  townAshlar: { id: 21, label: '粗琢砂岩', relief: 0.12 },
} as const;
export interface PbrEntry { id: number; label: string; relief: number; clean?: boolean; minRough?: number; metal?: number }
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
// Fired brick in running bond. The vertex tint carries the clay colour, so the brick body stays
// near neutral (each brick a little lighter, darker, warmer or cooler) and the lime mortar is
// lifted against a red tint to read pale.
// The town's own stone: rusticated sandstone. Big cushioned blocks, each a little different in
// colour (honey, rose, grey buff), set back from deep chamfered joints that draw strong shadow
// lines, with pitched faces and a few lichen patches. The abbey keeps the smooth tooled limestone.
PbrSurface pTownAshlar(vec2 p) {
  float course=.56, row=floor(p.y/course);
  float len=mix(.9,1.5,pHash(vec2(row,7.0)));
  float x=p.x/len+pHash(vec2(row,13.0)), col=floor(x);
  vec2 f=vec2(fract(x)*len,fract(p.y/course)*course);
  float seed=pHash(vec2(col,row)+.37), shade=pHash(vec2(col,row)+5.1);
  vec2 e=min(f,vec2(len,course)-f); float edge=min(e.x,e.y);
  float aa=max(fwidth(edge),.0006);
  float joint=smoothstep(.006-aa,.014+aa,edge);
  float chamfer=smoothstep(.014-aa,.07+aa,edge);
  vec2 sh=(f/vec2(len,course)-.5)*2.0;
  float boss=sqrt(max(0.0,1.0-dot(sh*sh,vec2(.45,.7))));
  float pitch=pFbm(p*6.5+seed*19.0);
  vec3 hue=seed<.34?vec3(1.14,.98,.76):seed<.68?vec3(1.12,.86,.8):vec3(.9,.92,.94);
  vec3 albedo=hue*(.74+shade*.38)*(.88+pitch*.24);
  float lichen=smoothstep(.58,.76,pFbm(p*2.1+seed*7.0));
  albedo=mix(albedo,albedo*vec3(.82,.9,.74),lichen*.55);
  // The chamfer is cut back into shade; the joint itself is dark sandy mortar.
  albedo*=mix(.72,1.0,chamfer);
  albedo=mix(vec3(.52,.48,.42),albedo,joint);
  float height=mix(.02,.28+chamfer*.18+boss*.26+pitch*.14,joint);
  // Once a block is only a few pixels tall, settle to the wall's mean tone.
  float far=smoothstep(.06,.3,max(fwidth(p.x),fwidth(p.y))/course*4.0);
  albedo=mix(albedo,vec3(1.0,.93,.84)*.93,far);
  height=mix(height,.4,far);
  return PbrSurface(albedo,height,.84+pitch*.1,mix(.72,1.0,chamfer));
}
PbrSurface pBrick(vec2 p) {
  vec2 size=vec2(.29,.098);
  vec2 q=p/size; float row=floor(q.y);
  q.x+=fract(row*.5)+pHash(vec2(row,3.0))*.06;
  vec2 id=floor(q), f=fract(q); float seed=pHash(id+7.13);
  vec2 d=min(f,1.0-f)*size; float edge=min(d.x,d.y);
  float aa=max(fwidth(edge),.0004);
  float wear=pNoise(p*2.3+11.0);
  float joint=.0075+wear*.005+pFiltered(p*30.0)*.003;
  float body=smoothstep(joint-aa,joint+.007+aa,edge);
  float grit=pFiltered(p*48.0), clinker=step(.93,seed);
  vec3 tone=mix(vec3(.9,.97,1.05),vec3(1.08,.98,.9),pHash(id+1.7))*(.8+seed*.34)*(1.0-clinker*.38)*(.92+grit*.12);
  PbrSurface brick=PbrSurface(tone,.46+grit*.08+seed*.06-wear*.05,.78+grit*.14,1.0);
  PbrSurface mortar=PbrSurface(vec3(1.0,1.42,1.62)*(.8+wear*.1),.12+wear*.05,.95,.82);
  PbrSurface s=pMix(mortar,brick,body);
  // Courses finer than a couple of pixels settle to the wall's even tone.
  float far=smoothstep(.2,.7,length(fwidth(q)));
  s.albedo=mix(s.albedo,mix(mortar.albedo,vec3(.97),.86),far);
  s.height=mix(s.height,.42,far);
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
// ---- Cloudfall Abbey ------------------------------------------------------
// How much of a pixel a joint of half-width j covers at distance e from its centre line.
// A joint thinner than a pixel fades out instead of smearing its colour over the stone.
float pJoint(float e,float j,float aa) { return (1.0-smoothstep(j,j+aa,e))*clamp(j/(aa*.6+.0001),0.0,1.0); }
// White marble in large dressed blocks: hairline joints, grey and honey veins, a soft polish.
PbrSurface pMarble(vec2 p) {
  vec2 q=p/vec2(2.3,1.15); float row=floor(q.y); q.x+=mod(row,2.0)*.5+pHash(vec2(row,3.0))*.14;
  vec2 id=floor(q), f=fract(q); float seed=pHash(id+7.0);
  vec2 edge=min(f,1.0-f)*vec2(2.3,1.15);
  float aa=max(fwidth(p.x),fwidth(p.y))+.0015;
  float body=1.0-pJoint(min(edge.x,edge.y),.005,aa);
  vec2 w=p+seed*37.0;
  float warp=pFbm(w*.55), cloud=pFbm(w*1.7+11.0);
  float vein=1.0-smoothstep(.0,.07+fwidth(w.x)*3.0,abs(sin((w.x*.9+w.y*.35+warp*5.5)*3.14159)));
  float broad=1.0-smoothstep(.0,.38,abs(sin((w.x*.3-w.y*.7+warp*3.0)*3.14159)));
  vec3 base=mix(vec3(.9,.9,.9),vec3(1.03,1.01,.97),cloud)*(.97+seed*.06);
  vec3 veinTone=mix(vec3(.66,.69,.76),vec3(.86,.76,.58),pNoise(w*.4));
  vec3 albedo=mix(base,base*veinTone,vein*.55*smoothstep(.3,.6,cloud)+broad*.14);
  albedo*=mix(.86,1.0,body);
  return PbrSurface(albedo,.5*body+cloud*.04,mix(.62,.3+cloud*.12,body),mix(.86,1.0,body));
}
// Polished floor: pale and blue-grey squares, a gold lozenge where four meet.
PbrSurface pTile(vec2 p) {
  vec2 q=p/1.25; vec2 id=floor(q), f=fract(q);
  float check=mod(id.x+id.y,2.0), seed=pHash(id+3.0);
  vec2 e=min(f,1.0-f)*1.25; float aa=max(fwidth(p.x),fwidth(p.y))+.0015;
  float body=1.0-pJoint(min(e.x,e.y),.004,aa);
  float warp=pFbm(p*.8+seed*19.0);
  float vein=1.0-smoothstep(0.,.09+fwidth(p.x)*3.0,abs(sin((p.x*.8+p.y*.5+warp*5.0+seed*9.0)*3.14159)));
  vec3 albedo=mix(vec3(1.0,.99,.96),vec3(.6,.7,.86),check)*(.95+seed*.08);
  albedo=mix(albedo,albedo*mix(vec3(.74,.76,.82),vec3(1.3,1.25,1.2),check),vein*.4);
  float lozenge=abs(f.x-.5)+abs(f.y-.5);
  float gold=smoothstep(.9-aa,.9+aa,lozenge);
  albedo=mix(albedo,vec3(1.0,.74,.3),gold);
  albedo*=mix(.6,1.0,body);
  return PbrSurface(albedo,.5*body,mix(.6,.16+warp*.08+gold*.12,body),mix(.85,1.0,body));
}
// Dressed limestone: courses of uneven length, tooled faces, rain streaks.
PbrSurface pAshlar(vec2 p) {
  float course=.48, row=floor(p.y/course);
  float len=mix(.72,1.3,pHash(vec2(row,11.0)));
  float x=p.x/len+pHash(vec2(row,5.0)), col=floor(x);
  vec2 f=vec2(fract(x)*len,fract(p.y/course)*course);
  float seed=pHash(vec2(col,row));
  vec2 e=min(f,vec2(len,course)-f); float aa=max(fwidth(p.x),fwidth(p.y))+.0015;
  float body=1.0-pJoint(min(e.x,e.y),.011,aa);
  float tool=pFiltered(vec2(p.x*36.0+seed*9.0,p.y*6.0))*.5+pFbm(p*5.0)*.5;
  float streak=pFbm(vec2(p.x*.9,p.y*.2)+seed*3.0);
  vec3 albedo=mix(vec3(.84,.8,.72),vec3(1.04,1.0,.92),seed)*(.9+tool*.15)*(1.0-smoothstep(.55,.8,streak)*.17);
  albedo=mix(vec3(.58,.55,.49),albedo,body);
  float far=smoothstep(.06,.3,max(fwidth(p.x),fwidth(p.y)));
  albedo=mix(albedo,vec3(.94,.9,.82)*(1.0-smoothstep(.55,.8,streak)*.12),far);
  return PbrSurface(albedo,mix(.1,.42+tool*.12+seed*.1,body)*(1.0-far),.84+tool*.1,mix(.8,1.0,body));
}
// Slates in overlapping courses, each cleft a little differently.
PbrSurface pSlate(vec2 p) {
  vec2 q=p*vec2(3.4,2.9); float row=floor(q.y); q.x+=mod(row,2.0)*.5+pHash(vec2(row,2.0))*.12;
  vec2 id=floor(q), f=fract(q); float seed=pHash(id);
  float aa=max(fwidth(q.x),.003);
  float gap=smoothstep(.012-aa,.05+aa,min(f.x,1.0-f.x));
  float lap=smoothstep(.0,.15+fwidth(q.y),f.y);
  float cleave=pFbm(vec2(p.x*9.0+seed*7.0,p.y*28.0));
  float far=smoothstep(.25,.9,max(fwidth(q.x),fwidth(q.y)));
  vec3 albedo=mix(vec3(.74,.8,.9),vec3(1.06,1.08,1.1),seed)*(.86+cleave*.2)*mix((.68+.32*lap)*(.8+.2*gap),.9,far);
  return PbrSurface(albedo,(.2+f.y*.34*gap+cleave*.05)*(1.0-far),.46+cleave*.26,mix((.74+.26*lap)*(.85+.15*gap),.92,far));
}
// Gold leaf over gesso, faintly beaten.
PbrSurface pGilt(vec2 p) {
  float hammer=pFbm(p*13.0), fine=pFiltered(p*90.0);
  return PbrSurface(mix(vec3(.92,.86,.74),vec3(1.08,1.04,.96),hammer),.4+hammer*.2,.24+fine*.1+hammer*.1,1.0);
}
PbrSurface pBronze(vec2 p) {
  float tone=pFbm(p*6.0), fine=pFiltered(p*70.0);
  float verdigris=smoothstep(.6,.8,pFbm(p*2.3+9.0));
  vec3 albedo=mix(vec3(.84,.82,.78),vec3(1.1,1.04,.96),tone);
  albedo=mix(albedo,vec3(.6,1.25,1.3),verdigris*.3);
  return PbrSurface(albedo,.4+tone*.2,.36+fine*.14+verdigris*.3,1.0-verdigris*.1);
}
// Painted vault cells: a limewash of deep blue sown with gold stars.
PbrSurface pFresco(vec2 p) {
  float wash=pFbm(p*1.3), brush=pFbm(vec2(p.x*7.0,p.y*2.0));
  vec3 blue=mix(vec3(.82,.86,.9),vec3(1.12,1.1,1.06),wash)*(.92+brush*.16);
  vec2 q=p/1.2; vec2 id=floor(q), f=fract(q)-.5;
  float seed=pHash(id+13.0);
  f-=(vec2(pHash(id+1.0),pHash(id+2.0))-.5)*.5;
  float r=length(f), a=atan(f.y,f.x);
  float size=mix(.06,.14,seed);
  float star=r-size*(.38+.62*pow(abs(cos(a*4.0)),5.0));
  float aa=fwidth(r)+.003;
  float gold=(1.0-smoothstep(-aa,aa,star))*step(.28,seed)*(1.0-smoothstep(.2,.6,aa*8.0));
  return PbrSurface(mix(blue,vec3(4.4,2.3,.62),gold),.4+brush*.05+gold*.1,mix(.9,.42,gold),1.0);
}
// Old oak, waxed.
PbrSurface pOak(vec2 p) {
  PbrSurface s=pWood(p*vec2(1.25,1.0));
  s.albedo=mix(s.albedo,vec3(dot(s.albedo,vec3(.33))),.2)*vec3(1.02,.96,.9);
  s.roughness=s.roughness*.55+.14; return s;
}
// Wool and velvet: a fine weave and a nap that catches the light unevenly.
PbrSurface pVelvet(vec2 p) {
  float weave=pFiltered(vec2(p.x*150.0,p.y*38.0))*.5+pFiltered(vec2(p.x*38.0,p.y*150.0))*.5;
  float nap=pFbm(p*2.4);
  return PbrSurface(vec3(.88+nap*.2)*(.93+weave*.1),.4+weave*.12,.96,.95+.05*weave);
}
// ---- Cloudfall gorge and the viaduct --------------------------------------
// Bedded cliff rock: thick and thin beds, joints that step from bed to bed, ledges between.
PbrSurface pStrata(vec2 p) {
  float bend=pFbm(p*vec2(.05,.11))*2.6+pNoise(p*vec2(.21,.0)+3.0)*.5;
  float y=p.y*.55+bend;
  float bed=floor(y), fy=fract(y);
  float thick=pHash(vec2(bed,4.0));
  // Vertical joints, shifted in every bed.
  float jx=p.x*(.22+thick*.3)+pHash(vec2(bed,9.0))*7.0+pNoise(vec2(p.y*.35,bed))*.35;
  float block=floor(jx), fx=fract(jx);
  float seed=pHash(vec2(block,bed));
  float aa=max(fwidth(y),fwidth(jx))+.002;
  float bedJoint=1.0-smoothstep(.02,.06+aa,min(fy,1.0-fy));
  float crack=(1.0-smoothstep(.012,.04+aa,min(fx,1.0-fx)))*step(.25,thick);
  PbrSurface s=pStone(p*.6+seed*23.0);
  float ledge=smoothstep(.72,.98,fy)*(1.0-bedJoint);
  vec3 tone=mix(vec3(.74,.78,.86),vec3(1.12,1.04,.9),thick)*(.82+seed*.3);
  s.albedo*=tone*(1.0-bedJoint*.4-crack*.34);
  s.height=s.height*.5+.25+seed*.2+ledge*.16-bedJoint*.34-crack*.3;
  s.ao*=1.0-bedJoint*.34-crack*.25;
  float far=smoothstep(.4,1.4,aa*3.0);
  s.albedo=mix(s.albedo,tone*.86,far*.6); s.height=mix(s.height,.4,far);
  return s;
}
// Weathered bridge masonry: big squared blocks, lichen-stained, joints washed out.
PbrSurface pSpanstone(vec2 p) {
  float course=.62, row=floor(p.y/course);
  float len=mix(.9,1.7,pHash(vec2(row,21.0)));
  float x=p.x/len+pHash(vec2(row,15.0)), col=floor(x);
  vec2 f=vec2(fract(x)*len,fract(p.y/course)*course);
  float seed=pHash(vec2(col,row)+41.0);
  vec2 e=min(f,vec2(len,course)-f); float aa=max(fwidth(p.x),fwidth(p.y))+.002;
  float worn=pNoise(p*2.1+seed*9.0);
  float body=1.0-pJoint(min(e.x,e.y),.02+worn*.02,aa);
  PbrSurface s=pStone(p*.9+seed*17.0);
  float lichen=smoothstep(.56,.74,pFbm(p*1.6+seed*5.0));
  float run=smoothstep(.5,.8,pFbm(vec2(p.x*1.4,p.y*.16)));
  s.albedo*=mix(vec3(.8,.79,.76),vec3(1.1,1.04,.93),seed)*(1.0-run*.2);
  s.albedo=mix(s.albedo,s.albedo*vec3(1.05,1.1,.72),lichen*.4);
  PbrSurface mortar=PbrSurface(vec3(.5,.48,.43),.05,.97,.74);
  s.height=.3+s.height*.4+seed*.16;
  float far=smoothstep(.12,.5,max(fwidth(p.x),fwidth(p.y)));
  return pMix(mortar,s,body);
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
