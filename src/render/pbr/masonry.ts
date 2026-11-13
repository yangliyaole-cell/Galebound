/** Irregular panel subdivision: long bond stones, squarer blocks and small packing stones.
 * CPU audit and GLSL implement the same deterministic partition.
 * Surface warping/chipping happens after this partition, so joints stay watertight.
 */
export function masonryCell(x: number, y: number, hash: (x: number, y: number) => number): { x: number; y: number; w: number; h: number; seed: number } {
  const band = Math.floor(y / 1.9);
  const split = .63 + hash(band, 15) * .62;
  const upper = y - band * 1.9 >= split ? 1 : 0;
  const row = band * 2 + upper;
  const rowY = band * 1.9 + upper * split;
  const rowH = upper ? 1.9 - split : split;
  const width = 2.2 + hash(row, 31) * .9;
  const phase = hash(row, 6) * 5;
  const q = x / width + phase;
  let column = Math.floor(q);
  let start = column + (hash(column, row) - .5) * .48;
  if (q < start) { column -= 1; start = column + (hash(column, row) - .5) * .48; }
  let end = column + 1 + (hash(column + 1, row) - .5) * .48;
  if (q > end) { column += 1; start = end; end = column + 1 + (hash(column + 1, row) - .5) * .48; }
  let loX = (start - phase) * width, hiX = (end - phase) * width;
  let loY = rowY, hiY = rowY + rowH;
  const parent = hash(column + 73, row + 29);
  let branch = 0;
  if (parent > .27) {
    const cutX = loX + (hiX - loX) * (.23 + hash(column + 91, row) * .49);
    if (x < cutX) { hiX = cutX; branch = 1; } else { loX = cutX; branch = 2; }
    const divide = hash(column + branch * 17, row + 83);
    if (divide > .38) {
      const cutY = loY + (hiY - loY) * (.25 + hash(column + branch * 31, row + 5) * .5);
      if (y < cutY) { hiY = cutY; branch = branch * 2 + 1; } else { loY = cutY; branch = branch * 2 + 2; }
    }
    // A short packing stone occupies only one corner, never an entire uniform course.
    if (divide > .8 && hiX - loX > .7) {
      const cut = loX + (hiX - loX) * (.2 + hash(column + 41, row) * .12);
      if (x < cut) { hiX = cut; branch += 11; } else { loX = cut; branch += 19; }
    }
  }
  return { x: loX, y: loY, w: hiX - loX, h: hiY - loY, seed: hash(column + branch * 23, row + 101) };
}

export const MASONRY_LAYOUT_GLSL = /* glsl */ `
void pMasonryCell(vec2 p, out vec2 origin, out vec2 span, out float seed) {
  float band=floor(p.y/1.9), split=.63+pHash(vec2(band,15.0))*.62;
  float upper=step(split,p.y-band*1.9), row=band*2.0+upper;
  float rowY=band*1.9+upper*split, rowH=mix(split,1.9-split,upper);
  float width=2.2+pHash(vec2(row,31.0))*.9, phase=pHash(vec2(row,6.0))*5.0;
  float q=p.x/width+phase, column=floor(q);
  float start=column+(pHash(vec2(column,row))-.5)*.48;
  if(q<start){column-=1.0;start=column+(pHash(vec2(column,row))-.5)*.48;}
  float end=column+1.0+(pHash(vec2(column+1.0,row))-.5)*.48;
  if(q>end){column+=1.0;start=end;end=column+1.0+(pHash(vec2(column+1.0,row))-.5)*.48;}
  vec2 lo=vec2((start-phase)*width,rowY), hi=vec2((end-phase)*width,rowY+rowH);
  float parent=pHash(vec2(column+73.0,row+29.0)), branch=0.0;
  if(parent>.27){
    float cutX=mix(lo.x,hi.x,.23+pHash(vec2(column+91.0,row))*.49);
    if(p.x<cutX){hi.x=cutX;branch=1.0;}else{lo.x=cutX;branch=2.0;}
    float divide=pHash(vec2(column+branch*17.0,row+83.0));
    if(divide>.38){
      float cutY=mix(lo.y,hi.y,.25+pHash(vec2(column+branch*31.0,row+5.0))*.5);
      if(p.y<cutY){hi.y=cutY;branch=branch*2.0+1.0;}else{lo.y=cutY;branch=branch*2.0+2.0;}
    }
    if(divide>.8 && hi.x-lo.x>.7){
      float cut=mix(lo.x,hi.x,.2+pHash(vec2(column+41.0,row))*.12);
      if(p.x<cut){hi.x=cut;branch+=11.0;}else{lo.x=cut;branch+=19.0;}
    }
  }
  origin=lo; span=hi-lo; seed=pHash(vec2(column+branch*23.0,row+101.0));
}
`;
