# Galebound 线 D：参考图场景结构与地形

工作树 `/workspace/galebound-scenes`，分支 `detail-scenes-codex`，对比基线 `bc34fa7`。本线完成程序化场景接入及 CPU 验收；画面是否达到三张参考图的艺术标准，仍由操作员在沙箱外截图确认。没有启动 Chrome，没有修改、提交、合并或推送 Git 引用。

## 逐项对照三张参考图

| 差距项 | 开工时判断 | 本线结果 | 留给其他线 / 截图验收 |
| --- | --- | --- | --- |
| 1. 高崖上的高城、密集红瓦、最高处城堡、沿崖城墙及旁侧渡槽 | **已有** 360 栋城内住宅、五级居住台地、不规则城墙、宫殿和东侧渡槽；**需补** 出生点可见的大面积岩壁，原坡面过缓 | **已补** 城外南侧及两翼切坡，29 条断面形成陡壁，25m 水平距离内最大落差 medium/high 69.0m、low 67.5m。岩壁石材表皮沿实际高度图铺设，正面向外；道路留缝、再由原有道路整坡压平通路。城内 360 栋住宅、32.6m 居住台地高差、109m 宫殿地坪和既有渡槽保留 | 城墙/建筑高模归 B+C；石材与地形着色归 A。图 1 验证岩壁面积、城墙沿崖与城堡剪影 |
| 2. 雪山冰舌、大瀑布、云层、林崖峡谷与巨石急流 | **已有** 西部雪峰、四级高山湖和瀑布链；**需补** 具宽度和体积起伏的冰舌、主瀑布落差与峡谷两岸层次 | **已补** 北侧三座冰川角峰；地形最高 574.46m。蓝白冰舌横断面全宽 48/68/58/46/36/26m，沿地形起伏，含程序化裂隙顶点色。新增 216→116m 主瀑布，接回原水道及四级高山湖。新增圆润巨石急流、白浪、水雾、山腰云带与针叶林；low 去掉新增雾、白浪覆盖层和细碎花草 | 不改天空、灯光或风格预设。图 3 验证积雪边缘、冰体与瀑布的连续视觉、云带透明排序及岩林比例 |
| 3. 远峡谷长高架桥、左侧崖顶修道院与脚下瀑布 | **已有** 可进入修道院、64m 地坪和约 50m 的西侧瀑布；**需补** 峡谷长桥及更明确的修道院岩台 | **已补** 约 413m 的 15 跨高架桥，14 个真实拱洞，一跨作为实体接山桥台；桥面 130m，两端接入地形岩肩，桥墩落地。修道院西侧岩台/陡壁增强、瀑布口留缝，原脚下瀑布保留。桥墩、桥面、护栏和拱洞上缘注册碰撞 | 高架桥为远景结构，没有新增通往桥面的任务或道路。`abbey-space.ts` / `abbey-light.ts` / 教堂室内均未改。图 2 验证桥与修道院同框、拱列可读及桥台不悬空 |
| 4. 古拱门红纹章旗、苔石、矮墙、花丛、木栅栏、车辙路 | **已有** 普通旗布系统、出生点树木、散布小石和土路；**需补** 可构图的近景组合 | **已补** `(-39,70)` 道旁古石拱门，环拱楔石、苔色石材、藤叶、挂式红旗/金色纹章及缓动旗布。独立景观巨石使用连续坐标噪声位移的二十面体球、光滑椭球法线和朝上苔色，脚部埋入地形。补圆石干垒矮墙、随坡木栅栏、羽扇豆与雏菊。原土路两侧加入细微车辙土埂，保留原有道路数据和可走坡面 | 道路颜色/细纹理由 A 接管；未改 B+C 的石头散布。低档保留拱门、大石、矮墙与栅栏轮廓，去掉花瓣/藤叶/车辙细节。近景机位检查石头圆润度和土埂是否过于线性 |
| 5. 红瓦村、风车、烟囱、绿黄田块与树篱 | **已有** 河谷村、风车丘、四处山地石村与 12 块田；**需补** 全景里的村田层次及田界 | **已补** 两处小村共 11 栋红瓦房、一座额外风车及烟囱烟。新增 6 块外谷绿黄田块，复用 `FIELDS` 的着色、作物、围栏系统；按同一田块多边形放置有入口间隙的树篱。新增风车叶片随共享时钟旋转。low 保留田块涂层和村庄轮廓，省掉新增田块逐株作物 | 高档保留全部新增植物与细节。截图验证田块与村庄比例、风车完整叶片和烟源位置 |

