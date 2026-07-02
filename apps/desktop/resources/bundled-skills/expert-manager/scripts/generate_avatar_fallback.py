#!/usr/bin/env python3
"""Generate a deterministic 512x512 PNG avatar without external dependencies."""

import argparse
import math
import struct
import zlib
from pathlib import Path


CATEGORY_PALETTES = {
    "01-ProductDesign": ((255, 137, 112), (98, 77, 227), (255, 239, 224)),
    "02-Engineering": ((72, 112, 255), (139, 92, 246), (232, 240, 255)),
    "03-GameSpatial": ((133, 70, 255), (239, 68, 120), (246, 232, 255)),
    "04-DataAI": ((20, 184, 166), (14, 165, 233), (224, 252, 247)),
    "05-MarketingGrowth": ((248, 113, 113), (249, 115, 22), (255, 237, 213)),
    "06-ContentCreative": ((236, 72, 153), (168, 85, 247), (252, 231, 243)),
    "07-SalesCommerce": ((245, 158, 11), (217, 119, 6), (254, 243, 199)),
    "08-FinanceInvestment": ((30, 64, 175), (202, 138, 4), (219, 234, 254)),
    "09-OperationsHR": ((51, 65, 85), (59, 130, 246), (226, 232, 240)),
    "10-ProjectQuality": ((16, 185, 129), (21, 128, 61), (220, 252, 231)),
    "11-SecurityCompliance": ((55, 65, 81), (14, 165, 233), (229, 231, 235)),
    "12-IndustryConsultant": ((13, 148, 136), (100, 116, 139), (204, 251, 241)),
}


def blend(left, right, amount):
    return tuple(
        int(left[index] + (right[index] - left[index]) * amount)
        for index in range(3)
    )


def put_pixel(pixels, size, x, y, color):
    if 0 <= x < size and 0 <= y < size:
        pixels[y][x] = color


def draw_disc(pixels, size, cx, cy, radius, color):
    radius_sq = radius * radius
    for y in range(max(0, cy - radius), min(size, cy + radius + 1)):
        for x in range(max(0, cx - radius), min(size, cx + radius + 1)):
            if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius_sq:
                put_pixel(pixels, size, x, y, color)


def draw_line(pixels, size, x0, y0, x1, y1, color, width=4):
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    for step in range(steps + 1):
        t = step / steps
        x = round(x0 + (x1 - x0) * t)
        y = round(y0 + (y1 - y0) * t)
        draw_disc(pixels, size, x, y, width, color)


def draw_category_symbol(pixels, size, category, accent, dark):
    if category in {"02-Engineering", "04-DataAI", "11-SecurityCompliance"}:
        for offset in (0, 38, 76):
            draw_line(pixels, size, 125 + offset, 355, 155 + offset, 320, accent, 5)
            draw_line(pixels, size, 155 + offset, 320, 185 + offset, 355, accent, 5)
    elif category == "08-FinanceInvestment":
        points = [(126, 352), (176, 328), (222, 338), (276, 292), (338, 308)]
        for start, end in zip(points, points[1:]):
            draw_line(pixels, size, start[0], start[1], end[0], end[1], accent, 6)
        for x, y in points:
            draw_disc(pixels, size, x, y, 9, dark)
    else:
        for idx, radius in enumerate((52, 72, 92)):
            color = blend(accent, dark, idx * 0.25)
            for angle in range(0, 360, 9):
                rad = math.radians(angle)
                x = 256 + int(math.cos(rad) * radius)
                y = 340 + int(math.sin(rad) * radius * 0.28)
                put_pixel(pixels, size, x, y, color)


def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw_rows = []
    for row in pixels:
        raw_rows.append(b"\x00" + bytes(channel for pixel in row for channel in pixel))
    raw = b"".join(raw_rows)

    def chunk(kind, data):
        payload = kind + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, level=9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def generate(output, category, label):
    size = 512
    primary, accent, light = CATEGORY_PALETTES.get(category, CATEGORY_PALETTES["12-IndustryConsultant"])
    dark = blend(primary, (15, 23, 42), 0.45)
    pixels = []
    seed = sum(ord(char) for char in label)
    for y in range(size):
        row = []
        for x in range(size):
            diagonal = (x + y) / (size * 2)
            wave = (math.sin((x + seed) / 42) + 1) * 0.04
            row.append(blend(light, primary, min(0.72, diagonal + wave)))
        pixels.append(row)

    draw_disc(pixels, size, 256, 232, 108, blend((255, 255, 255), light, 0.45))
    draw_disc(pixels, size, 256, 214, 72, blend((255, 224, 196), light, 0.25))
    draw_disc(pixels, size, 228, 205, 8, dark)
    draw_disc(pixels, size, 284, 205, 8, dark)
    draw_line(pixels, size, 232, 254, 280, 254, dark, 4)
    draw_disc(pixels, size, 256, 384, 112, dark)
    draw_disc(pixels, size, 256, 348, 100, blend(primary, dark, 0.35))
    draw_category_symbol(pixels, size, category, accent, dark)

    output.parent.mkdir(parents=True, exist_ok=True)
    write_png(output, pixels)


def main():
    parser = argparse.ArgumentParser(description="Generate a fallback expert avatar PNG.")
    parser.add_argument("output", help="Output PNG path, e.g. avatars/expert.png")
    parser.add_argument("--category", default="12-IndustryConsultant", help="Expert categoryId")
    parser.add_argument("--label", default="expert", help="Role label used as deterministic seed")
    args = parser.parse_args()
    generate(Path(args.output), args.category, args.label)
    print(f"Generated fallback avatar: {args.output}")


if __name__ == "__main__":
    main()
