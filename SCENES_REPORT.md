# Galebound 线 D：第 2 轮场景与捕获修复

基线 `70cc57a`（第 1 轮成果），工作树 `/workspace/galebound-scenes`。已读取操作员实拍 `scene-02.jpg`、`scene-03.jpg`、`scene-04.jpg` 并逐项修正。没有启动 Chrome、拍摄新截图、修改禁改文件或执行 Git 提交/合并/推送。**scene-02 的城堡、修道院、田野布局及相机参数保留。**

本轮交付是已接入、可构建且通过 CPU 检查的代码；最终画质和出生点 240 秒现象仍需操作员在浏览器中复拍确认。

## 本轮五项验收对照

| 目标 | 原有 / 问题 | 已补 | 没做 / 外部验收 |
| --- | --- | --- | --- |
| 1. 锐利冰川山脊、坡度雪线、有体积的冰舌与裂缝 | 已有三座新增主峰与冰舌，但峰体使用径向圆滑轮廓，冰纹由周期正弦产生，积雪片没有充分表达陡坡露岩 | 原始西部三座角峰及新增三峰改用不对称分片山脊；高度图加入倾斜岩层和不规则裂隙。冰川谷按纵断面刻入，保留冰斗上方尖峰；冰体呈凸起横断面，中央厚度约 8.5m，19 条独立裂缝具有不同长度、偏转和间距，最大凹入约 3.55m，蓝色随裂缝深度变化。删除原有周期人字纹。连续岩雪壳层按坡度和不规则雪线着色：陡面露岩、缓坡积雪 | 没有改地形材质或风格系统。实际岩雪对比、轮廓和裂隙可读性需 scene-03/04 复拍 |
| 2. 分层岩壁、垂直裂隙、棱角、坡脚碎石；石头贴地 | 已有随高度图铺设的薄岩壁表皮和河道圆石；原崖面呈圆滑湖盆壁，部分巨石被水位托在空中，共享散布的小石头铺满雪坡 | 湖盆/水道切削后增加岩层断阶与裂隙，保留水床和道路权威。新增 high 58 / medium 18 / low 5 处连入山体的分层岩柱及坡脚碎石。景观石按下半球多点地形求接触并埋入；急流石不再按水面抬高。岩雪壳层同时注册相应地表支持面，让原 scatter 的既有 surfaceTop 排除逻辑避开该壳层上的悬散小石；原 scatter 源码与 LOD 均未改 | 共享散布其他区域的几何仍归 B+C；本轮只处理冰川壳层和峡谷岩面覆盖区域。复拍检查碎石确实在坡脚、岩柱不呈孤立漂浮块 |
| 3. 粗壮石砌多拱桥 | 已有约 413m / 15 跨长桥，但 5.4m 桥墩承托近 120m 高差，单层拱列像细长柱 | 桥墩扩大到 **8.4m**，约为 27.54m 跨距的 **30.5%**；桥身深度增至 7.6m。低谷跨新增 **66m 标高的下层拱列和贯通腰带**；桥墩有加宽基座、高档错缝倒角石块和压顶，护栏补压顶。上层仍有 14 个开放拱洞、15 跨总轮廓，桥台位置和桥面 130m 标高保持 | 未新增通向高架桥的步行任务/道路。scene-04 检查上下拱列与墩体比例；scene-02 保持原机位作全景复核 |
| 4. 山腰云保留但主体清楚 | 原 mountain-scenery 和新 atmosphere 两套云雾叠加；high 的 110 个大卡片叠在中央，产生白色遮挡 | 旧批次仅保留山村烟囱烟，删除重复云/水雾。新云带分布到峡谷两翼，避开主瀑布中轴；云心降到 70–90m，卡片缩薄，按采样数归一化光学密度。瀑脚雾降到水面以上约 0.6–1.8m，每张半径 1.9–3.5m，high 35 张、medium 15 张，避免向上填满画幅。烟、雾、云使用显式种类属性 | 没有改全局雾和天空。复拍检查山腰云仍可见、冰舌和上层拱列清楚 |
| 5. 出生点 shot ready 超时 | 主循环先完成 90 次固定模拟，再等待 24 次完整冻结重绘才写 ready；仅 shader 回调写错误，boot Promise / 普通帧异常未覆盖。出生点高精度近景重复提交，是可疑耗时路径 | 从本线拥有的模块接入 capture-only 边界：保留原 90 次模拟和 high 配置，在 **2 次完整输出帧结束、GPU finish 成功后** 写 ready；构建用 RAF 不计入。捕获帧异常、资源 Promise 拒绝和 context lost，均写 `__galeShotError`。新增 `__galeShotStatus` 阶段/完成帧数、180 秒诊断看门狗，以及可选 `shotwarmup=24` 对照模式。普通游戏模式使用原 RAF。额外冻结风车原始 shader 钩子的引用，避免运行时风格包装被重复套用 | **没有实测 GPU，也不能在本沙箱确认原 240 秒事件的唯一根因或修复后实际秒数。** 已修复冗余等待和漏报异常路径；实际同机位复拍是最终验收。无需操作员向 main.ts 手工接入代码 |

