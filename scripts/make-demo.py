#!/usr/bin/env python3
"""Render docs/demo.gif and docs/before-after.png with Pillow.

The GIF is a scripted playback of the real UI: the composer row with the two
chips, the effort panel opening, the knob stepping off -> low -> high -> max,
the ball pit getting denser and the spectrum breathing deeper. It exists so
someone who has not installed the plugin can see what it changes.

Coordinates are CSS px; every draw call goes through S() so the artwork renders
at 2x and downsamples for crisp text.

Run: python3 scripts/make-demo.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)

SCALE = 2
W, H = 720, 380
FPS = 20

PALETTE = ["#22c55e", "#22d3ee", "#6366f1", "#a855f7", "#e879f9"]
LEVELS = ["off", "low", "high", "max"]

CX = (14, 17, 23)
CARD = (30, 33, 39)
PANEL = (26, 29, 34)
BORDER = (52, 56, 64)
TEXT = (238, 240, 244)
MUTED = (150, 156, 168)

FONT_LATIN = "/System/Library/Fonts/Helvetica.ttc"
FONT_CJK = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"


def S(value: float) -> int:
    return int(round(value * SCALE))


def font(size: float, cjk: bool = False) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_CJK if cjk else FONT_LATIN, S(size))
    except OSError:
        return ImageFont.load_default()


def rgb(hex_color: str) -> tuple[int, int, int]:
    value = int(hex_color.lstrip("#"), 16)
    return ((value >> 16) & 255, (value >> 8) & 255, value & 255)


def lerp_color(a: str, b: str, t: float) -> tuple[int, int, int]:
    ca, cb = rgb(a), rgb(b)
    t = max(0.0, min(1.0, t))
    return tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))


def color_at(fraction: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, fraction))
    scaled = t * (len(PALETTE) - 1)
    lower = int(math.floor(scaled))
    upper = min(len(PALETTE) - 1, lower + 1)
    return lerp_color(PALETTE[lower], PALETTE[upper], scaled - lower)


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def particle_count_for(energy: float, levels: int = 4) -> int:
    position = max(0.0, min(levels - 1, max(0.0, min(1.0, energy)) * (levels - 1)))
    if position <= 0.08:
        return 0
    return min(14, round(6 * position ** 1.25))


def gravity_for(energy: float) -> float:
    return 240 + 500 * max(0.0, min(1.0, energy))


def speed_for(energy: float) -> float:
    return 40 + 140 * max(0.0, min(1.0, energy))


def pulse_depth_for(energy: float) -> float:
    return 0.35 + 0.55 * max(0.0, min(1.0, energy))


# --------------------------------------------------------------------- helpers


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def box(x0, y0, x1, y1):
    return [S(x0), S(y0), S(x1), S(y1)]


def chevron(draw, x: float, y: float, color, size: float = 4.0, width: int = 2) -> None:
    """A small down-chevron drawn with lines (glyph U+2304 falls back to tofu)."""
    draw.line([S(x - size), S(y), S(x), S(y + size * 0.75)], fill=color, width=width)
    draw.line([S(x), S(y + size * 0.75), S(x + size), S(y)], fill=color, width=width)


def glow(img: Image.Image, center, radius: float, color, strength: int = 90) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for step in range(4, 0, -1):
        r = radius * (1 + step * 0.6)
        draw.ellipse(
            [S(center[0] - r), S(center[1] - r), S(center[0] + r), S(center[1] + r)],
            fill=(*color, max(8, strength // (step * 2))),
        )
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(S(4))))


class Pit:
    """The plugin's ball pit, in CSS px, drawn through S()."""

    RADIUS = 3.4

    def __init__(self, x: float, y: float, w: float, h: float) -> None:
        self.x, self.y, self.w, self.h = x, y, w, h
        self.balls: list[dict] = []

    def step(self, energy: float, dt: float) -> None:
        r = self.RADIUS
        target = particle_count_for(energy)
        while len(self.balls) < target:
            index = len(self.balls)
            self.balls.append(
                {
                    "x": self.x + r + ((index * 41) % max(1, int(self.w - r * 2))),
                    "y": self.y + self.h - r,
                    "vx": ((index % 5) - 2) * 26,
                    "vy": -speed_for(energy) * (0.6 + 0.4 * ((index % 3) / 2)),
                }
            )
        while len(self.balls) > target:
            self.balls.pop()

        for ball in self.balls:
            ball["vy"] += gravity_for(energy) * dt
            ball["x"] += ball["vx"] * dt
            ball["y"] += ball["vy"] * dt
            if ball["x"] < self.x + r:
                ball["x"] = self.x + r
                ball["vx"] = abs(ball["vx"])
            elif ball["x"] > self.x + self.w - r:
                ball["x"] = self.x + self.w - r
                ball["vx"] = -abs(ball["vx"])
            if ball["y"] > self.y + self.h - r:
                ball["y"] = self.y + self.h - r
                ball["vy"] = -abs(ball["vy"]) - speed_for(energy) * 0.35
            elif ball["y"] < self.y + r:
                ball["y"] = self.y + r
                ball["vy"] = abs(ball["vy"])

    def draw(self, draw, color) -> None:
        r = self.RADIUS
        for ball in self.balls:
            draw.ellipse(box(ball["x"] - r, ball["y"] - r, ball["x"] + r, ball["y"] + r), fill=color)


