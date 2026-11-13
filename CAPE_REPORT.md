# 线 F：Galebound 软布料斗篷

## 第 2 轮：实拍故障根因与修复

### 修改前的证据（基线 `4479e78`）

用 Node 读取真实 traveler.glb、真实骨骼、4m 高度网格及 256 个 terrain mesh，执行与原 `main.ts` 相同的 `new Player → teleport(0,100,π) → Character.prepareCapeShot(run,3)`。修代码之前的现场输出：

```text
teleport 后 Player.pos = [0,37.539310455322266,100], Player.yaw = π
此时 Character.root.position = [0,0,0], root.rotation.y = 0
run / capet=3 后 root = [0,1.326584863662731,11.9]
camera = [1.8816740241503729,3.1265848636627314,8.83091172058578]
相机位置的 terrain 高度 = 18.266096436879423
cameraClearance = -15.13951157321669 米
实际斗篷顶点 world AABB：[-0.29996,18.88322,11.67706] → [0.32816,19.00829,12.07419]
可见场景内 SoftCloth mesh = 1；8,722 个顶点中，在相机视锥内的点 = 0
material.visible=true, opacity=1, transparent=false, side=DoubleSide(2), frustumCulled=false
terrain mesh = 256
```

**根因是预演入口没有把 Player 的 teleport 位姿同步给 Character，既忽略 URL 的出生点，也忽略朝向。** `teleport()` 只更新 Player.pos/yaw；正常 `Player.update()` 才会同步 Character.root。而 `shot=cape` 绕过了 Player.update，直接从世界原点、朝向 0 开始预演，把 `0 − heightAt(0,0)` 当作要保留的高度偏移。结果人物和相机都在地下：单面地形的背面不可见，草和树仍在真实地表，于是看起来像白灰虚空及悬空树。布料的地面碰撞却把斗篷投影到真实地面，导致斗篷距人物约 17 米、全部位于相机视野之外。

这排除了“世界根本没有生成”“斗篷未挂入场景”“透明材质”“frustumCulled 导致剔除”等猜测。旧 bounding box 确实没有刷新，第一次用默认 Box3 查询会得到过时的静息范围；上面的 AABB 是直接读取当前 BufferAttribute 顶点得出。bounds 本身不是这次消失的根因，因为 `frustumCulled` 已为 false。

同一构建的 `shot=1` 走 90 帧 Player.update，已同步根节点，因此能看到斗篷。该路径使用的是 `_SoftCloth` 新网格；原 `Traveler_Cape` 蒙皮网格一直隐藏，并非另一套旧斗篷。第一轮检查只直接摆放 Character，漏掉了 Player 与 Character 首帧同步这个集成前提；数值 PASS 没有证明实际入口正确。本轮增加直接使用 teleport 和生产入口的场景回归。

### 本轮修复文件

| 文件 | 修复 |
|---|---|
| `src/player/character.ts` | 新增 `prepareCapeShotFromPlayer`：在第一个预热/布料子步之前同步 pos/yaw，预演后回写 Player；固定镜头另加地面 0.6m 净空保护。新增共享 `inspectCapeShotScene`，审计场景挂接、当前顶点、面积、视锥、角色距离和相机高度。 |
| `src/player/hero-model.ts` | 每次 CPU 位移后更新 bounding box、bounding sphere，保留 `frustumCulled=false`、DoubleSide、原材质/UV、双层壁、纹样及原求解精度。 |
| `src/main.ts` | 改用上述生产入口；保留 terrain/grass 引用并标名，所有世界构造和 GLB 加载完成后才标记 worldBuilt。预演后先做场景审计，再等待 `renderer.compileAsync`；24 帧实际渲染后重审、`gl.finish()` 才置 ready。任何准备/着色器错误写入 `__galeShotError` 并保持 ready=false。 |
| `scripts/check-cape-scene.mjs`（新增） | 使用真实 GLB、骨架、Player.teleport、terrain、草层及 cinematic 材质处理，覆盖真实预演入口；只 stub Canvas 绘图，不创建 WebGL。 |
| `CAPE_REPORT.md` | 更新根因、证据、验收、性能、包体和复拍步骤。 |

