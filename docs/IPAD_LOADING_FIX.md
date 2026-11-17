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

## 第二轮（第一轮检查点之上）

已先阅读独立诊断 `/workspace/handoffs/galebound-ipad-diag/REPORT.md`。没有修改诊断目录或 `/workspace/gb_ipaddiag`，没有回退第一轮检查点。第一轮后的 WebKit 实测说明 low 本身仍离 jetsam 线过近，因此本轮直接处理建筑数据的生命周期。

### 文件与实现

| 文件 | 第二轮变更目的 |
| --- | --- |
| `src/world/build.ts` | 普通 `add()` 立即把变换后的属性写入有界 Soup，避免每块保留 BufferGeometry、toNonIndexed 副本和颜色数组。Soup 封块后精确复用 Float32 位模式相同的顶点，保留原三角形顺序。最终批次直接引用封块属性，仅拼接索引，避免再次分配全量顶点缓冲。异步城市在合并过程中按约 4 MiB 原始数据粒度让出执行权。 |
| `src/render/packed-attribute.ts`（新增） | 对 CPU 属性做逐位无损字典编码。值字典保留原始 IEEE Float32 位；编码比原数组更大时保留原数组。`getX/Y/Z` 支持 PBR、包围体和射线审查，不必展开整张属性。首次 WebGL `.array` 访问才生成标准 Float32Array，并丢弃编码副本；GPU、着色器和画质参数均不改变。 |
| `src/world/structures/city.ts`、`village.ts`、`hamlets.ts`、`batch-details.ts` | settlement 在 Builder 内直接完成按材质批次，跳过旧的 cell 几何再全量合并。城市使用同一 generator 的分帧合并步骤。通用非 Builder fallback 保留原先变换/clone 语义。 |
| `src/world/structures/city-streets.ts`、`palace-detail.ts` | 路面和宫殿墙面添加后还会重写颜色，改用显式 `addMutable()`。岩块也走该路径，保留 `seatRock()`、颗粒/苔藓涂色和碰撞支撑的既有行为。 |
| `src/render/static-upload.ts`（新增） | 只给最终 `structure-*` 和 `Settlement merged relief` 安装 onUpload 清理；先计算 boundingBox/boundingSphere，之后释放标准数组及编码副本。排除实例、蒙皮和 morph 网格。 |
| `src/main.ts` | 在 PBR 分类、全部合并和风格初始化之后安装静态上传清理；shot 模式不安装。普通启动也 await `compileAsync()` 后再进入首帧与 ready；它只准备程序，不强制上传远处 relief。保留房屋/街道/合并/修道院/高架之间的分帧。 |
| `src/core/boot-errors.ts`（新增） | 加载期间 window error / unhandledrejection 交给 failBoot；ready 后仅 console.error。 |
| `src/ui/quality-picker.ts`（新增）、`src/ui/hud.ts`、`index.html` | 把画质控制提取为标题页与游戏菜单共用的唯一实现，早于 Input/WebGL 初始化；加载中即可选档。应用时保存选择、清恢复状态、移除 q 并 reload。标签区分 URL / 已保存 / 自动。 |
| `scripts/check-ios-boot.mjs` | 扩展为 17 项，覆盖全局错误、标题/HUD 共用选择器、存储/恢复重置、URL 清理、标签来源及完整 mobileCap 对象。 |
| `scripts/check-static-upload.mjs`（新增） | 检查精确 Float32 编解码（含负零、字边界和不可压缩输入）、属性 clone、包围体、射线、PBR 分类；运行 Three r187 真实 WebGLAttributes 上传/缓存代码，验证上传字节、释放和再次绘制时的缓存行为。 |
| `scripts/measure-boot-memory.mjs` | 增加城市内部阶段、大 typed-array 分配与 yield 采样、异步入口、只读检查点源码加载及展开三角形属性 SHA-256；统计压缩属性用 cpuBytes，不主动展开。 |

没有引入预构建倒角盒模板：继续使用原 ExtrudeGeometry 计算，避免改变曲面、法线或 Float32 舍入；其临时数据写入 Soup 后立即丢弃。

### 内存对比

[完整阶段数据](IPAD_LOADING_ROUND2_MEMORY.json) 来自本轮开始时的第一轮检查点源码与最终实现。单位 MiB；以下每格为 **JS heap / ArrayBuffer**。`建城峰值` 两个分量分别取采样最大值，不保证出现在同一时刻；`合并结束` 为 merge lap 读数；`完成` 为相同世界构建流程末尾 GC 后读数。canvas 绘制、GPU 和英雄贴图为桩，不能换算成 Safari RSS。峰值是大数组分配与 yield 处记录到的最大值，可能漏过分配器内部瞬时峰值。Node heapUsed 不含 ArrayBuffer，与浏览器 performance.memory 的口径不同。

