#!/usr/bin/env python3
"""Image helpers for tools/boxrender.
  stitch  out.png W H  tile.png:x:y:cropL:cropT:cropW:cropH ...   (all in device px)
  diff    a.png b.png [--json]                                     metrics (a vs b, resized if needed)
  upscale in.png out.png W H
  sheet   out.jpg  label=path ...                                  side-by-side, equal height, labelled
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def load(p): return Image.open(p).convert('RGB')

def stitch(a):
    out, W, H = a[0], int(a[1]), int(a[2])
    canvas = Image.new('RGB', (W, H))
    for spec in a[3:]:
        p, x, y, cl, ct, cw, ch = spec.split(':'); x, y, cl, ct, cw, ch = map(int, (x, y, cl, ct, cw, ch))
        canvas.paste(load(p).crop((cl, ct, cl + cw, ct + ch)), (x, y))
    canvas.save(out)

def metrics(pa, pb):
    A, B = load(pa), load(pb)
    if A.size != B.size: B = B.resize(A.size, Image.LANCZOS)
    a, b = np.asarray(A, np.float32), np.asarray(B, np.float32)
    d = np.abs(a - b); mse = float(((a - b) ** 2).mean())
    gray = lambda x: x @ np.array([.299, .587, .114], np.float32)
    ga, gb = gray(a), gray(b)
    # global SSIM-ish (single window) + 8x8 block SSIM mean
    def ssim_blocks(x, y, k=8):
        h, w = (x.shape[0] // k) * k, (x.shape[1] // k) * k
        xb = x[:h, :w].reshape(h // k, k, w // k, k).swapaxes(1, 2).reshape(-1, k * k)
        yb = y[:h, :w].reshape(h // k, k, w // k, k).swapaxes(1, 2).reshape(-1, k * k)
        mx, my = xb.mean(1), yb.mean(1); vx, vy = xb.var(1), yb.var(1)
        cov = ((xb - mx[:, None]) * (yb - my[:, None])).mean(1)
        c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
        return float((((2 * mx * my + c1) * (2 * cov + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))).mean())
    return {
        'size': list(A.size), 'mean_abs_diff_8bit': round(float(d.mean()), 3),
        'p99_abs_diff': round(float(np.percentile(d, 99)), 2), 'max_abs_diff': int(d.max()),
        'pct_px_diff_gt8': round(float((d.max(2) > 8).mean() * 100), 3),
        'pct_px_diff_gt24': round(float((d.max(2) > 24).mean() * 100), 3),
        'psnr_db': round(float(10 * np.log10(255 ** 2 / mse)) if mse > 0 else 99.0, 2),
        'ssim_8x8': round(ssim_blocks(ga, gb), 4),
        'mean_luma_a': round(float(ga.mean()), 2), 'mean_luma_b': round(float(gb.mean()), 2),
    }

def sheet(out, items, height=560):
    ims = []
    for it in items:
        label, p = it.split('=', 1); im = load(p); w = int(im.width * height / im.height)
        ims.append((label, im.resize((w, height), Image.LANCZOS)))
    pad, bar = 8, 34
    W = sum(i.width for _, i in ims) + pad * (len(ims) + 1); H = height + bar + pad * 2
    sh = Image.new('RGB', (W, H), (18, 18, 22)); dr = ImageDraw.Draw(sh)
    try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    except Exception: font = ImageFont.load_default()
    x = pad
    for label, im in ims:
        dr.text((x + 4, 6), label, fill=(235, 235, 235), font=font); sh.paste(im, (x, bar + pad)); x += im.width + pad
    sh.save(out, quality=90)

if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    if c == 'stitch': stitch(a)
    elif c == 'diff': print(json.dumps(metrics(a[0], a[1]), indent=None))
    elif c == 'upscale': Image.open(a[0]).convert('RGB').resize((int(a[2]), int(a[3])), Image.LANCZOS).save(a[1])
    elif c == 'sheet': sheet(a[0], a[1:])
    elif c == 'heat':
        A, B = load(a[0]), load(a[1]); B = B.resize(A.size) if B.size != A.size else B
        d = np.abs(np.asarray(A, np.int16) - np.asarray(B, np.int16)).max(2).astype(np.float32)
        Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8)).save(a[2])
