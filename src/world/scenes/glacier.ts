import * as THREE from 'three';
import { Builder } from '../build';
import { heightAt } from '../heightmap';
import { fbm } from '../noise';
import { GLACIER_SPINE } from './plan';
import { ribbon } from './geometry';
import { ease, iceFracture, snowRetention } from './geology';
import { alpineHeight, alpineEnvelope, retainAlpineSurfaceGrid } from './surface';
import { waterLevelAt } from '../mountain-layout';
import { addBox } from '../colliders';

export const alpineSurfaceStats = { rockVertices: 0, snowVertices: 0, steepSnowVertices: 0 };

/** A sub-metre displaced high mesh with shared, continuously differentiated normals. */
function addAlpineSurface(b: Builder, detail: number): void {
  alpineSurfaceStats.rockVertices=0;alpineSurfaceStats.snowVertices=0;alpineSurfaceStats.steepSnowVertices=0;
  const step=detail===2?.75:detail===1?6:12, nx=Math.ceil(714/step),nz=Math.ceil(566/step),row=nx+1;
  const positions=new Float32Array(row*(nz+1)*3),heights=new Float32Array(row*(nz+1));
  const normals=new Float32Array(positions.length),colors=new Float32Array(positions.length),snowAmount=new Float32Array(row*(nz+1)),indices:number[]=[];
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const k=j*row+i,x=-1018+714*i/nx,z=-1018+566*j/nz;
    const h=alpineHeight(x,z);heights[k]=h;positions.set([x,h,z],k*3);
  }
  retainAlpineSurfaceGrid(nx,nz,heights);
  const sample=(i:number,j:number):number=>heights[Math.max(0,Math.min(nz,j))*row+Math.max(0,Math.min(nx,i))];
  const dx=714/nx,dz=566/nz,r=Math.max(1,Math.round(9/step));
  const rock=new THREE.Color(),warm=new THREE.Color(0xa49a83),cool=new THREE.Color(0x657c8c),snow=new THREE.Color(0xecf1ed),green=new THREE.Color(0x758653);
  const normal=new THREE.Vector3(),macroNormal=new THREE.Vector3();
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const k=j*row+i,x=positions[k*3],y=positions[k*3+1],z=positions[k*3+2];
    normal.set((sample(i-1,j)-sample(i+1,j))/dx,2,(sample(i,j-1)-sample(i,j+1))/dz).normalize();
    normals.set(normal.toArray(),k*3);
    macroNormal.set((sample(i-r,j)-sample(i+r,j))/(r*dx),2,(sample(i,j-r)-sample(i,j+r))/(r*dz)).normalize();
    const concavity=Math.max(-1,Math.min(1,((sample(i-r,j)+sample(i+r,j)+sample(i,j-r)+sample(i,j+r))*.25-y)/3));
    const band=fbm(x/17+y/11,z/23-y/29,3),grain=fbm(x*.8+y*.11,z*.9,2);
    rock.copy(cool).lerp(warm,band).multiplyScalar(.79+grain*.28);
    const meadow=(1-ease(100,165,y))*ease(.58,.92,macroNormal.y);
    rock.lerp(green,meadow*.82);
    const cover=snowRetention(x,y,z,macroNormal.y,macroNormal.z,concavity);
    snowAmount[k]=cover;
    if(alpineEnvelope(x,z)>.015&&y>waterLevelAt(x,z)+.5){
      if(cover<.2)alpineSurfaceStats.rockVertices++;
      if(cover>.8)alpineSurfaceStats.snowVertices++;
      if(macroNormal.y<.16&&cover>.1)alpineSurfaceStats.steepSnowVertices++;
    }
    rock.lerp(snow,cover);colors.set(rock.toArray(),k*3);
    if(i===nx||j===nz)continue;
    const x1=-1018+714*(i+.5)/nx,z1=-1018+566*(j+.5)/nz,h=heightAt(x1,z1);
    if(alpineEnvelope(x1,z1,h)<.015||h<waterLevelAt(x1,z1)+.5)continue;
    indices.push(k,k+row,k+1,k+1,k+row,k+row+1);
  }
  const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.BufferAttribute(positions,3));
  indexed.setAttribute('normal',new THREE.BufferAttribute(normals,3));indexed.setAttribute('color',new THREE.BufferAttribute(colors,3));indexed.setIndex(indices);
  if(detail===2)indexed.setAttribute('aSnow',new THREE.BufferAttribute(snowAmount,1));
  const g=indexed.toNonIndexed(),tint=g.attributes.color;indexed.dispose();b.add('plain',g,0xffffff);g.setAttribute('color',tint);
  addBox(-661,-874,357,144,0,(lx,lz)=>alpineHeight(-661+lx,-874+lz));
  addBox(-769,-636,136,184,0,(lx,lz)=>alpineHeight(-769+lx,-636+lz));
}

/** A domed body of ice with recessed, independently surveyed crevasses. */
export function addGlacier(b: Builder, detail: number, geology: Builder=b): void {
  addAlpineSurface(geology, detail);
  const curve = new THREE.CatmullRomCurve3(GLACIER_SPINE.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const count = detail === 2 ? 240 : detail === 1 ? 90 : 40;
  const points = curve.getPoints(count);
  const widths = points.map((_, i) => {
    const t = i / count * 5, k = Math.min(4, Math.floor(t));
    return THREE.MathUtils.lerp(GLACIER_SPINE[k][2], GLACIER_SPINE[k + 1][2], t - k);
  });
  const indexed = ribbon(points, widths, detail === 2 ? 64 : detail === 1 ? 18 : 8, (x, z, _t, u) => {
    const dome = (1 - u * u) * (detail === 0 ? 5 : 8.5);
    const fracture = iceFracture(x, z);
    return alpineHeight(x, z) + 0.4 + dome - fracture.depth * (1 - u * u);
  });
  const g = indexed.toNonIndexed(); indexed.dispose(); b.add('plain', g, 0xd8eef0);
  const p = g.attributes.position, colors = g.attributes.color, tint = new THREE.Color();
  const blue = new THREE.Color(0x377b9f), white = new THREE.Color(0xe3f0ee);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), fracture = iceFracture(x, z);
    const grain = fbm(x / 18 + 11, z / 21, 3);
    tint.copy(white).lerp(blue, Math.min(1, fracture.blue * 0.92 + grain * 0.13));
    colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
}
