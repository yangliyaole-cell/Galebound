import * as THREE from 'three';
import { Builder, place } from '../build';
import { seededRandom } from '../noise';
import { detailCounters, structureDetail } from '../structure-detail';

/** Broad splayed jambs, deep glazing, thick dressed frame and an inset sill. */
export function keepWindowDetail(b:Builder,x:number,y:number,z:number,rot:number,depth:number):void {
  const world=place(x,y,z,rot), half=.675, height=3.6, back=.01-depth;
  const quad=(points:number[][],color:number):void=>{
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([...points[0],...points[1],...points[2],...points[0],...points[2],...points[3]],3));geo.computeVertexNormals();b.add('plain',geo,color,world);
  };
  // Sloping surfaces catch different light even when the main facade is in shade.
  quad([[-half,0,.015],[-.49,.22,back],[-.49,height-.22,back],[-half,height,.015]],0xc5bca8);
  quad([[half,0,.015],[half,height,.015],[.49,height-.22,back],[.49,.22,back]],0xa7a394);
  quad([[-half,height,.015],[-.49,height-.22,back],[.49,height-.22,back],[half,height,.015]],0xb9ad95);
  quad([[-half,0,.015],[half,0,.015],[.49,.22,back],[-.49,.22,back]],0xe4d5b4);
  const box=(mat:'stone'|'wood',u:number,v:number,w:number,h:number,d:number,color:number,out:number):void=>{
    const p=new THREE.Vector3(u,v,out).applyMatrix4(world);
    b.box(mat,p.x,p.y,p.z,w,h,d,rot,color,.12);
  };
  for(const sign of [-1,1]) box('stone',sign*.81,-.16,.30,3.92,.18,0xeadfc7,-.04);
  box('stone',0,height,1.99,.29,.22,0xeee3cb,-.055);
  // A wide chamfered sill is carved into the wall, not into the stair walking width.
  const sill=new THREE.Matrix4().multiplyMatrices(world,new THREE.Matrix4().setPosition(0,-.13,-depth*.40));
  b.slab('stone',2.06,.25,depth*.8+.12,sill,0xe2d4b7);
  for(const sign of [-1,1]) box('stone',sign*.81,.62,.32,.14,.20,0xbdb29c,-.04);
  const glass=[0x6b8494,0x547185,0x4a667a,0x718898];
  for(let row=0;row<2;row++) for(let col=0;col<2;col++) {
    const p=new THREE.Vector3((col-.5)*.44,.29+row*1.5,back+.018).applyMatrix4(world);
    b.panel('plain',p.x,p.y,p.z,.42,1.43,.01,rot,glass[row*2+col]);
  }
  box('wood',0,.22,.105,3.15,.11,0xc7b899,back+.075);
  box('wood',0,1.78,.98,.105,.12,0xc7b899,back+.075);
  detailCounters.palaceReveals++;
}

/** True stone joints/relief over the round tower, independent of projected textures. */
export function palaceTowerMasonry(b:Builder,x:number,z:number,base:number,h:number,r:number):void {
  const high=structureDetail()>1, wallHeight=h-.9, rows=Math.ceil(wallHeight/(high ? .82 : 1.55)),cols=Math.ceil(2*Math.PI*r/(high?1.45:2.65));
  const rise=wallHeight/rows,step=2*Math.PI/cols,random=seededRandom(Math.round(x*13+z*27));
  b.cyl('plain',x,base,z,r*(1+.12*.9/h)+.019,r*1.12,wallHeight,0x999789,high?56:28,0);
  const vertices:number[]=[],colors:number[]=[],c=new THREE.Color();
  const point=(angle:number,y:number,out:number):number[]=>{const radius=Math.min(r*1.12,r*(1.12-.12*(y-base)/h)+out);return[x+Math.sin(angle)*radius,y,z+Math.cos(angle)*radius];};
  const quad=(a:number[],b:number[],d:number[],e:number[]):void=>{vertices.push(...a,...b,...d,...a,...d,...e);for(let k=0;k<6;k++)colors.push(c.r,c.g,c.b);};
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
    const a=(col+(row%2)*.5)*step+.018/r,end=a+step-.036/r;
    const y0=base+row*rise+.025,y1=base+(row+1)*rise-.025;
    let spans:[number,number][]=[[a,end]];
    if(y1>base+h-10.3 && y0<base+h-4.2) for(const axis of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
      const window=axis+Math.round(((a+end)/2-axis)/(2*Math.PI))*2*Math.PI,lo=window-.7/r,hi=window+.7/r;
      spans=spans.flatMap(([left,right])=>right<=lo||left>=hi?[[left,right] as [number,number]]:[...(left<lo?[[left,lo] as [number,number]]:[]),...(right>hi?[[hi,right] as [number,number]]:[])]);
    }
    const out=.07+random()*.035,bend=high?2:1,edge=.055;
    c.set(0xe3dac4).multiplyScalar(.86+random()*.16);
    for(const [left,right] of spans) {
    for(let k=0;k<bend;k++) {
      const a0=left+k*(right-left)/bend,a1=left+(k+1)*(right-left)/bend;
      quad(point(a0,y0+edge,out),point(a1,y0+edge,out),point(a1,y1-edge,out),point(a0,y1-edge,out));
      quad(point(a0,y0,.022),point(a1,y0,.022),point(a1,y0+edge,out),point(a0,y0+edge,out));
      quad(point(a0,y1-edge,out),point(a1,y1-edge,out),point(a1,y1,.022),point(a0,y1,.022));
    }
    quad(point(left,y0,.022),point(left,y0+edge,out),point(left,y1-edge,out),point(left,y1,.022));
    quad(point(right,y0+edge,out),point(right,y0,.022),point(right,y1,.022),point(right,y1-edge,out));
    detailCounters.palaceBlocks++;
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
  b.add('plain',geometry,0xffffff);
  // Retain per-block limestone variation after Builder has installed its standard attributes.
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}