# ----------------------------------------------------------------------- frame


PANEL_X, PANEL_Y, PANEL_W, PANEL_H = 300, 36, 380, 176
BAND_X, BAND_Y, BAND_W, BAND_H = PANEL_X + 16, PANEL_Y + 42, PANEL_W - 32, 48
TRACK_Y = BAND_Y + BAND_H + 18
TRACK_X0, TRACK_X1 = PANEL_X + 16, PANEL_X + PANEL_W - 16


def draw_frame(state: dict) -> Image.Image:
    img = Image.new("RGBA", (S(W), S(H)), (*CX, 255))
    draw = ImageDraw.Draw(img)

    if state["panel"] > 0.01:
        grow = ease(state["panel"])
        height = PANEL_H * grow
        top = PANEL_Y + (PANEL_H - height)
        rounded(draw, box(PANEL_X, top, PANEL_X + PANEL_W, top + height), S(14), fill=(*PANEL, 255), outline=BORDER)
        if grow > 0.7:
            draw.text((S(PANEL_X + 16), S(top + 14)), "思考强度", font=font(12.5, True), fill=MUTED)

            energy = state["energy"]
            color = state["color"]
            phase = state["phase"]
            knob_pct = state["knob_pct"]

            # spectrum: anchored left, grown to the knob, breathing with the level
            if energy > 0.12:
                span = max(0.0, BAND_W * min(1.0, knob_pct / 100))
                bars = round(8 + 16 * energy)
                depth = pulse_depth_for(energy)
                pulse = 1 - depth * (0.5 - 0.5 * math.sin(phase))
                for index in range(bars):
                    x = BAND_X + span * index / max(1, bars - 1)
                    base = 3 + 22 * energy * (0.35 + 0.65 * abs(math.sin(index * 1.7)))
                    bar_h = base * pulse * 1.5
                    draw.rectangle(
                        [S(x), S(BAND_Y + BAND_H - bar_h), S(x + 2.2), S(BAND_Y + BAND_H)],
                        fill=(*color, 165),
                    )

            state["pit"].draw(draw, color)

            # track gradient
            for x in range(S(TRACK_X0), S(TRACK_X1)):
                t = (x / SCALE - TRACK_X0) / (TRACK_X1 - TRACK_X0)
                draw.line([x, S(TRACK_Y), x, S(TRACK_Y + 8)], fill=(*color_at(t), 255))
            rounded(draw, box(TRACK_X0, TRACK_Y, TRACK_X1, TRACK_Y + 8), S(4))

            knob_x = TRACK_X0 + (TRACK_X1 - TRACK_X0) * knob_pct / 100
            glow(img, (knob_x, TRACK_Y + 4), 10, color, 150)

            for index, name in enumerate(LEVELS):
                pct = 0 if len(LEVELS) == 1 else index / (len(LEVELS) - 1)
                cx = TRACK_X0 + (TRACK_X1 - TRACK_X0) * pct
                stop_color = color_at(pct)
                draw.line([S(cx), S(TRACK_Y + 9), S(cx), S(TRACK_Y + 15)], fill=(*stop_color, 120), width=S(0.8))
                if index != state["level"]:
                    draw.ellipse(
                        box(cx - 4.5, TRACK_Y - 0.5, cx + 4.5, TRACK_Y + 8.5),
                        fill=(*PANEL, 255),
                        outline=(*stop_color, 255),
                        width=S(1.4),
                    )
                label_font = font(11.5)
                width = draw.textlength(name, font=label_font) / SCALE
                active = index == state["level"]
                if active:
                    rounded(
                        draw,
                        box(cx - width / 2 - 7, TRACK_Y + 20, cx + width / 2 + 7, TRACK_Y + 38),
                        S(9),
                        fill=(*stop_color, 45),
                    )
                draw.text((S(cx - width / 2), S(TRACK_Y + 23)), name, font=label_font, fill=(*stop_color, 255 if active else 150))

            # knob sphere
            draw.ellipse(
                box(knob_x - 8, TRACK_Y - 4, knob_x + 8, TRACK_Y + 12),
                fill=(255, 255, 255),
                outline=(*color, 255),
                width=S(1.8),
            )
            draw.ellipse(box(knob_x - 3, TRACK_Y - 1.5, knob_x + 2, TRACK_Y + 2.5), fill=(255, 255, 255))

    # composer row
    card_y = 292
    rounded(draw, box(40, card_y, 680, card_y + 62), S(18), fill=(*CARD, 255), outline=BORDER)

    model_font = font(13)
    draw.text((S(58), S(card_y + 21)), "DeepSeek V4 Flash", font=model_font, fill=TEXT)
    chevron(draw, 196, card_y + 29, MUTED)

    level_color = color_at(state["energy"])
    level_name = LEVELS[state["level"]]
    draw.text((S(226), S(card_y + 21)), level_name, font=model_font, fill=level_color)
    chevron(draw, 226 + draw.textlength(level_name, font=model_font) / SCALE + 8, card_y + 29, MUTED)

    if state["hint"]:
        draw.text((S(300), S(card_y + 23)), state["hint"], font=font(11.5, True), fill=MUTED)

    cursor = state.get("cursor")
    if cursor is not None:
        x, y = cursor
        points = [(x, y), (x, y + 15), (x + 4, y + 11.5), (x + 7, y + 17), (x + 10, y + 15.5), (x + 7, y + 10), (x + 11, y + 9.5)]
        draw.polygon([(S(px), S(py)) for px, py in points], fill=(250, 250, 250), outline=(20, 20, 20))

    return img.resize((W, H), Image.LANCZOS)


