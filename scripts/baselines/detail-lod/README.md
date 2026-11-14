# detail-lod 回归基线

`before-*.json`、`camera-baseline-*.json`、`round2/after-*.json` 记录**当前 4 km 新世界**的碰撞体哈希、
固定机位的 draw calls / 三角形数和散布物数量。check-layout 用它们防止后续改动让这些数字意外回退或漂移。

机位都相对布局锚点（出生点、城、低语林、城门）定义（`scripts/detail-metrics.mjs`），地图再改时会跟着走。

**有意改动世界之后**（地形、布局、建筑、散布），重取基线：

```bash
BASELINE=1 node scripts/check-layout.mjs
BASELINE=1 node scripts/check-layout.mjs --low
BASELINE=1 node scripts/check-layout.mjs --high
```

然后再不带 `BASELINE` 跑一遍三档确认全绿。提交时在说明里写清楚为什么重取。

`pre-detail-main/` 是细节高模之前的旧 2 km 世界的原始基线，只作历史对照，检查不再读取。