### shot 修复依据与边界

已检查当前后处理：`RenderPass → ShaderPass → OutputPass`，没有 TAA、历史缓冲或跨帧积累。世界时间在 shot 中固定为 12 秒，90 次玩家/相机准备早于第一次绘制。因此没有图像算法要求必须重复绘制 24 次。当前改为等待两次完整最终输出，仍等待真实 `gl.finish()`，没有通过超时直接置位 ready，也没有关闭阴影、降分辨率或降低 high 几何。

该边界仅在 `shot=1` 时安装，捕获原 RAF 回调的结束点；只有本线场景实际进入绘制后才累计帧。完成后恢复原 RAF。主循环、渲染风格和质量档位文件均未修改。截图若失败，可直接读取：

```js
window.__galeShotReady
window.__galeShotError
window.__galeShotStatus // phase: building/rendering/ready/error; completedFrames; error
```

`shotwarmup=24` 可用于沙箱外比较长短预热的截图输出；默认值为 2。若未来后处理加入跨帧积累，应同步调整此预热约定。

## 改动文件与接入

| 文件 | 本轮工作 |
| --- | --- |
| `src/world/heightmap.ts` | 原西部角峰轮廓改为不对称棱脊；在湖盆切削后塑出岩层、裂隙，原道路整坡流程保留 |
| `src/world/mountain-scenery.ts` | 删除重复云/喷雾；导入并安装 capture-only 捕获边界 |
| `src/world/scenes/plan.ts` | 冰川纵断面标高；桥墩宽度、桥身深度、下层拱列标高 |
| `src/world/scenes/landform.ts` | 棱脊、冰斗、冰川谷刻入和岩层塑形 |
| `src/world/scenes/glacier.ts` | 连续岩雪壳层、坡度积雪、体积冰体、凹入裂缝；注册壳层地表支持面 |
| `src/world/scenes/geometry.ts` | 景观巨石多点贴地、埋入及接触数值记录 |
| `src/world/scenes/rapids.ts` | 急流石去掉水位托举；喷雾数量、尺寸、高度收紧 |
| `src/world/scenes/atmosphere.ts` | 云带移到两翼、降低高度和密度，按数量归一化；显式区分烟/雾/云 |
| `src/world/scenes/viaduct.ts` | 加粗桥墩、加宽桥身、下层拱列、腰带、基座、错缝倒角石块及护栏压顶 |
| `src/world/scenes/farmland.ts` | 固定风车材质原始编译钩子与缓存键，保留风格切换和转动 |
| `src/world/scenes/index.ts` | 接入岩柱/碎石和 shot 绘制观察，登记新增统计 |
| `scripts/check-scenes.mjs` | 补岩雪/裂缝/贴地/桥墩比例/雾位置检查；生产玩家和相机的 90 帧复演；新 scene-03 三座峰顶入画检查 |
| `SCENES_REPORT.md` | 本轮验收、性能、限制和重拍机位 |

新增文件：

- `src/world/scenes/geology.ts`：不对称峰体度量、岩层起伏、冰川纵断面、独立裂缝、雪线/坡度函数。
- `src/world/scenes/outcrops.ts`：连入崖体的层状岩柱、角砾碎石和碰撞。
- `src/world/scenes/shot-capture.ts`：可独立验证的捕获状态和 capture-only RAF 边界。
- `scripts/check-scene-shot.mjs`：无需 Chrome/WebGL 的生产捕获边界测试。

接入链仍是 `buildLandmarks → buildMountainScenery → buildReferenceScenes`。shot 边界从 `mountain-scenery.ts` 模块导入阶段安装，从新增场景网格观察实际绘制；**没有待手工合并进禁改文件的接入行**。

