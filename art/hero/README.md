# 蒙面冒险者 · 设计表重建版

以用户提供的 `design-reference.png` 为造型依据：深棕碎发、白色尖下颌面具、
弯刀形黑眼缝、额头金纹、高领短肩披、长披风、米白开衩上衣、束脚裤、
深色手套、罗盘搭扣、斜挎皮带与腰包。披风有背部与两翼的星芒纹章。
这是可活动的三维重建；发束、布褶、材质光照与二维原图仍有差异。

## 文件

| 文件 | 用途 |
| --- | --- |
| `traveler.blend` | Blender 5.3 工程，含网格、UV、权重、形态键、材质、打包贴图与参考图 |
| `../../public/models/traveler.glb` | 默认游戏主角，标准 glTF 2.0 二进制 |
| `turnaround.png` | Blender 直接渲染的四视图汇总 |
| `blender-front/left/back/right.png` | 四个独立正交视图 |
| `blender-portrait.png` / `blender-head.png` | 全身及头部近景 |
| `mask-detail.png` | 面具正面、侧面实际渲染对照 |
| `blender-flight.png` | 站立展开披风的结构展示 |
| `hero-glide.png` / `hero-in-game.png` | 游戏动作与实际场景截图 |
| `mask-albedo.png` | 白面具与额头金纹贴图；已打包在 Blender 和 GLB 中 |
| `cloak-albedo.png` | 披风星芒与金边贴图，随同一块布面展开 |
| `design-reference.png` | 用户提供的设计表；也已打包进 Blender 的隐藏参考集合 |
| `revision-1/` / `revision-2/` / `revision-3/` | 本地旧版工程和截图，供回看；不提交到 GitHub |
| `manifest.json` / `verification.json` | 网格统计、关节约定及浏览器验证结果 |
| `mask-fit.json` / `cloak-fit.json` | 面具与真实脸部间距、披风展开尺寸检查 |

## 游戏适配

- 含发梢高度约 **1.88 m**，髋高 **1.00 m**；米制，脚底为原点，游戏朝向 +Z。
- Blender 源网格约 **19.1 万三角面**；游戏网格 **155,072 个三角面**，
  **21 个蒙皮网格、16 根骨骼**。GLB 约 **7.55 MB**，贴图内嵌，无运行时外部图片依赖。
- `hero-model.ts` 保留 Blender 材质并读取实际绑定位置，接入既有 `Rig` / `Pose` 动作。
  站、走、跑、跳、下落、滑翔、落地、游泳继续使用游戏的程序化动画。
- 面具、黑色内衬和绑带一起摘戴；人脸和 `Blink` 眨眼形态键保留在面具下方。
- 新披风是一块连续、有厚度的布面，保留 `Glide`、`Flutter`、`Trail` 形态键。
  游戏用滑翔状态混合展开形态，用速度和风控制后掠与摆动。金纹与布面共用形变。
  展开宽约 2.18 m，中央下摆抬至腰部；不保留垂挂的旧版背部矩形布。
  这是形态键驱动的布面变形，不是完整布料物理求解。
- 新角色隐藏旧的两条矩形风布和红围巾尾部；原版角色仍可通过 `?hero=classic` 查看。
- `?mask=off` 可摘下面具。加载失败时自动回退原版角色。

## 本地预览

项目根目录运行 `npm run dev` 后打开：

```text
http://localhost:5173/tools/hero-preview.html
```

可旋转、缩放、查看正侧背、摘戴面具、选择全部动作。选择“滑翔 / 展开披风”
查看展开形态；“设计表”按钮显示原参考图。工作台只用于本地制作检查。

## 继续编辑与导出

在 Blender 中直接打开 `traveler.blend`。骨骼沿肢体方向排列，服装、皮具、
头发与披风分开可编辑。参考集合 `REFERENCE · supplied design` 默认隐藏。
面具的额头金纹通过贴图平贴在表面，避免三角化造成的凸起和穿插。
面具为 1.8 mm 壁厚的圆滑壳面，从面部截面推导，去掉旧版中央尖脊。
对真实细分脸部做 1,259 点间距检查：内壁最小间距约 2.54 mm，
中位约 4.62 mm；鼻部保留空间。眼孔是真实切口，黑色内衬与绑带独立。
头发改用薄片发束，边厚约 0.9 mm，浅拱面最大厚度约 4.3 mm。

保留骨骼名称、`Color` 顶点色层、人眼 `Blink` 形态键、披风三个形态键和
`Traveler_Mask` / `Traveler_Cape` 网格前缀。编辑后保存 `.blend`，然后执行：

```powershell
blender --background art/hero/traveler.blend --python tools/export-hero.py
npm run build
```

导出脚本检查绑定位置，生成游戏用网格并更新 GLB，不会覆盖 Blender 工程。
如果修改关节位置，还需要同步 `manifest.json` 中的关节约定并检查动作与披风。

从零重建使用 `tools/build-hero.py`，配套模块为 `hero_geometry.py`、
`hero_head.py`、`hero_mask.py`、`hero_hair.py`、`hero_cowl.py`、
`hero_cloak.py`、`hero_textures.py`。
**重建会覆盖 `.blend`；手工编辑后应使用 `export-hero.py`。**

直接渲染四视图与展开形态：

```powershell
blender --background art/hero/traveler.blend --python tools/render-hero.py
python tools/hero-contact-sheet.py
```

## 验证

已通过 TypeScript / Vite 生产构建，检查八种动作各八个相位的蒙皮顶点、骨骼位置、
披风开合、旧风布隐藏、眨眼、面具摘戴、实际游戏移动与跳跃，以及资源缺失回退。
未做手机实机性能测试。

保持 Vite 运行，安装 Playwright 后可复验：

```powershell
npm install --no-save --package-lock=false playwright
node tools/verify-hero.cjs
node tools/capture-hero.cjs
```