本线没有完成材质/照明重制、建筑高模重制、逐像素参考图匹配或 GPU 帧时间实测；前两项属于其他线，后两项需要沙箱外浏览器。

## 改动文件与实现

既有文件仅做本线接入和局部数据修改：

- `src/world/heightmap.ts`：在湖盆/河槽切削之前调用 `referenceLandform`，随后继续原有道路整坡；扩大冰川水道塑形的查询范围。
- `src/world/layout.ts`：添加 6 块田地及可选 `Field.scenic` 标记，坐标均在地图内。
- `src/world/mountain-layout.ts`：将主瀑布与上游控制点接入现有 `ALPINE_STREAM` / `WATERFALLS`，扩大本地水位查询范围，保留全部原湖盆水位。
- `src/world/mountain-scenery.ts`：移除原窄冰线，接入完整参考图场景；低档去掉旧系统中的水雾/山腰小云，保留山村烟；局部合批山村细节。
- `src/world/flags.ts`：为旗布新增可选挂式布局、朝向和纹章图案；旧旗位默认行为保持。
- `src/world/structures/city.ts`：新增一个 import 和一个返回值包裹调用，合批城市细节。
- `src/world/structures/village.ts`：同样局部接入细节合批；low 省掉 `scenic` 田块的逐株作物。

新增场景文件（全部位于 `src/world/scenes/`）：

| 文件 | 用途 |
| --- | --- |
| `plan.ts` | 雪峰、冰舌、主瀑布、长桥、拱门、巨石与小村的共用坐标和分档数量 |
| `landform.ts` | 城外陡壁、修道院岩台、冰川峰、瀑布悬谷及桥台山体塑形 |
| `geometry.ts` | 圆润苔石、地表条带、占位检查数据 |
| `cliffs.ts` | 随高度图铺设的城外和修道院石材岩壁表皮 |
| `glacier.ts` | 起伏蓝白冰舌、裂隙顶点色与雪峰积雪面 |
| `viaduct.ts` | 参数化多拱桥、楔石、桥墩、护栏及碰撞 |
| `conifers.ts` | 独立的峡谷针叶林，不改共享 scatter/LOD；避开道路、水体、房屋和修道院 |
| `rapids.ts` | 急流巨石、流动白浪及瀑脚水雾种子 |
| `atmosphere.ts` | 合为一个实例批次的山腰云、水雾和新村烟囱烟 |
| `waygate.ts` | 古拱门、红旗、藤蔓、近景苔石、圆石矮墙、木栏和车辙土埂 |
| `meadow.ts` | 羽扇豆花序、雏菊花瓣与花茎 |
| `farmland.ts` | 田界树篱、两处红瓦小村、带动画的额外风车及烟源 |
| `batch-details.ts` | 以聚落和材质合并细节几何，保留所有顶点、原材质与距离渐隐；释放被替换几何的数据，保留旧注册项所需的包围球 |
| `index.ts` | 场景装配；远景与近景分批，以便近景花丛在朝城方向离开视锥时不继续提交 |

新增脚本：

- `scripts/check-scenes.mjs`：生产 TS/Three 几何和碰撞的 CPU 数值验收；仅对已有画布纹理绘制提供 Canvas 替身，不创建浏览器/WebGL。
- `scripts/scenes-metrics.mjs`：以实际档位的草、花、作物和散布密度计算视锥内主通道几何提交量；正确计入自定义 `InstancedBufferGeometry.instanceCount`。支持 `--root=/基线目录`、`--low`、`--high`、`--output=/输出.json`。

报告文件：`SCENES_REPORT.md`。

## 接入点与文件归属

场景调用链已经接通：原有 `buildLandmarks()` → `buildMountainScenery()` → `buildReferenceScenes(structureDetail())`。高度图则在 `analyticHeight()` 内调用 `referenceLandform()`。

**没有需要操作员手工补入禁改文件的接入行。** 未改 `main.ts`、`build.ts`、`scatter.ts`、`foliage.ts`、`structures/common.ts`、`house.ts`、`landmarks.ts`、`palace.ts`、`render/lod.ts`、`render/toon.ts`、`render/styles/*`、`render/pbr/*`、`textures.ts`、`terrain.ts`、`grass.ts`、`core/quality.ts`、`check-layout.mjs`、`detail-metrics.mjs` 或 `artifacts/`。使用已有 Builder、房屋、碰撞、旗布及共享时钟接口；没有新依赖或外部静态资产。

