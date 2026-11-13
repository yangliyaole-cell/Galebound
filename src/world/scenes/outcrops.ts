import * as THREE from 'three';
import { Builder } from '../build';
import { addRound } from '../colliders';
import { roadClearance } from '../layout';
import { alpineChannel, waterLevelAt } from '../mountain-layout';
import { fbm, seededRandom } from '../noise';
import { sceneSolids, rockContacts } from './geometry';
import { builtHouses } from '../structures/house';
import { alpineHeight, alpineNormal, stableRockFooting } from './surface';

/** Continuous displaced bedrock replaces the detached facade columns. Only
 * debris with its entire lower hemisphere embedded in a stable toe survives. */
export function addCanyonOutcrops(b: Builder,detail:number): {buttresses:number;talus:number} {
  const rand=seededRandom(19841),target=detail===2?360:detail===1?60:10,normal=new THREE.Vector3();let talus=0;
  for(let attempt=0;talus<target&&attempt<target*100;attempt++){
    let x=-862+rand()*205,z=-816+rand()*325;const r=.45+rand()*1.1;
    for(let k=0;k<12;k++){
      alpineNormal(x,z,normal);if(normal.y>.84&&stableRockFooting(x,z,r))break;
      const len=Math.hypot(normal.x,normal.z)||1;
      x+=normal.x/len*3.5;z+=normal.z/len*3.5;
    }
    const h=alpineHeight(x,z);
    if(h<waterLevelAt(x,z)+.5||h>200||Math.abs(x)>1008||z< -850||z> -452)continue;
    if(alpineNormal(x,z,normal).y<.84||!stableRockFooting(x,z,r)||roadClearance(x,z)<r+3)continue;
    if(alpineChannel(x,z).distance<9||Math.hypot(x+600,z+495)<65)continue;
    if(builtHouses.some(house=>Math.hypot(house.spec.x-x,house.spec.z-z)<15))continue;
    const g=new THREE.DodecahedronGeometry(r,detail===2?1:0),p=g.attributes.position;
    for(let i=0;i<p.count;i++){
      const u=p.getX(i),v=p.getY(i),w=p.getZ(i),n=.84+fbm(u/r*2+x,w/r*2+v/r+z,2)*.3;
      p.setXYZ(i,u*n,v*n*.7,w*n);
    }
    let touch=Infinity;
    for(let i=0;i<p.count;i++)if(p.getY(i)<-r*.14)touch=Math.min(touch,alpineHeight(x+p.getX(i),z+p.getZ(i))-p.getY(i));
    const cy=touch-r*.05;let gap=-Infinity;
    for(let i=0;i<p.count;i++)if(p.getY(i)<-r*.14)gap=Math.max(gap,cy+p.getY(i)-alpineHeight(x+p.getX(i),z+p.getZ(i)));
    g.translate(x,cy,z);g.computeVertexNormals();b.add('plain',g,talus%3?0x898c81:0x6a767b,undefined,.14);
    rockContacts.push({x,z,gap});
    if(r>1.2){addRound(x,z,r,cy+r*.7);sceneSolids.push({kind:'talus',x,z,radius:r});}
    talus++;
  }
  return {buttresses:0,talus};
}
