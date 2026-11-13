import * as THREE from 'three';
import { Builder } from '../build';
import { createFlags } from '../flags';
import { sceneDensity } from './plan';
import { addCliffFaces } from './cliffs';
import { addGlacier } from './glacier';
import { addViaduct } from './viaduct';
import { addCanyonConifers } from './conifers';
import { addWaygate } from './waygate';
import { addMeadowFlowers } from './meadow';
import { addFarmland, type AtmosphereSeed } from './farmland';
import { addRapids } from './rapids';
import { createValleyAtmosphere } from './atmosphere';
import { sceneSolids, rockContacts } from './geometry';
import { batchSettlementDetails } from './batch-details';
import { addCanyonOutcrops } from './outcrops';
import { observeShotDraws } from './shot-capture';
import { setAlpineSurfaceDetail } from './surface';
import { finishAlpineMaterial } from './rock-surface';

/** Called by the existing mountain scenery registration; no main/build ownership changes. */
export function buildReferenceScenes(detail: number): THREE.Group {
  const group = new THREE.Group(), b = new Builder(), near = new Builder(), density = sceneDensity(detail), mist: AtmosphereSeed[] = [];
  const geology=detail===2?new Builder():b;
  group.name = 'Reference landscape scenes'; sceneSolids.length = 0; rockContacts.length = 0;
  setAlpineSurfaceDetail(detail);
  addCliffFaces(b, detail); addGlacier(b, detail,geology); const arches = addViaduct(b, detail);
  const outcrops = addCanyonOutcrops(b, detail);
  const flags = addWaygate(near, detail);
  const trees = addCanyonConifers(b, detail, density.trees);
  const rocks = addRapids(b, group, detail, density.rapids, mist);
  const flowers = addMeadowFlowers(near, detail, density.flowers);
  const homes = addFarmland(b, group, detail, mist);
  group.add(b.build(detail > 0), near.build(detail > 0), createFlags(flags));
  if(detail===2){const mantle=geology.build(true);finishAlpineMaterial(mantle);group.add(mantle);}
  const atmosphere = createValleyAtmosphere(mist, density.clouds); if (atmosphere) group.add(atmosphere);
  group.userData.sceneCounts = { trees, rocks, flowers, homes, arches, ...outcrops, atmosphericInstances: atmosphere?.geometry.instanceCount ?? 0 };
  batchSettlementDetails(group); observeShotDraws(group); return group;
}