没有修改控制器、世界生成、楼梯、画质配置、布料求解参数、GLB 或纹理。没有降低 high 精度。全部操作仅在本 worktree；没有提交、合并或推送。

### 场景检查与 ready 门槛

新增命令：`node scripts/check-cape-scene.mjs`。

- 重现未同步根节点的旧入口，断言审计必须拒绝“人物在地下、斗篷脱离人物、斗篷在视野之外”。
- high 覆盖 run 的 **1、1.3、2、3、4.5、4.6、4.8、5.2** 秒，以及 idle/3、jump/1.9/3.2、glide/2.7/4/5.6/6.2、turn/2.55/2.85，共 **17 个真实预演机位**。
- 每个机位检查 256 个 terrain mesh 已在可见 scene 中、三层草及高度/道路纹理存在；一个可见 SoftCloth、8,722 个有限顶点、有效三角形面积、最新 sphere 覆盖顶点、双面不透明材质、位于身体后方的衣片、身体穿透 <2mm、相机在实际地形上方。
- 通过相机射线检查斗篷能先于身体被击中，避免只测 `mesh.visible` 却实际被身体挡住；17 机位每次 96 个采样方向，**87–96 个直接看到斗篷**。
- medium/low 的真实地形滑翔预演通过；原 `shot=1` 的 90 帧准备和正常 Player.update 也检查到同一新 SoftCloth，并确认旧蒙皮 cape 隐藏。
- 负例检查：worldBuilt=false、移走 terrain、隐藏斗篷、相机放入地下时审计全部拒绝，不能宣告截图就绪。

本轮 `npm run build`、`check-cape.mjs`、`check-cape-scene.mjs`、`check-controls.mjs`、`check-layout.mjs`（默认、--low、--high）全部 PASS；layout 的实际出生点起飞、宫殿/旧塔楼梯及城墙楼梯检查继续通过。

17 个 high 机位全部 PASS：**8,722 / 8,722 顶点均在视锥内**，双层衣片总面积 **1.382–1.815m²**，相机地形净空 **1.058–4.200m**。例如 run/3 修复后人物 `(0,37.950,88.100)`、相机 `(-1.882,39.750,91.169)`，地面净空 **1.760m**；斗篷在躯干背面，96 个采样方向全部先命中斗篷。跑步急停后的衣片相对躯干前后分布持续变化，仍保留第一轮的惯性状态。

可在外部浏览器读取 `window.__galeShotState`：`worldBuilt`、`assetsReady`、`shadersReady`、`renderedFrames` 和 `scene` 审计结果。必须等 `window.__galeShotReady === true`，同时确认 `window.__galeShotError` 未设置。ready 现在表示已完成世界/模型构造、编译、场景审计和 24 帧渲染，不再仅表示经过 24 帧。

### 本轮复拍

先重拍同一组 run 的 8 张，URL 保持原样；再拍起跳、展开、稳态、收拢、转向和落地。以下链接可直接替换部署地址的查询部分：

- 稳态跑步：`/?shot=cape&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=run&capet=3`，把 capet 换成上述 8 个时间。
- 起跳：`/?shot=cape&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=jump&capet=1.9`；另拍 `capet=3.2` 落地。
- 滑翔：`/?shot=cape&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=glide&capet=4`；另拍 `capet=2.7` 展开、`5.6` 收拢、`6.2` 落地。
- 转向：`/?shot=cape&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=turn&capet=2.55`；另拍 `capet=2.85`。
- 原路径回归：`/?shot=1&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793`。

下方机位表现在与真实入口的 Node 结果吻合。沙箱没有运行 Chrome；上述检查证明场景、投影、遮挡、几何与就绪条件，**最终 SwiftShader 像素和 3A 艺术观感仍需外部复拍验收**。

## 交付范围

