"""Lay out actual Blender camera renders for technical visual review."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[1]/'art/hero'
sheet=Image.new('RGB',(2060,820),'#292625')
draw=ImageDraw.Draw(sheet)
font_path='C:/Windows/Fonts/msyh.ttc'
title=ImageFont.truetype(font_path,30)
small=ImageFont.truetype(font_path,17)
draw.text((30,20),'蒙面冒险者 · Blender 四视图',font=title,fill='#e8ddd1')
draw.text((32,66),'按提供的角色设计表重建 · 实际三维模型渲染',font=small,fill='#bca995')
for i,(name,label) in enumerate([('front','正面'),('left','左侧'),('back','背面'),('right','右侧')]):
    render=Image.open(root/f'blender-{name}.png').convert('RGB').resize((490,588),Image.Resampling.LANCZOS)
    x=30+i*500
    sheet.paste(render,(x,112))
    draw.text((x+215,719),label,font=title,fill='#e8ddd1')
draw.text((32,783),'可编辑 Blender 源文件 / 蒙皮骨骼 / 面具可摘戴 / 披风可展开',font=small,fill='#bca995')
sheet.save(root/'turnaround.png')

detail=Image.new('RGB',(1400,955),'#292625')
draw=ImageDraw.Draw(detail)
draw.text((30,20),'面具 · 正面与侧面',font=title,fill='#e8ddd1')
draw.text((32,65),'实际 Blender 网格渲染 · 圆滑包覆弧面 / 真实眼孔 / 薄片发束',font=small,fill='#bca995')
for i,(name,label) in enumerate([('front','正面'),('side','侧面')]):
    render=Image.open(root/f'blender-mask-{name}.png').convert('RGB').resize((660,792),Image.Resampling.LANCZOS)
    x=30+i*680;detail.paste(render,(x,110))
    draw.text((x+295,916),label,font=small,fill='#e8ddd1')
detail.save(root/'mask-detail.png')
