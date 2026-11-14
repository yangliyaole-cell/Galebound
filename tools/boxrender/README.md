# boxrender — low-resource CPU render & check harness

**EN.** A self-contained screenshot and check tool for Galebound when there is no GPU PC (Chrome + SwiftShader on CPU). It points at any checkout; it never edits the checkout, never pushes, never deploys, and does not change the game's renderer. Builds go to `tools/boxrender/.cache/`, staged script copies to `.stage/`, shots and check summaries to `tools/boxrender/out/` (all gitignored).

**中文。** 这是给「没有显卡电脑」时用的截图和检查工具（Chrome + SwiftShader 走 CPU）。它只读取某个 Galebound 检出，**不会改游戏源码、不会改线上渲染、不会 push、不会部署**。玩家在网站上看到的画面与原来完全一样；变的只是截图和跑 `scripts/check-*.mjs` 的方式。

## Usage 用法

From the repo root 在仓库根目录：

```sh
# one screenshot (fresh Chrome per shot, memory-guarded; retries with smaller tiles after an OOM kill)
# 一张截图：每次新开浏览器，有内存守卫；OOM 后自动缩小 tile 重试
node tools/boxrender/shot.mjs --tier high --view spawn --mode final
node tools/boxrender/shot.mjs --tier high --view aerial
node tools/boxrender/shot.mjs --tier high --view city            # spawn aerial city abbey windmill lake plateau
node tools/boxrender/shot.mjs --eye 560,300,50 --target 560,160,-380 --tier medium
node tools/boxrender/shot.mjs --tier high --dpr 2 --tile auto     # 3200x1800, tiled
node tools/boxrender/shot.mjs --tier medium --mode preview        # labelled preview, see below
node tools/boxrender/shot.mjs --help

# every scripts/check-*.mjs, one isolated process each, with a memory guard and a summary
# 逐个跑检查脚本，进程隔离，带内存守卫和摘要
node tools/boxrender/run-checks.mjs [--only check-pbr] [--rss-limit 5000]

# which part of a frame costs what  看每一帧的 CPU 时间花在哪
node tools/boxrender/profile.mjs --tier high
```

Defaults 默认值：

- `--repo` — the Galebound repo that contains this tool (`../..`), or `$GALEBOUND_REPO`.
- `--out` — `tools/boxrender/out/<view>-<tier>-<mode>.png` plus a sibling `.json` (timings, peak RSS by process role).
- Needs Chrome (`CHROME_PATH` or `/usr/bin/google-chrome`) and `playwright-core` (`PLAYWRIGHT_CORE` or a normal node resolve).
- `lib/imgtool.py diff|sheet|heat` compares images (mean abs diff, PSNR, SSIM, % of pixels off).

## Frame gate 帧门

The game's shot mode keeps rendering for 24 frames and then loops forever; each SwiftShader frame is ~5 s (medium) to ~11 s (high). `lib/page.mjs` gates `requestAnimationFrame` after boot, so the game's own loop body runs only when `__boxStep(n)` is called. One frame is bit-identical to 24 (mean abs diff 0.0 against a 24-frame continuous render), so the default is 1 frame. A high shot is about 55 s, a medium shot about 30 s.

游戏的 shot 模式会连续画 24 帧然后一直循环。CPU 上每帧要 5–11 秒。帧门在启动完成后拦截 `requestAnimationFrame`，只有调用 `__boxStep(n)` 才真正画帧。1 帧与连续 24 帧的像素完全一致，所以默认只画 1 帧。

## Tiling 分块拼接

**Final mode** = the game's own pipeline at full size. If a frame would exceed `--max-tile-mpx` it is rendered in tiles with `camera.setViewOffset` and 40 css px of overlap, then stitched with PIL. Vignette / chromatic aberration use full-frame UV, and every `gl_FragCoord.xy` dither is shifted by the tile origin (a WebGL `shaderSource` hook in the browser only; the repo is not modified). CSM cascades are fitted once to the full frame and frozen; shadow maps are rendered once and reused. Tiled vs untiled: medium 1600×900 PSNR 68.6 dB, high 3200×1800 PSNR 66.1 dB; 0.001–0.003 % of pixels differ by >8/255. Tiling needs a post-processed style (cinematic etc.); the default style draws its vignette in CSS.

**Preview mode** is clearly labelled (`-preview`, `-preview-upscaled`). It is not much faster here (boot + first frame dominate). Prefer final mode.

最终模式用游戏自己的管线出全尺寸图；太大就自动切块再拼，观感与整张直出几乎一样。预览模式有文件名标记，这里省不了多少时间，构图检查再用。

## OOM guard 内存守卫

A virtio balloon can take RAM from the VM (MemAvailable has been 13 GB at times and about 3 GB at others). Every run samples the whole process tree and kills it before the kernel does (`--rss-limit`, `--min-avail`). After an OOM kill, `shot.mjs` retries with smaller tiles. Chrome itself peaked at 2.4 GB (medium) and 3.2–3.6 GB (high, incl. 3200×1800); it never OOMed in testing.

每次运行都会采样整个进程树的 RSS，超限或系统 MemAvailable 过低就先自杀，避免被内核 SIGKILL。截图在 OOM 后会自动用更小的 tile 重试。

## safe-assert

`check-pbr` was not killed by Chrome at all — it runs no browser. A failing `assert.equal(uniformA, uniformB)` made Node build a diff of two objects containing large textures (11.8 / 13.3 GB RSS) and the process was OOM-killed (exit 137). `lib/safe-assert.mjs` (loaded with `node --import`) makes failed asserts cheap, so the real failure is printed in ~0.5 s. `run-checks` uses it by default; `--no-safe-assert` shows the original blow-up (killed at the RSS limit).

`check-pbr` 并不开浏览器。失败的 `assert.equal` 会对比两个带大贴图的对象，Node 为了打印 diff 能吃掉 12–13 GB 然后被 OOM。`safe-assert` 让失败断言只抛一句短错误。

## Suggested patch (not applied) 建议补丁（未应用）

`patches/suggested-repo-hooks.patch` is a **suggestion for the other AI / maintainer, not applied in this PR**. See `patches/README.md`. It would add `?warm=N&once=1` in `main.ts`, switch the grass `assert.equal` in `check-pbr` to `assert.ok`, and fix the `createTerrain` call in `check-pbr-shots` (that script still needs a rewrite for the 4 km world). `patches/setup-swap.sh.txt` is an optional, unapplied swap recipe.

`patches/` 里的补丁和 swap 脚本都只是建议，**本 PR 没有把它们打进游戏源码**。

## run-checks adapters

Adapters (`lib/adapters.mjs`) run a staged copy: check-pbr in soft mode (all sub-checks listed), check-pbr-shots with the new `createTerrain` call. `--no-adapt` runs the originals. Tracked repo files are never edited.

适配器只改 `.stage/` 里的副本，不改仓库里的检查脚本。

## Where the CPU time goes (high, 1600×900, spawn)

first frame 24.6 s (one-time) | steady frame 11.0 s | trees/props 5.3 s | shadow pass 3.5–4.5 s | grass 2.4 s | quarter of the pixels −3.5 s | terrain 1.0 s. All stay at full fidelity in final mode; the only thing skipped is re-rendering identical shadow maps for tiles 2..N.