只修改斗篷所属文件，未改控制器、移动/滑翔判定、世界布局、碰撞注册、出生点或存档。未运行 Chrome，未截图，未提交、合并或推送。画面是否达到最终艺术标准，须由外部操作员按下列机位验收。

| 文件 | 改动 |
|---|---|
| `src/player/cape-sim.ts`（新增） | 不依赖 Three、DOM、WebGL 的确定性 Verlet 网格求解；UV 取样、距离/弯曲约束、双面气动力、骨骼胶囊碰撞、预演动作输入。 |
| `src/player/hero-model.ts` | 读取真实 GLB 的 UV/静息位置/Glide 形态；绑定布料网格；生成随骨骼移动的 11 个胶囊体；CPU 驱动双层渲染网格，重算法线；汇总统计。资源获取与 rig 适配分开，供 Node 使用真实资产检查。 |
| `src/player/character.ts` | 传入完整风向、速度、dt、地面高度；在姿态矩阵更新后求解布料；沿用平滑 capeGlide；固定步长动作预演和近景机位。 |
| `src/player/rig.ts` | 仅扩展斗篷更新接口和统计接口。 |
| `src/main.ts` | 局部接入画质档位、`shot=cape` 和 `window.__gale.capeStats()`；原 `shot=1` 保留原来的 90 帧准备与相机流程。 |
| `scripts/check-cape.mjs`（第一轮） | 不启动 WebGL，读取真实 GLB、真实骨骼和生产代码，检查三档动作、穿透、连续性、确定性与 CPU 耗时。 |
| `scripts/check-cape-scene.mjs`（第二轮新增） | 真实 teleport 到镜头、场景可见性、背部衣片、当前 bounds、地形与 ready 负例检查。 |
| `CAPE_REPORT.md` | 本报告。 |

`public/models/traveler.glb`、纹理和旧 `ClothStrip` 均未修改，没有新增依赖或资产下载。

## 算法

1. **参数化和渲染**：模型是 89×49 的连续衣片，含正反两层，共 8,722 顶点。按 UV 聚合同一衣片点的两层位置，取平均面，读取相同点的 Glide 位移，双线性采样到各档求解网格。high 保留原渲染网格和纹理；medium/low 重采样双层网格并封边，保持同一 UV 图案。
2. **软布料和惯性**：在世界空间维护当前位置/上一位置。仅固定领口中央及肩鞍区域；长前缘在垂挂时自由运动。横、纵向距离约束保持衣片连贯，交叉约束抵抗剪切，隔点弱约束形成柔软弯曲。重力、指数阻尼和低强度形状弹簧保持垂感。跑、停、跳和转向时，身体移动而布料保留速度；没有逐帧重置形状。
3. **风力**：每个三角形取当前面积和法线，计算相对气流（wind − wearer velocity − cloth relative velocity），按法线速度的带符号平方计算压力并按面积分摊，正反面受力一致；叠加固定解析相位的湍流，不用随机源。加速度和相对速度有稳定性上限。
4. **碰撞**：躯干、肩带、骨盆，以及两侧上臂/前臂/大腿/小腿，共 11 个胶囊体，取真实姿态关节的世界位置。俯身、侧倾、俯冲时仍有效。子步内插值目标与胶囊端点，距离求解与接触投影交替；交叠胶囊迭代投影，留 9 mm 接触余量。渲染顶点插值后再次逐点碰撞，避免求解网格之间漏检；地面也有高度投影。
5. **滑翔衔接**：沿用 Character 中 `1 − exp(−6 dt)` 的 capeGlide 平滑权重；Glide 只提供展开目标和连续变化的约束长度。飞行时逐步加强目标弹簧，前缘张开，内部仍可受风和惯性变形；收拢时减弱弹簧，保留布料历史状态。已加载 GLB 时始终使用同一个软斗篷，不在滑翔切入/切出时切换网格或旧布条；`hero=classic` 继续走已有 ClothStrip 简化路径。
6. **厚度与材质**：保留原 PBR 材质和衣片 UV，high 保留原 1.4 mm 双层壁及褶皱细节；每帧重算法线、bounding box 和 bounding sphere；双面显示、投射阴影。关闭旧 cape 的绘制，避免重复蒙皮和叠画。

