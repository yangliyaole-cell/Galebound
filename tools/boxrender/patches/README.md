# Suggested repo-side changes (NOT applied)

`suggested-repo-hooks.patch` was generated against `aaa-world` at `394aeac`.
`git apply --check` succeeds on that commit, and `tsc --noEmit` succeeds on a patched scratch clone.
**It is not applied in this PR and should not be applied unless you choose to.** This PR only adds the tool under `tools/boxrender/`.

1. `src/main.ts`: shot mode accepts `?warm=N` (default stays 24) and `?once=1` (stops the render loop once the shot is ready).
   One rendered frame is bit-identical to 24 continuous frames, so a GPU-less box should use `warm=1&once=1`.
2. `scripts/check-pbr.mjs`: the grass sub-check used `assert.equal(<uniform object>, <uniform object>)`. When it fails, Node builds a diff of two
   objects holding multi-MB textures and allocates 12–13 GB, so the process is OOM-killed instead of printing the failure.
   Use `assert.ok(a === b, 'message')` for objects. The check itself also fails for a real reason (grass does not wire `uPbrContact`).
3. `scripts/check-pbr-shots.mjs`: `createTerrain()` → `createTerrain(heightTex, landMaps, split)` (4 km API).
   After this fix it still fails on `assert.ok(oldRock && oldRock.distance < .02)`: the script hard-codes the OLD world's coordinates
   (rock at 26.19,-322.55 and spawn rubble at 6,102; START is now 0,1250). It needs a rewrite for the new world, not a patch.

`setup-swap.sh.txt` is an optional, unapplied swap recipe for a machine with no swap. It is not required for shots (peak Chrome tree ~3.6 GB); the tool already kills itself before the kernel would.