所有新增静态实体均通过 Builder 的既有材质名合批。流水和雾使用单独的透明批次；旗布复用既有旗布系统。medium/high 新增主体接收和投射阴影。high 的几何密度不受 medium/low 的三角形预算检查限制。

## 验收结果

| 检查 | 结果 |
| --- | --- |
| `npm run build` | PASS；TypeScript 与 Vite 均通过 |
| `node scripts/check-layout.mjs` | PASS，0 failed checks |
| `node scripts/check-layout.mjs --low` | PASS，0 failed checks |
| `node scripts/check-layout.mjs --high` | PASS，0 failed checks |
| `node scripts/check-scenes.mjs` | PASS，0 failed scene checks |
| `node scripts/check-scenes.mjs --low` | PASS，0 failed scene checks |
| `node scripts/check-scenes.mjs --high` | PASS，0 failed scene checks |
| `git diff --check` | PASS |

原有验收覆盖：出生点实际玩家起飞、两座城门及全部非桥道路、宫殿/瞭望塔/城墙楼梯、教堂门厅/中殿/横厅、出生点至修道院连续干路、桥梁/码头、四级湖水位、81 个光点、住宅避让、地形确定性。现最大道路中心线坡度约 0.735；宫殿楼梯最高支持面仍为 147m，修道院地坪仍为 64m。

新增验收覆盖：三档地形范围（low -14..568.62m；medium/high -14..574.46m）、150/310/880 处新增实体占位、地形边界内几何、主瀑布与水道相接、桥台落地、14 个开放拱洞、蓝白冰体颜色与向上三角面、拱门净空及近景拍照落脚点、分档数量和 medium/low 几何上限。

两次独立进程的 medium 新场景几何 SHA256 一致：`222b88cc6876b039983de44959bdf4e7436b3539afd28cd7917bb10b1c6d33d3`。

基线 medium 原有结构网格数量已超过 `check-layout` 的 90 个上限。聚落细节合批后，当前四类结构合计 low 51、medium/high 87 个网格；没有删掉细节顶点，也没有修改检查阈值。

## 性能与包体

| 档位 | 机位 | draw calls：基线 → 当前（变化） | 三角形：基线 → 当前（变化） |
| --- | --- | ---: | ---: |
| medium | spawn | 240 → 256（+16） | 1,181,216 → 1,674,644（+493,428） |
| medium | city | 127 → 150（+23） | 769,586 → 1,180,378（+410,792） |
| medium | aerial | 162 → 180（+18） | 904,974 → 1,495,272（+590,298） |
| low | spawn | 211 → 220（+9） | 728,748 → 760,406（+31,658） |
| low | city | 124 → 133（+9） | 498,774 → 525,688（+26,914） |
| low | aerial | 162 → 168（+6） | 581,924 → 608,294（+26,370） |

主 JS：**861,908 → 882,559 bytes（+20,651 bytes，约 +2.40%）**，远低于 3,000,000 bytes。独立 pipeline chunk 为 30,768 bytes。新增内容全部程序化生成，没有 public 资产增长或 npm 依赖增长。

分档新增场景规模：

| 档位 | 新针叶树 | 急流巨石 | 新花株 | 新房屋 | 新云/雾/烟实例 | 新场景网格 | 全部新增场景三角形 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| low | 48 | 22 | 0 | 11 | 0 | 10 | 21,054 |
| medium | 165 | 65 | 170 | 11 | 82 | 17 | 262,560 |
| high | 620 | 180 | 780 | 11 | 221 | 17 | 2,196,394 |

表中树、巨石和花通过合批几何构建，并非每株一条 draw call。low 另外省掉 6 块新增外谷田地的逐株作物，保留着色田块和围栏，避免低档作物实例膨胀。medium 启用花、树篱、完整外谷作物和水雾；high 使用更密的针叶林、花瓣、巨石及冰体网格，保持完整画质路径。