未改 `main.ts`、`render/styles/*`、`render/pbr/*`、`terrain.ts`、`grass.ts`、`core/quality.ts`、`build.ts`、`scatter.ts`、`foliage.ts`、`structures/common.ts`、`house.ts`、`landmarks.ts`、`palace.ts`、`render/lod.ts`、`render/toon.ts`、`textures.ts`、`check-layout.mjs`、`detail-metrics.mjs` 或 `artifacts/`。没有 npm 依赖或静态资产增长。新增几何继续通过 Builder 的既有材质名合批。

第 1 轮的城外高崖、360 栋高城住宅、城门/楼梯、修道院内部、近景古拱门红旗、木栏、花丛、田块和两处小村保留。本轮没有改城堡、修道院、村田和道路的总布局。

## 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run build` | PASS：TypeScript 与 Vite 构建通过 |
| `node scripts/check-layout.mjs` | PASS |
| `node scripts/check-layout.mjs --low` | PASS |
| `node scripts/check-layout.mjs --high` | PASS |
| `node scripts/check-scenes.mjs` | PASS |
| `node scripts/check-scenes.mjs --low` | PASS |
| `node scripts/check-scenes.mjs --high` | PASS |
| `node scripts/check-scene-shot.mjs` | PASS：6 项 |
| `git diff --check` | PASS |

原有布局检查覆盖：出生点真实玩家起飞、两城门、全部非桥道路、宫殿/城墙/瞭望塔楼梯、修道院入口/中殿/横厅、出生点至修道院干燥通路、桥/码头、四级湖本地水位、81 个光点、住宅避让、确定性。最大道路中心线坡度仍约 **0.735**；宫殿地坪 **109m**、修道院地坪 **64m**、宫殿楼梯顶面 **147m** 保持。

新增检查记录：

- 三座主峰均有明显法线转折；high 岩雪壳层有 **213,612** 个露岩顶点、**13,472** 个主要积雪顶点，陡面积雪违规顶点为 0。颜色统计仅针对岩雪壳层，不把冰体计为积雪。
- 19 条裂缝长度不等，数值最大凹入约 **3.55m**，不是只有颜色变化。
- high 记录 **647** 处景观石/碎石接触，均有埋入；新增实体足迹避开道路、出生点和修道院内部。
- 桥墩宽/跨距 **0.305**，下层拱列 **66m**，上层桥面 **130m**；桥台落地，上层 14 个开放拱洞。
- 云心不高于 **90m**、位于两翼；high **35** 张低位喷雾；没有中央巨幅云雾叠层。
- 出生点 90 帧生产物理/相机复演有限且不滑入几何：high/medium 玩家约 `(0,37.54,100)`，相机约 `(-1.35,39.16,108.38)`。
- 新 scene-03 机位复演后相机约 `(-415.69,108.67,-242.81)`，三座主峰尖顶均在投影视锥内。
- 捕获边界测试覆盖：构建 RAF 不误触 ready、两个完整输出帧后才 GPU flush/ready、24 帧对照选项、普通渲染异常、shader 回调错误、资源 Promise 拒绝、context lost、普通 autostart 不改 RAF。

两次独立进程的 medium 新场景几何 SHA256 相同：`13b984d79e719d4b7c01997c270d18ad0c72638d5ef86fc6a1fe9118e3c68892`。地形自身确定性同时由原布局脚本复建比较验证。

medium/low 预算没有放宽：本线场景网格上限仍为 **17 / 10**，三角形上限仍为 **320,000 / 30,000**；当前结构总网格 medium/high **87**、low **51**，原检查的 `<90` 上限保持。high 不做三角形预算裁剪。

## 性能和包体

| 档位 | 机位 | draw calls：第 1 轮 → 本轮（变化） | 三角形：第 1 轮 → 本轮（变化） |
| --- | --- | ---: | ---: |
| medium | spawn | 256 → 256（+0） | 1,674,644 → 1,714,626（+39,982） |
| medium | city | 150 → 150（+0） | 1,180,378 → 1,220,732（+40,354） |
| medium | aerial | 180 → 181（+1） | 1,495,272 → 1,537,374（+42,102） |
| low | spawn | 220 → 220（+0） | 760,406 → 763,788（+3,382） |
| low | city | 133 → 133（+0） | 525,688 → 529,442（+3,754） |
| low | aerial | 168 → 168（+0） | 608,294 → 611,784（+3,490） |