| 档位 / 版本 | buildCity 前 | 合并前（props 后） | 合并结束 | 建城采样峰值 | 完成、GC 后 |
| --- | ---: | ---: | ---: | ---: | ---: |
| low / 检查点 | 34.5 / 33.2 | 80.6 / 210.5 | 43.9 / 278.2 | 81.8 / 371.3 | 161.6 / 224.6 |
| low / 第二轮 | 34.0 / 24.9 | 89.5 / 91.5 | 42.0 / 85.5 | 89.5 / 102.2 | 162.9 / 96.1 |
| medium / 检查点 | 34.1 / 68.1 | 169.5 / 881.0 | 41.0 / 919.8 | 206.8 / 1075.2 | 166.9 / 727.1 |
| medium / 第二轮 | 36.9 / 54.1 | 92.2 / 367.7 | 50.3 / 278.9 | 125.2 / 398.9 | 172.2 / 295.7 |
| high / 检查点 | 35.1 / 170.9 | 160.1 / 1585.6 | 41.4 / 1474.8 | 220.5 / 1798.5 | 167.2 / 1320.7 |
| high / 第二轮 | 38.0 / 148.8 | 92.3 / 653.1 | 49.5 / 561.3 | 151.3 / 697.6 | 174.3 / 594.3 |

建城 ArrayBuffer 采样峰值：low **371.3 → 102.2（-72.5%）**，medium **1075.2 → 398.9（-62.9%）**，high **1798.5 → 697.6（-61.2%）**。medium 达到至少减半的目标；这不是把上传后的释放量混入建城数据，测量中没有真实 GPU 上传。三档城市的每个最终批次，按索引展开后的 position、normal、color 三角形序列 SHA-256 与检查点逐一一致（low 11、medium/high 17 个批次）。

无损编码增加启动 CPU 工作：同次 Node 记录建城约 low 1.46 → 1.78 s、medium 5.65 → 11.97 s、high 9.12 → 22.23 s。计时受并行任务及插桩影响，不能当作设备加载时间；内存换 CPU 是明确取舍，生成/合并期间持续让出执行权。游戏运行后不逐帧解码：可见属性首次上传时展开一次，随后使用 Three 缓存的 GL buffer。

### 释放 CPU 数组的安全边界

只释放最终 Builder 建筑网格：普通 `structure-*`（包括修道院/高架等）与最终 settlement relief 的静态属性/索引。安装清理前完成全部合并、包围体、PBR 自然石分类及初始风格设置。`colliders.ts` 存独立碰撞数据，FollowCamera 使用 solidAt，均不读这些渲染顶点；`updateStructureDetails()` 只读包围球；后续风格切换修改材质，PBR 分类有缓存。Three r187 不修改 attribute version 时直接复用已上传的 buffer/type/count，不读取已释放数组。contextlost 仍进入第一轮的失败/降档/整页重载流程。

本轮不释放地形、scatter/forest、角色/布料、实例或 morph 网格：它们可能共享缓冲、更新属性或被其他 CPU 逻辑读取。shot=1 / shot=cape 完全保留 CPU 数组，以支持截图工具的任意射线/几何审查。

注意：手动检查压缩几何的 `.array` 会按请求把它展开（例如诊断目录的原 breakdown.mjs），所以会改变尚未上传的远处几何的内存状态。统计保留字节应优先读取 `attribute.cpuBytes`，普通属性再读 `attribute.array?.byteLength`；没有修改那份只读诊断脚本。

### 复现命令

```sh
# 源码快照为只读对照；不需要 stash、checkout 或写 .git。
mkdir -p /tmp/galebound-round2-reference
git archive <第一轮检查点提交> src | tar -x -C /tmp/galebound-round2-reference
GALE_MEMORY_REFERENCE=/tmp/galebound-round2-reference node --expose-gc scripts/measure-boot-memory.mjs medium --checkpoint --geometry
node --expose-gc scripts/measure-boot-memory.mjs medium --geometry
# 同样替换为 low/high；--sync 可测同步入口，默认使用实际异步建城入口。
```

内存脚本对大 typed-array 构造（含 slice/species）和异步分段采样，补足第一轮只测函数返回值的盲区；因此本轮的“峰值”与第一轮表格的“结束值”不能直接混用。

### 第二轮最终验收

- `npm run build`：通过（仅原有大 chunk 提示）。
- `node scripts/check-layout.mjs`、`--low`、`--high`：全部 0 失败；基线文件未改。
- 异步路径：low/medium/high 均跑过；冻结源码后的 `--async --high` 再次 0 失败。
- `check-controls`、`check-cape`、`check-pbr`（56 项）、`check-grass-conform`、`check-tree-winding`、`check-ios-boot`（17 项）、`check-cape-scene`：全部通过。
- `node scripts/check-static-upload.mjs`：通过，包含编码/解码、bounds/raycast/PBR 与实际 Three 上传缓存检查。
- 三档城市展开三角形属性 SHA-256 与第一轮检查点一致；见内存 JSON 的 `expanded_geometry_hashes_match`。
- `git diff --check`：通过。未新增依赖，未修改 TIERS、Vite base、scripts/baselines 或其他 worktree；未 commit/push。
- GPU/浏览器限制沿用第一轮：此沙箱不能成功启动监听端口/Chrome，未把桩测试声称为 iPadOS Safari 实测。保留现有浏览器集成脚本用于沙箱外复测；真实首帧内存和 WebKit 兼容性仍需确认。
