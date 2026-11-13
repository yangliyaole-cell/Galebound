import * as THREE from 'three';
import { grid, heightAt } from '../heightmap';
import { fbm } from '../noise';
import { waterLevelAt } from '../mountain-layout';
import { ease } from './geology';

let detail = 1;
let renderedGrid: {nx:number;nz:number;heights:Float32Array} | undefined;
export function setAlpineSurfaceDetail(value: number): void { detail = value; renderedGrid=undefined; }
export function retainAlpineSurfaceGrid(nx:number,nz:number,heights:Float32Array):void { renderedGrid={nx,nz,heights}; }

const cubic = (a: number, b: number, c: number, d: number, t: number): number =>
  b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/** Bicubic reconstruction removes the four-metre collision mesh's diagonal planes. */
export function smoothGround(x: number, z: number): number {
  const {cell,n,data}=grid(), row=n+1, gx=(x+1024)/cell, gz=(z+1024)/cell;
  const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
  const at=(i:number,j:number):number=>data[Math.max(0,Math.min(n,j))*row+Math.max(0,Math.min(n,i))];
  const line=(j:number):number=>cubic(at(ix-1,j),at(ix,j),at(ix+1,j),at(ix+2,j),fx);
  return cubic(line(iz-1),line(iz),line(iz+1),line(iz+2),fz);
}

export function alpineEnvelope(x: number, z: number, h=heightAt(x,z)): number {
  const north=(1-ease(-741,-725,z))*ease(128,155,h);
  const canyon=ease(-905,-887,x)*(1-ease(-648,-633,x))*ease(-840,-825,z)*(1-ease(-466,-450,z))*ease(24,36,h);
  return Math.max(north,canyon)*ease(-1023,-1014,x)*(1-ease(-314,-302,x))*ease(-1023,-1014,z);
}

/** Shared by visible geology, its support surface, trees and grounded debris. */
export function alpineHeight(x: number, z: number): number {
  if(renderedGrid&&x>=-1018&&x<=-304&&z>=-1018&&z<=-452){
    const {nx,nz,heights}=renderedGrid,row=nx+1,gx=(x+1018)/714*nx,gz=(z+1018)/566*nz;
    const i=Math.min(nx-1,Math.floor(gx)),j=Math.min(nz-1,Math.floor(gz)),fx=gx-i,fz=gz-j,k=j*row+i;
    const a=heights[k],b=heights[k+1],c=heights[k+row],d=heights[k+row+1];
    return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
  }
  const h=heightAt(x,z), mask=alpineEnvelope(x,z,h);
  if(mask<=0)return h;
  const water=waterLevelAt(x,z), shore=ease(water+.5,water+5,h);
  if(shore===0)return h;
  const s=detail===2?1:detail===1?.58:.2, base=smoothGround(x,z);
  const warp=(fbm(x/43+31,z/49,3)-.5)*8;
  const drainage=Math.abs(fbm((x+warp)/8,z/48+9,3)-.5);
  const groove=(1-ease(.012,.11,drainage))*2.7;
  const bed=fbm(x/21+base/13,z/29-base/24,3);
  const macro=(fbm(x/29+7,z/35,4)-.5)*5;
  const chips=(fbm(x*1.1+base*.07,z*1.2,3)-.5)*.38;
  const concave=Math.max(0,(heightAt(x-8,z)+heightAt(x+8,z)+heightAt(x,z-8)+heightAt(x,z+8))*.25-h);
  const drift=ease(270,340,h)*ease(.1,1.8,concave)*1.1;
  const target=base+3.8+s*(macro+bed*2.2-groove+chips+drift);
  // Smooth maximum keeps the coarser terrain buried without a new hard edge.
  const lower=h+.24, d=target-lower;
  const shell=.5*(target+lower+Math.sqrt(d*d+.3));
  return h+(shell-h)*mask*shore;
}

export function alpineNormal(x: number,z: number,out: THREE.Vector3): THREE.Vector3 {
  const e=detail===2?.6:detail===1?1.4:3;
  return out.set(alpineHeight(x-e,z)-alpineHeight(x+e,z),2*e,alpineHeight(x,z-e)-alpineHeight(x,z+e)).normalize();
}

export function stableRockFooting(x:number,z:number,radius:number): boolean {
  const e=radius*.8,h=alpineHeight(x,z);
  const heights=[h,alpineHeight(x-e,z),alpineHeight(x+e,z),alpineHeight(x,z-e),alpineHeight(x,z+e)];
  return Math.max(...heights)-Math.min(...heights)<radius*.65;
}