这里没有衣片自碰撞或与全部场景三角形的通用布料碰撞；身体使用上述解剖胶囊，地面使用原高度函数。自动验收逐帧检查求解点及最终渲染顶点；最终褶皱观感、阴影及衣片之间的接触仍需截图确认。

## 档位与渲染成本

| 项 | low | medium | high |
|---|---:|---:|---:|
| 求解网格 | 13×9 | 25×15 | 45×25 |
| 求解点 | 117 | 375 | 1,125 |
| 距离/剪切/弯曲约束 | 594 | 2,052 | 6,402 |
| 每子步约束迭代 | 3 | 6 | 12 |
| 子步/帧 | 1 | 2 | 4 |
| 渲染顶点（含两层） | 750 | 2,250 | 8,722 |
| 斗篷三角形 | 1,496 | 4,496 | 17,440 |
| 斗篷 draw calls / 几何 pass | 1 | 1 | 1 |
| 相对原斗篷三角形变化 | −15,944 | −12,944 | 0 |
| 相对原斗篷 draw calls 变化 | 0 | 0 | 0 |
| 整个详细主角的可见 mesh 提交数 / 几何 pass | 21 | 21 | 21 |
| 整个详细主角三角形 / 几何 pass | 139,128 | 142,128 | 155,072 |

以上提交数和三角形由 Node 遍历实际可见几何得到，包含默认面具，不包含世界、后处理或额外阴影 pass。不是伪装成 GPU 实测的整场景 draw calls。外部需用 `await window.__gale.measure(120)` 获取特定机位/风格下的整场景 GPU 提交数据。

### Node CPU 数据

下表为第二轮重新单独运行 `check-cape.mjs` 的实测。固定 1/60 秒，真实骨骼、资产和生产布料代码，覆盖静止、奔跑急停、跳跃、滑翔收放、急转、强风；计时采样跳过前 30 帧。`simulationMs` 仅求解器；`updateMs` 含蒙皮目标、插值、渲染顶点碰撞与法线更新，不含 GPU。不同机器会变化，单次 p95 不代表浏览器帧率。

| 统计（ms/帧） | low | medium | high |
|---|---:|---:|---:|
| 纯模拟均值 | 0.133 | 1.009 | 10.228 |
| 纯模拟 p95 | 0.156 | 1.242 | 12.602 |
| 完整 CPU 更新均值 | 0.519 | 2.194 | 15.402 |
| 完整 CPU 更新 p95 | 0.621 | 2.655 | 18.642 |

三档实际检测到的最大身体穿透均为 **0 m**（断言阈值 0.002 m）；同时 yaw/bank/dive 的强风飞行检查也均为 0。六组动作中的相邻帧最大渲染顶点世界位移分别为 low 0.3313m、medium 0.3604m、high 0.3905m；滑翔序列分别为 0.2787m、0.2597m、0.2855m。这些包含身体自身的跑动、起跳和转向；全序列上限 0.40m，滑翔上限 0.30m。最大求解相对速度分别为 16.538、16.947、27.315m/s，均低于 28m/s 上限。

## 自动验收

