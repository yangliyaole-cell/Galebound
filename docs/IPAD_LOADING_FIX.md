# iPad 加载修复记录

工作目录 `/workspace/gb-ipadfix`；未 commit/push，未改依赖、Vite base 或布局基线。

## 行为与文件

| 文件 | 目的 |
| --- | --- |
| `src/core/quality.ts` | 导出 `isIOSLike()`；识别传统 iOS UA 和 MacIntel + 多点触摸；自动 low；`mobileCap()` 派生 iOS 限额，不修改任何 TIERS 常量。 |
| `src/core/boot-guard.ts`（新增） | localStorage 启动哨兵，10 分钟有效；sessionStorage 会话降级与重试次数；明确选择的低档不会被旧会话提高；不覆盖已保存偏好；shot 模式完全禁用读写及重试。 |
| `src/main.ts` | 在每段建筑构建间让出主线程；使用异步建城；捕获 boot/渲染异常与 context loss；2.5 秒后降档重载；low 失败停止；首个可见渲染帧成功后才 ready/清哨兵；暴露 `window.__galeBootGuard`。 |
| `src/ui/hud.ts`、`index.html` | 标题页显示失败阶段、简短错误、当前画质、降档提示及重试按钮；显示 iOS 内存保护；面板应用新选择时清除旧恢复状态和 URL q。 |
| `src/world/structures/city.ts` | 同步和异步入口共用 generator，保持 RNG 和生成顺序；城市各阶段及每 8 栋房屋 yield。 |
| `src/world/build.ts` | 消费 box soup 后释放增长缓冲；合并后 dispose 源几何并及时清除引用。 |
| `src/world/scatter.ts` | 有真实森林渲染器时，不再构建未使用的旧树木高/中 LOD；保留碰撞所需元数据和岩石几何。 |
| `src/world/flora/tree-models.ts` | 树叶卡片直接预分配 typed array，避免普通 number 数组及转换副本，保持顶点/索引数值。 |
| `src/world/flora/forest.ts` | 释放图集捕获临时实例缓冲；low 捕获完成后 dispose 不再使用的近景卡片；iOS 的 low detail 使用 128 tile。 |
| `src/render/textures.ts` | 读回合成层后将临时 canvas 的宽高置零；实际纹理图像和需要 CPU 采样的数据仍保留。 |
| `src/render/target-type.ts`（新增）、`src/world/sky.ts`、`src/render/styles/pipeline.ts`、`src/render/pbr/lighting.ts` | 检查半浮点颜色附件扩展；天空、后处理及 bloom 降级 byte target；iOS 后处理禁用 MSAA；无支持时跳过依赖半浮点的 PMREM。支持扩展的桌面路径保持原样。 |
| `scripts/check-ios-boot.mjs`（新增） | 无浏览器检查设备识别、限额、TIERS 不变、哨兵、重试序列、存储拒绝、shot 隔离、颜色附件选择与失败 UI。 |
| `scripts/check-layout.mjs` | 增加 `--async`，使真实异步建城入口也接受原布局/碰撞/几何基线检查。 |
| `scripts/check-pbr.mjs` | 原 PMREM mock 补充“支持浮点颜色附件”的 renderer 扩展桩；仍验证原 56 项行为。 |
| `scripts/measure-boot-memory.mjs`（新增） | 用真实 Vite SSR 模块和 canvas/GPU 桩，逐阶段记录 heap、ArrayBuffer、RSS；支持 `--ios`。 |
| `scripts/check-ios-browser.mjs`（新增） | 可选 Chrome 集成复测：WebGL 不可用时逐档重试、shot 错误句柄、无浮点扩展、缺少 GLB、加载后 context loss。沙箱内无法执行，见下文。 |

iOS 内存保护保留手选档位名称，但所有档位的世界/建筑/森林/PBR 子系统细节封顶 low，cape low；pixelRatio ≤ 1、splat ≤ 1024、无阴影/AA/轮廓、草 5000/6000、花 800、terrainCell ≥ 8、terrainSplit ≤ 1.7、sky 1024、forest tile 128。原因是现有 medium/high 建筑内存已经超出移动预算，仅缩小纹理不足以兜底。面板明确说明此限制。非 iOS 的 high/ultra 参数未改。

英雄模型已有 `Character.installModel()` 的 try/catch：本地 `public/models/traveler.glb` 失败时保留程序生成的 classic 外形；无需修改。height/land 的 Float + Nearest 路径也无需改动。

## Node 内存测量

命令：

```sh
node --expose-gc scripts/measure-boot-memory.mjs medium
node --expose-gc scripts/measure-boot-memory.mjs high
node --expose-gc scripts/measure-boot-memory.mjs high --ios
```

本次记录单位为 MiB。canvas/GPU 是桩，不包含天空 raymarch、浏览器 canvas backing store、GPU 上传和英雄贴图；不是 Safari/WPE RSS。阶段末读数也不是函数内部采样峰值；GC/分配器会影响瞬时与 RSS 读数。

| 读数 | 原 medium | 原 high | 修改后桌面 high | 修改后 iOS（手选 high） |
| --- | ---: | ---: | ---: | ---: |
| 建城结束 ArrayBuffer（GC 前） | 921.0 | 1458.4 | 1474.8 | 278.8 |
| 全部测量阶段完成 ArrayBuffer（GC 后） | 728.7 | 1324.9 | 1320.7 | 224.6 |
| 全部测量阶段完成 JS heap（GC 后） | 166.9 | 166.8 | 166.8 | 161.5 |
| 全部测量阶段完成 Node RSS | 1948.8 | 2802.0 | 2680.4 | 1070.0 |

主要发现：成本最大的是建筑几何；high 在种树前已经保留约 1300 MiB ArrayBuffer。森林阶段还增加约 123 MiB JS heap，但在此 Node 测量中其 ArrayBuffer 增量只有约 22 MiB。因此不能把浏览器“种树/藏光点”时的 RSS 增量全部归因于树模型的 JS 数组：首批绘制上传、纹理及驱动分配也会发生在附近。iOS 限额将最终 ArrayBuffer 相对原 high 降低约 83%；不改变桌面画面的共享优化仅有较小收益，不能单独解决 iPad OOM。

## 验收

- `npm run build`：通过；仅 Vite 现有的大 chunk 提示。
- 修改前与修改后 `node scripts/check-layout.mjs`：均 0 失败；基线未改。
- `node scripts/check-layout.mjs --async` 及其 `--low`、`--high` 变体：全部 0 失败。
- `node scripts/check-controls.mjs`：修改前后均 0 失败。
- `node scripts/check-cape.mjs`：修改前后均通过。
- `node scripts/check-pbr.mjs`：修改前后均 56 项通过。
- `node scripts/check-grass-conform.mjs`：修改前后均通过，误差超过 5 cm 比例为 0%。
- `node scripts/check-tree-winding.mjs`：修改前后均通过。
- `node scripts/check-ios-boot.mjs`：14 项通过，不需要浏览器。
- `git diff --check`：通过。
- Chrome 集成受沙箱限制未运行成功：Vite `listen 127.0.0.1:5187` 返回 `EPERM`；独立 Chrome 启动也因 Crashpad socket `Operation not permitted` / SIGTRAP 退出。未提升权限。可在沙箱外运行 `node scripts/check-ios-browser.mjs`，使用已有外部 Playwright（支持 `PLAYWRIGHT_CORE` 环境变量）。

仍需在 iPadOS Safari / WebKit 上复测真实峰值 RSS、首帧和渲染目标兼容性；本次未声称完成实机内存验证。
