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
