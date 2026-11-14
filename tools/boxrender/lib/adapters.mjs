// Per-check adaptations applied to a STAGED COPY of the script (see lib/stage.mjs); tracked repo files are never edited.
import { softChecks } from './stage.mjs';

/** check-pbr-shots.mjs still calls the pre-4km API `createTerrain()`; the world now needs a height texture + land maps. */
export const fixCreateTerrain = (src) => {
  const needle = "const terrain=(await load('world/terrain')).createTerrain();";
  if (!src.includes(needle)) return null;
  return src.replace(needle,
    "const heightTex=H.createHeightTexture(),landMaps=(await load('world/landmaps')).buildLandMaps(new THREE.Vector3(-.74,.62,.12));" +
    "const terrain=(await load('world/terrain')).createTerrain(heightTex,landMaps,2.5).object;");
};

export const ADAPTERS = {
  // Soft mode: report every failing sub-check instead of dying on the first (and never build a multi-GB assert diff, see safe-assert.mjs).
  'check-pbr.mjs': { note: 'soft mode: all sub-checks run, failures listed', transform: softChecks },
  'check-pbr-shots.mjs': { note: 'createTerrain(heightTex, landMaps, split) call adapted to the 4 km API', transform: fixCreateTerrain },
};