统计使用 `scripts/scenes-metrics.mjs`，与 `70cc57a` 的 `/tmp` 源码快照对比；没有切换或改写 Git 工作树。表为 **CPU 视锥内主通道几何提交估算**，包括结构、城旗、地形、水、草花、作物、树石散布和生活角色，正确计入自定义实例的 primitive 数。它不等于 GPU 时间或完整 renderer.info；不包含天空、玩家模型、风粒子、阴影重复绘制和后处理。草花/作物使用实际档位参数，保持第 1 轮统计口径。

三个统计机位是：spawn `(0,40,100)→(0,85,-400)`、city `(25,120,-245)→(0,145,-430)`、aerial `(0,430,-160)→(0,100,-430)`；60° 垂直 FOV、16:9、0.1..1800 视距。

| 档位 | 新增参考场景网格 | 场景三角形总量 | 针叶树 / 花株 | 层状岩柱 / 坡脚碎石 | 新云雾烟实例 |
| --- | ---: | ---: | ---: | ---: | ---: |
| low | 10 | 25,288 | 48 / 0 | 5 / 10 | 0 |
| medium | 17 | 303,334 | 165 / 170 | 18 / 72 | 62 |
| high | 17 | 2,523,620 | 620 / 780 | 58 / 463 | 156 |

所有档位保留 11 栋新增村屋和完整桥梁轮廓。high 使用最高岩雪网格密度、裂缝采样、错缝倒角石块、完整花瓣与岩柱碎石；medium 保留关键几何并使用较稀细节，low 保留轮廓和主要岩块、去掉新增雾/花/外谷逐株作物。减少 high 云层叠加是构图和光学密度修正，云采样数量仍为 110。

主 JS：**882,559 → 891,337 bytes（+8,778 bytes，约 +0.99%）**，小于 3,000,000 bytes。独立 pipeline chunk 仍为 30,768 bytes。

可复现性能统计：

```sh
node scripts/scenes-metrics.mjs
node scripts/scenes-metrics.mjs --low
node scripts/scenes-metrics.mjs --root=/path/to/70cc57a-checkout
node scripts/scenes-metrics.mjs --low --root=/path/to/70cc57a-checkout
```

## 沙箱外重拍 URL

以下都是相对于运行站点根地址的 URL；以 **q=high + cinematic** 为画质验收依据。`up` 是玩家初始抬升，截图冻结前仍会模拟 90 帧。默认 shot 预热 2 帧，可追加 `&shotwarmup=24` 做外部对照。

### 必拍

**scene-01：出生点 ready 回归、望向城堡**。原机位与朝向保持。记录 ready 用时，并在失败时附上 `__galeShotError` 和 `__galeShotStatus`。

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=0&z=100&camyaw=-0.16&campitch=0.02&dist=8.5&dr=0
```

**scene-03：冰川峡谷全貌**。本轮后退到 `(-420,-250)` 并抬升，使主峰尖顶、冰川和桥梁同时入画，避免旧近机位裁掉峰顶。

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=-420&z=-250&up=140&camyaw=0.54&campitch=-0.16&dist=8.5&dr=0
```

**scene-04：主瀑布、岩层和高架桥近景**。保留原机位，便于与问题截图直接对照，检查桥墩/腰带/上下拱列和谷底喷雾。

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=-590&z=-655&up=55&camyaw=0.90&campitch=-0.13&dist=6&dr=0
```

### 同机位复核

**scene-02：已认可的全景构图**。参数不变，复核新桥和山脊放回全景后的比例。

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=-130&z=80&up=100&camyaw=0.21&campitch=0.05&dist=8.5&dr=0
```

旧 scene-03 机位仍可作为材质/岩壁近距离对照：

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=-480&z=-520&up=90&camyaw=0.70&campitch=-0.12&dist=8.5&dr=0
```

近景苔石贴地复核：

```text
/?autostart=1&shot=1&style=cinematic&q=high&x=75&z=70&camyaw=0.55&campitch=0.14&dist=6&dr=0
```

对 scene-03/04 各补 medium/low 一张（只替换 `q`），确认轮廓保留及无悬空几何。外拍尚未完成，不能把 CPU PASS 当作已经达到 3A 艺术验收。