| 验收项 | 状态与证据 |
|---|---|
| 软布料、惯性、风和自然可变褶皱 | 已补：Verlet + 结构/剪切/弱弯曲 + 面气动力；视觉观感待外部截图。 |
| 躯干、手臂、腿碰撞，覆盖滑翔旋转 | 已补：11 个世界空间胶囊，最终渲染顶点也投影；增加同时 yaw/bank/dive 的强风飞行检查。 |
| Glide 展开、收回连续 | 已有 capeGlide 平滑保留；已补连续目标弹簧与状态保留。每帧混合变化 ≤0.096；滑翔序列相邻帧最大顶点位移 <0.30m（含角色世界位移）。 |
| 三档精度 high > medium > low | 已补且 PASS，点、迭代和子步均分档。 |
| 确定性、有限位置、速度有界 | 已补且 PASS；同输入 positions/previous 逐元素精确相同，相对速度 ≤28m/s，dt=0 不推进。 |
| 最大身体穿透 <2mm | 已补；求解点和实际渲染点逐帧检查，详见最终检查输出。 |
| `shot=cape`、动作、时间与定帧 | 已补；固定步长、固定解析风、固定相机、完成后沿用 shot 冻结和 ready 标记；五种预设、up 偏移、无效镜头参数和重复 high/glide 截图数据均检查。 |
| `window.__gale.capeStats()` | 已补：tier、points、constraints、iterations、substeps、glideBlend、maxPenetration（米）、maxSpeed、simulationMs、updateMs、renderVertices、renderTriangles、drawCalls。 |
| `npm run build` | PASS；只有原有 Vite 大 chunk 提示。 |
| `node scripts/check-controls.mjs` | PASS，0 failed checks。 |
| `node scripts/check-layout.mjs` | PASS，0 failed checks。 |
| `node scripts/check-layout.mjs --low` | PASS，0 failed checks。 |
| `node scripts/check-layout.mjs --high` | PASS，0 failed checks。 |
| `node scripts/check-cape.mjs` | 第二轮重跑 PASS；18 组档位/动作、三档确定性、旋转飞行碰撞、预演和重复 high 定帧均通过。 |
| `node scripts/check-cape-scene.mjs` | 第二轮 PASS；17 个 high 机位、medium/low、shot=1、正常 Player.update、就绪失败负例全部通过。 |
| 出生点滑翔、楼梯、世界种子与几何不卡人 | 控制器和世界文件未改；已有 controls/layout 检查保持 PASS。实机出生点滑翔仍需外部沿原流程复查。 |
| 3A 艺术验收 | 未在沙箱截图；不得以数值 PASS 代替最终画面验收。 |

## 包体

软布料前基线主 JS **852,919 B**，第一轮 **867,492 B**，第二轮 **870,589 B**。本轮增加 **3,097 B（约 3.02 KiB）**，相对最初基线累计增加 **17,670 B**。独立 pipeline chunk 保持 **30,768 B**，全部 JS 合计 **901,357 B**；最大单个 JS **0.830 MiB**，小于 3,000,000 B。主 JS gzip 为 **245.05 kB**，比第一轮 243.90 kB 增加约 1.15 kB。

没有新增图片、模型、依赖或远端请求；7.5MB 的 traveler.glb 仍在 public/models/。仓库是 Vite 静态产物，本次未打包或部署 Cloudflare Worker；上述数值是实际 Vite 构建产物。

## 外部截图与动态序列

入口示例：

`/?shot=cape&autostart=1&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=glide&capet=3.4`

`capet` 四舍五入到 1/60 秒、范围 0–30 秒；先固定预热 1.5 秒，再从时间 0 推进同一动作序列。先等待 `window.__galeShotReady === true`，并确认 `window.__galeShotError` 未设置。同 capet 每次从同一初始状态重演，不累积刷新时间。`shot=1` 不解释 cape 动作参数，原冻结逻辑保留；正常游戏忽略这些预演参数。

固定镜头在原始朝向的侧后方，水平距离 3.6m，比角色原点高 1.8m，看向原点上方 0.95m，FOV 48°。默认 yaw=π，朝北；相机相对角色偏移约 **(−1.882, +1.800, +3.069)**，看向 **(0, +0.950, 0)**。可用 `capeangle`（弧度，默认 −0.55）换侧，`dist`（默认 3.6，范围 2.8–8）调距离。急转镜头保持原始方位，便于观察甩尾；需要重新观察转后的背面时加 `capeangle=2.12`。

