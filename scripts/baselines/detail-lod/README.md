# detail-lod 回归基线

`before-*.json`、`camera-baseline-*.json`、`round2/after-*.json` 是 **A+B+C+D 合并后** 的世界基线（基于 main 08217c2），
由 `DETAIL_METRICS=... node scripts/check-layout.mjs [--low|--high]` 的输出生成；check-layout 用它们防止后续改动让碰撞体、
物种数量、draw calls 和三角形数回退。

`pre-detail-main/` 是细节高模之前（main 的 7245ee5 等价内容）的原始基线，仅供对比：
合并 D 线（高崖城、冰川、瀑布、高架桥等新场景增加了碰撞体和几何）之后，原来的 +30% / 2× 预算已无法对照，
所以重新取了基线。与原 main 的 medium 档对比数字写在 PR 描述里。