# -------------------------------------------------------------------- timeline


def timeline() -> list[dict]:
    frames = []
    total = 112
    pit = Pit(BAND_X, BAND_Y, BAND_W, BAND_H)
    phase = 0.0

    for index in range(total):
        panel = ease(min(1.0, max(0.0, (index - 10) / 8)))

        if index < 18:
            level = 0
        elif index < 30:
            level = 1
        elif index < 44:
            level = 2
        elif index < 90:
            level = 3
        else:
            level = 2

        pct = 0 if len(LEVELS) == 1 else (level / (len(LEVELS) - 1)) * 100
        energy = pct / 100 if len(LEVELS) > 1 else 1.0
        phase += 0.14 + 0.34 * energy
        pit.step(energy, 1 / FPS)

        hint = "点开滑条 · 拖拽 · 滚轮都能调档" if panel > 0.6 else ""
        cursor = None
        if index < 10:
            cursor = (288, 342)
        elif index < 18:
            cursor = (288 + (index - 10) * 3.0, 342 - (index - 10) * 1.4)

        frames.append(
            {
                "panel": panel,
                "level": level,
                "energy": energy,
                "knob_pct": pct,
                "color": color_at(energy),
                "phase": phase,
                "pit": pit,
                "hint": hint,
                "cursor": cursor,
            }
        )
    return frames


def main() -> None:
    images = [draw_frame(state) for state in timeline()]
    for picture in images:
        picture.info["duration"] = int(1000 / FPS)
    target = DOCS / "demo.gif"
    images[0].save(
        target,
        save_all=True,
        append_images=images[1:],
        duration=[int(1000 / FPS)] * len(images),
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"wrote {target} {target.stat().st_size / 1024:.0f} KB")

    still = Image.new("RGB", (S(W), S(190)), CX)
    draw = ImageDraw.Draw(still)
    draw.text((S(24), S(16)), "before  ·  one merged control", font=font(12), fill=MUTED)
    rounded(draw, box(24, 40, 330, 76), S(18), fill=CARD, outline=BORDER)
    draw.text((S(40), S(48)), "DeepSeek V4 Flash", font=font(13), fill=TEXT)
    draw.text((S(178), S(47)), "·", font=font(13), fill=MUTED)
    draw.text((S(192), S(48)), "high", font=font(13), fill=color_at(0.66))
    chevron(draw, 236, 56, MUTED)

    draw.text((S(24), S(102)), "after  ·  model and effort, one click each", font=font(12), fill=MUTED)
    rounded(draw, box(24, 126, 200, 162), S(18), fill=CARD, outline=BORDER)
    draw.text((S(40), S(134)), "DeepSeek V4 Flash", font=font(13), fill=TEXT)
    chevron(draw, 182, 142, MUTED)
    rounded(draw, box(210, 126, 306, 162), S(18), fill=CARD, outline=BORDER)
    draw.text((S(224), S(134)), "high", font=font(13), fill=color_at(0.66))
    chevron(draw, 262, 142, MUTED)

    still = still.resize((W, 190), Image.LANCZOS)
    out = DOCS / "before-after.png"
    still.save(out, optimize=True)
    print(f"wrote {out} {out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