| capemotion | 建议 capet 序列（秒） | 单张 URL 示例 |
|---|---|---|
| idle | 0、0.5、1、2、3、5 | `/?shot=cape&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=idle&capet=3` |
| run | 1、1.3、2、3、4.5、4.6、4.8、5.2 | `/?shot=cape&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=run&capet=4.6` |
| jump | 1.6、1.75、1.9、2.4、2.8、3.1、3.2、3.6 | `/?shot=cape&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=jump&capet=1.9` |
| glide | 1.9、2.1、2.5、2.6、2.7、2.85、3、3.4、4、5.3、5.4、5.55、5.8、6、6.2、6.6 | `/?shot=cape&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=glide&capet=4` |
| turn | 2.3、2.4、2.5、2.6、2.75、2.9、3.3 | `/?shot=cape&q=high&style=cinematic&x=0&z=100&yaw=3.141592653589793&capemotion=turn&capet=2.6` |

跑步从 t=1 加速，t=1.6 达 7m/s；t=4.5–4.66 急停。跳跃 t=1.7 起跳、t=2.4 顶点、t=3.1 着地。滑翔 t=2 起跳、t=2.6 展开、t=5.4 收拢、t=6 着地。急转在 t=2.4–2.78 转约 153°，保留真实世界空间甩尾。相同时间再拍前后相邻 1/60 秒，检查是否有褶皱闪变、接触跳变或图案折裂。

默认出生山坡 `(0,100)`、yaw=π、high/medium 的地形高度下，关键机位约如下（米）；low 地形采样略有差异，以运行时数据为准：

| 状态 | 角色位置 (x,y,z) | 角色 yaw | 相机位置 (x,y,z) | 看向 (x,y,z) |
|---|---|---:|---|---|
| idle / 3 | (0,37.539,100) | 3.142 | (−1.882,39.339,103.069) | (0,38.489,100) |
| run / 3 | (0,37.950,88.100) | 3.142 | (−1.882,39.750,91.169) | (0,38.900,88.100) |
| run / 4.6 急停 | (0,36.746,77.088) | 3.142 | (−1.882,38.546,80.157) | (0,37.696,77.088) |
| jump / 1.85 起跳 | (0,38.470,96.150) | 3.142 | (−1.882,40.270,99.219) | (0,39.420,96.150) |
| jump / 2.4 顶点 | (0,39.819,92.300) | 3.142 | (−1.882,41.619,95.369) | (0,40.769,92.300) |
| jump / 3.2 落地 | (0,37.863,86.749) | 3.142 | (−1.882,39.663,89.818) | (0,38.813,86.749) |
| glide / 2.75 展开 | (0,40.333,89.850) | 3.142 | (−1.882,42.133,92.919) | (0,41.283,89.850) |
| glide / 4 稳态 | (0,39.243,81.100) | 3.142 | (−1.882,41.043,84.169) | (0,40.193,81.100) |
| glide / 5.6 收拢 | (0,36.434,69.900) | 3.142 | (−1.882,38.234,72.969) | (0,37.384,69.900) |
| glide / 6.2 落地 | (0,34.453,66.027) | 3.142 | (−1.882,36.253,69.096) | (0,35.403,66.027) |
| turn / 2.55 转向中 | (−0.376,38.012,91.370) | 4.061 | (−2.258,39.812,94.439) | (−0.376,38.962,91.370) |
| turn / 2.85 转向后 | (−1.833,37.990,92.467) | 5.812 | (−3.715,39.790,95.536) | (−1.833,38.940,92.467) |

精确相机、target、预演原点、实际时间与朝向可从 `window.__gale.player.character.root.userData.capeShot` 读取。动作预演用于布料艺术复查，直接驱动 Character；不是替代正常控制器的出生点滑翔回归测试。

外部优先检查：领口固定是否自然、跑步/急停有无持续惯性、滑翔前缘是否展开到手臂附近、背部与腋下是否露出穿模、收拢是否连续、转向有无甩尾、纹样和 1.4mm 边缘是否保持完整、双面阴影有无闪变。再把同 URL 的 `q=high` 分别改成 `medium` 和 `low` 比较；最后拍原 `?shot=1&q=high&x=0&z=100` 并在正常游戏复测出生点滑翔。
