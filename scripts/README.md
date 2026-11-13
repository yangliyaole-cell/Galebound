# 操作与镜头回归检查

```sh
npm ci --offline --no-audit --no-fund
node scripts/check-controls.mjs
npm run build
```

离线安装需要已有 npm 缓存。脚本只使用 Node 和项目已有的 Vite / Three.js：Vite 以无监听端口的 middleware 模式加载实际 TypeScript 类，DOM 小型桩用于回放事件，不创建 WebGL 上下文，不联网、不新增依赖。

## 翻转复现

原输入直接执行 `lookX += movementX * 0.0026`，没有事件检查或整帧限制。鼠标轨迹 `(2,0), (1200,0), (0,-900), (3,2), (-1200,0), (1,0)` 中，一次 1200px 的坐标突变就会改变 yaw 约 179°；pitch 为 0.2 时，实际相机前向的最大角差为 157.05°。100 次正常的 12px 事件堆在一帧也有相同结果。

修复前直接运行脚本，锁定鼠标轨迹和事件堆积两项均报 `157.05 degrees` 并失败。修复后仍用冻结的旧增量公式回放相同轨迹，验证旧逻辑确实出现超过 150° 的方向跳变；再经实际 Input 和 FollowCamera 回放并断言修复效果。比较的是实际 Three.js 相机前向向量角差，不是易受 ±π 回绕影响的 yaw 数值差。

当前输出摘要：

```text
Legacy unfiltered mouse trace max = 157.05 degrees
mouse trace max = 0.53 degrees
event burst max = 19.65 degrees
gamepad 5s stall = 8.87 degrees
PASS: 0 failed checks
```

事件大于 1.5rad（鼠标约 577px、触摸约 288px）作为坐标突变丢弃；整帧增量向量最多 0.35rad（约 20°），多余量不留到下一帧。事件阈值留出快速拖动的余量，较快的正常输入仍由整帧上限保护。正常小增量保留原灵敏度。锁定切换后的首事件丢弃；未锁定拖动使用 client 坐标；捏合退回单指的首事件只重建坐标基准。

其他检查覆盖：正常灵敏度、NaN/Infinity、左右触摸角色隔离、多指捏合、pointerId 复用、取消/丢失捕获、失焦/隐藏清理、非零槽位标准手柄、连续死区、跳跃边沿与重连、dt 上限、镜头参数有效范围、滑翔手动操作优先、自动跟随跨 ±π、首采样碰撞收缩、水面钳制和四个象限的移动方向。

原有自动跟随已经使用最短角差，主循环已有 50ms dt 上限。有效 pitch 下，相机距离始终为正；碰撞收缩沿同一射线，不会跨过目标。因此没有重写碰撞与 lookAt，也没有给 x/z 增加跟随延迟。

## 验证边界

这是事件与数值回归，不替代真实手机、手柄和 Chrome pointer lock 的手感测试。当前执行环境尝试 Playwright / Chrome 实测时，Chrome 启动被沙箱的 `setsockopt: Operation not permitted` 阻止。

`vite.config.ts` 的 `base` 保持 `/`，构建资源为 `/assets/...`。离线 `npm ci` 和构建均成功；Vite 仍有大于 500kB 的已有体积提示。碰撞安全所需的距离立即收缩可能仍有位置上的跳近；非标准映射手柄需要专门适配。这些不扩展到本次修复。

## 渲染风格截图

先另行启动 `npm run dev -- --host 0.0.0.0 --port 5199`（或同端口 preview），在可运行 Chrome 的环境执行：

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
CHROME_PATH=/usr/bin/google-chrome \
node scripts/capture-styles.mjs --base-url http://localhost:5199 \
  --out /workspace/handoffs/galebound-styles \
  --styles default,ghibli,cinematic,watercolor,lowpoly-dusk
```

无需修改项目依赖；若外部环境可直接解析 `playwright-core`，可省略 `PLAYWRIGHT_CORE`。三个脚本选项均可省略，默认值如上。每个风格输出同名 PNG，`perf.json` 记录 60 帧平均渲染毫秒（每帧用 `gl.readPixels` 读取 1 像素同步后计时）、rAF 毫秒、整条渲染链 calls/triangles、`extraPasses` 和像素比。SwiftShader 数据只用于粗略比较，不能代表集显或独显性能。

游戏中按 **V** 循环风格；`?style=default|ghibli|cinematic|watercolor|lowpoly-dusk` 指定初始风格，非法值回到 default。`effects=0` 关闭电影风格的采样泛光和深度 AO（low 档自动关闭）；各风格额外 2 个全屏 pass，使用 MSAA 离屏目标保留抗锯齿，默认额外 0 pass。`window.__gale.style.current` / `await window.__gale.style.set('ghibli')` 可调试切换。

`shot=1` 隐藏 HUD/标题/标签等 DOM，忽略存档位置与已收集光点，用固定随机种子、12 秒 shader 时间、平静风和固定准备步骤冻结世界，不启用动态分辨率。默认相机朝北偏东看向城镇，距离 8.5，可用原有 `x,z,yaw,camyaw,campitch,dist` 覆盖。24 帧完成后 `window.__galeShotReady` 为 true；shader 错误写入 `window.__galeShotError` 并让脚本失败。默认风格保留原 CSS 滤镜与渐晕，其他风格使用自身效果。

## 自然地图检查

```sh
node scripts/check-layout.mjs
node scripts/check-layout.mjs --low
node scripts/check-layout.mjs --high
node scripts/check-layout.mjs --preview
```

直接加载实际世界生成模块，不启动浏览器、不创建 WebGL 上下文。Canvas 的画图方法用桩代替；建筑和植被排除区使用共享几何数据，因此数值检查不依赖 Canvas 光栅化结果。覆盖出生点、地形视线、道路曲率/宽度/涉水/坡度/碰撞、房屋、水位、桥梁、楼梯、教堂入口、室内距离切换、种子一致性、81 个光点，以及地形/水/草/作物/植被/NPC 的实际几何生成。

`--preview` 输出被 Git 忽略的 `artifacts/layout.svg`，包含地形分层、水、道路、异形田块、房屋、城墙和地标；它是诊断图，不是渲染截图。中/高网格 4m，低网格 8m。GLSL 编译、透明叠加效果和实际帧率仍需在沙箱外的 Chrome 确认。

## 草贴地检查

```sh
node scripts/check-grass-conform.mjs
# 或 npm run check:grass
```

在 Node 里用与着色器相同的公式（R32F 高度纹理 + 与地形网格一致的三角形插值）生成高画质草/花实例，在出生点、高城、修道院、高山湖、地图四角、河口以及几处远坡上，比较根部高度与 `heightAt()`。草可生长范围内 `|Δ| > 5 cm` 的比例必须小于 5%（理想为 0），且不得有 `|Δ| > 25 cm`。脚本同时打印修复前的半精度 + `uv = xz/SIZE+0.5` + 双线性模型作为对照。不启动浏览器、不创建 WebGL 上下文。