性能表为 **CPU 视锥内主通道提交估算**，不是 GPU 计时或最终 renderer.info：包括结构、城旗、地形、水、草花、作物、树石散布和生活角色；不包括天空、风粒子、阴影重复绘制和后处理。使用真实档位参数：low 草/花 7000/9000/1200、作物密度 0.4；medium 14000/20000/3000、作物密度 1。相机统一为 60° 竖直 FOV、16:9、0.1..1800 视距；三个视点依次为 `(0,40,100)→(0,85,-400)`、`(25,120,-245)→(0,145,-430)`、`(0,430,-160)→(0,100,-430)`。

基线在 `/tmp` 中按 `bc34fa7` 恢复原源文件，使用同一依赖和同一统计脚本；没有切换或改写工作树。统计复现：

```sh
node scripts/scenes-metrics.mjs
node scripts/scenes-metrics.mjs --low
node scripts/scenes-metrics.mjs --root=/path/to/bc34fa7-checkout
node scripts/scenes-metrics.mjs --low --root=/path/to/bc34fa7-checkout
```

## 沙箱外建议截图

以下均在运行站点根 URL 后添加参数；北为 -Z。`camyaw=0` 看北，正值转向西北，负值转向东北。`campitch` 负值抬头、正值俯视。`up` 是玩家初始抬升，截图模式会先固定模拟 90 帧，故实际冻结高度会下降一些。所有主图先用 high，再将 `q=high` 换为 medium/low 对照；画质判断以 high 为准。

| 对照 / 检查 | 玩家平面机位、朝向 | URL 参数 |
| --- | --- | --- |
| Image 1：出生点望城堡 | `(0,100)`，向东北偏北约 9° | `?autostart=1&shot=1&style=cinematic&q=high&x=0&z=100&camyaw=-0.16&campitch=0.02&dist=8.5&dr=0` |
| Image 2：城堡、修道院与长桥全景 | `(-130,80)`，向西北偏北约 12°，抬升俯瞰 | `?autostart=1&shot=1&style=cinematic&q=high&x=-130&z=80&up=100&camyaw=0.21&campitch=0.05&dist=8.5&dr=0` |
| Image 3：冰川峡谷主视图 | `(-480,-520)`，向西北约 40°，抬头看雪峰 | `?autostart=1&shot=1&style=cinematic&q=high&x=-480&z=-520&up=90&camyaw=0.70&campitch=-0.12&dist=8.5&dr=0` |
| 主瀑布与拱列近一些 | `(-590,-655)`，向西北约 52° | `?autostart=1&shot=1&style=cinematic&q=high&x=-590&z=-655&up=55&camyaw=0.90&campitch=-0.13&dist=6&dr=0` |
| 拱门红纹章旗、藤蔓、苔石 | `(-22,87)`，向西北 45° | `?autostart=1&shot=1&style=cinematic&q=high&x=-22&z=87&camyaw=0.785&campitch=-0.10&dist=6&dr=0` |
| 圆苔石、干垒矮墙、木栏和花 | `(75,70)`，向西北偏北约 32° | `?autostart=1&shot=1&style=cinematic&q=high&x=75&z=70&camyaw=0.55&campitch=0.14&dist=6&dr=0` |
| 西侧红瓦小村 | `(-220,-45)`，向西北约 47° | `?autostart=1&shot=1&style=cinematic&q=high&x=-220&z=-45&camyaw=0.82&campitch=0.04&dist=6&dr=0` |
| 东侧村庄、风车和烟 | `(367,-244)`，向东北约 40° | `?autostart=1&shot=1&style=cinematic&q=high&x=367&z=-244&camyaw=-0.70&campitch=-0.04&dist=6&dr=0` |
| 田块与有入口的树篱 | `(275,-210)`，向东北偏东约 69°，抬升俯视 | `?autostart=1&shot=1&style=cinematic&q=high&x=275&z=-210&up=65&camyaw=-1.20&campitch=0.18&dist=6&dr=0` |
| 修道院崖壁与脚下瀑布 | `(-700,-430)`，向东北约 45° | `?autostart=1&shot=1&style=cinematic&q=high&x=-700&z=-430&up=50&camyaw=-0.78&campitch=-0.20&dist=6&dr=0` |

外部截图重点：城前岩壁与道路接合处是否露缝；冰舌积雪是否出现地表穿插；远桥桥台/桥墩和水流是否连贯；透明水雾与山腰云排序；风车转动和旗布波动是否平滑；近景苔石是否圆润、花丛和干垒墙是否有足够体积。`shot=1` 冻结在共享时钟 12 秒，观察动画时去掉该参数并保留 `autostart=1`。
