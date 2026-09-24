#!/usr/bin/env python3
"""Generate NSIS installer header/sidebar BMPs in MT Assistant style."""
from PIL import Image, ImageDraw, ImageFilter
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, "public", "apple-touch-icon.png")
OUT = os.path.join(ROOT, "desktop", "build")
os.makedirs(OUT, exist_ok=True)

NAVY = (7, 13, 21)
NAVY2 = (11, 26, 40)
GOLD = (212, 175, 90)
CYAN = (94, 180, 220)


def gradient(size, c1, c2):
    w, h = size
    img = Image.new("RGB", size, c1)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def fit_logo(logo, box):
    logo = logo.convert("RGBA")
    logo.thumbnail(box, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", box, (0, 0, 0, 0))
    x = (box[0] - logo.width) // 2
    y = (box[1] - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas


def main():
    logo = Image.open(LOGO)

    # Sidebar: 164 x 314 (NSIS MUI)
    side = gradient((164, 314), NAVY, NAVY2)
    draw = ImageDraw.Draw(side)
    # subtle top accent line
    draw.rectangle([0, 0, 164, 3], fill=GOLD)
    draw.rectangle([0, 310, 164, 314], fill=CYAN)
    badge = fit_logo(logo, (120, 120))
    side.paste(badge, (22, 70), badge)
    # soft glow under logo
    glow = Image.new("RGBA", (164, 314), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([22, 200, 142, 250], fill=(212, 175, 90, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    side = Image.alpha_composite(side.convert("RGBA"), glow).convert("RGB")
    side_path = os.path.join(OUT, "installerSidebar.bmp")
    side.save(side_path, format="BMP")

    # Header: 150 x 57
    head = gradient((150, 57), NAVY2, NAVY)
    hdraw = ImageDraw.Draw(head)
    hdraw.rectangle([0, 54, 150, 57], fill=GOLD)
    badge2 = fit_logo(logo, (44, 44))
    head_rgba = head.convert("RGBA")
    head_rgba.paste(badge2, (8, 6), badge2)
    head = head_rgba.convert("RGB")
    head_path = os.path.join(OUT, "installerHeader.bmp")
    head.save(head_path, format="BMP")

    # Also export 256 PNG for resources
    icon512 = logo.convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
    icon512.save(os.path.join(OUT, "icon.png"))

    print("wrote", side_path)
    print("wrote", head_path)
    print("wrote", os.path.join(OUT, "icon.png"))


if __name__ == "__main__":
    main()
