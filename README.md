# Galebound（乘风）

网页 3D 开放世界探索游戏。完整设计与进度见 [PLAN.md](PLAN.md)。

**接手请先读 [HANDOFF.md](HANDOFF.md)。** 那里记录了 3A 目标与画质分档、代码结构、构建与检查、Cloudflare / Vercel 两边一起部署的方法、已合并与未合并的 PR、已知问题，以及最重要的 [地形 / 河流重做方案](docs/terrain-rework.md)。

## 开发

```bash
npm ci
npm run dev      # 本地开发
npm run build    # 类型检查并构建到 dist/
npm run preview  # 预览构建结果
```

部署必须同时更新 Cloudflare 和 Vercel，步骤见 [HANDOFF.md](HANDOFF.md) 第 5 节。PLAN.md 里的「部署」一节已部分过时。

主角 Blender 工程、GLB、预览与继续编辑说明见 [art/hero/README.md](art/hero/README.md)。
