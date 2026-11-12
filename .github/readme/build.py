#!/usr/bin/env python3
"""Renders the README artwork from data.json: python3 .github/readme/build.py"""

import base64
import html
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = json.loads((HERE / "data.json").read_text())
FONT = json.loads((HERE / "glyphs.json").read_text())["weights"]
FACES = {"g": FONT, "o": json.loads((HERE / "glyphs-golos.json").read_text())["weights"]}
ICON_DIR = ROOT / "src" / "ui" / "icons" / "svg"
PAGES = HERE / "pages"
SOCIAL_THEME = "light"
NAV = [("Contributing", "CONTRIBUTING.md"), ("Security", "SECURITY.md"), ("Code of conduct", "CODE_OF_CONDUCT.md"), ("Support", ".github/SUPPORT.md")]
ASSET_PATH = ".github/readme"
EASE = "cubic-bezier(.45,.05,.2,1)"
LOOP = 24
SHOT_SIZE = (1672, 1126)
SHOT_WINDOW = (76, 76, 1520, 974)
CORNER = 26 / SHOT_WINDOW[2]

THEMES = {
    "dark": {
        "panel": "#131829", "raised": "#1F2640",
        "ink": "#F4F7FF", "muted": "#A8B3CC", "faint": "#8C97B0", "hair": "#2A3148",
        "accent": "#AFC8F7", "onAccent": "#101320", "track": "#262D45", "paper": "#0D1117",
        "markFrom": "#F4F7FF", "markTo": "#AFC8F7", "glow": "#5C8BFF", "glowOpacity": 0.42, "hueOpacity": 0.34,
        "fieldFrom": "#101320", "fieldTo": "#1B2445", "coverOpacity": 0.42, "shade": "#05070E", "shadeOpacity": 0.7, "edge": "#FFFFFF24",
    },
    "light": {
        "panel": "#F4F6FB", "raised": "#E6EBF6",
        "ink": "#101320", "muted": "#566079", "faint": "#69738A", "hair": "#DDE3F0",
        "accent": "#3A5FB5", "onAccent": "#FFFFFF", "track": "#DDE3F0", "paper": "#FFFFFF",
        "markFrom": "#1B2340", "markTo": "#101320", "glow": "#FFFFFF", "glowOpacity": 0.55, "hueOpacity": 0.3,
        "fieldFrom": "#AFC8F7", "fieldTo": "#DCE7FB", "coverOpacity": 0.3, "shade": "#1B2F66", "shadeOpacity": 0.32, "edge": "#10132022",
    },
}
BANNER_WIDE, BANNER_NARROW = 560, 420
HUES = {"blue": "#5C8BFF", "sky": "#6FBBFF", "ice": "#C4D8FF", "yellow": "#F6CE5B", "red": "#F0675F"}
LITTLE = {"yellow": 0.7, "red": 0.5}
TILES = [("#1B3F8F", "#8FB8FF"), ("#C8553D", "#FFC58A"), ("#0F6E78", "#7FE3D4"), ("#D9963A", "#FFE29A"), ("#B23A5B", "#FFB7A8"), ("#2F7D5B", "#CDEFB6")]
WARM = {"fill": "#F2A65A", "deep": "#E8775A", "ink": "#2A1408"}

MARK = (
    "M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 "
    "A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 "
    "L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z"
)
LYRICS = ["Lights go soft across the bay", "Radio hums an hour away", "Nothing here we need to say", "Hold the blue a little longer"]


def advance(text, size, weight=400, tracking=0.0, face="g"):
    table = FACES[face][str(weight)]
    units = 0
    for index, char in enumerate(text):
        units += table["glyphs"][char]["a"]
        units += table["kern"].get(text[index:index + 2], 0)
    return units * size / 1000 + tracking * size * len(text)


def wrap(text, size, width, weight=400, face="g"):
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and advance(candidate, size, weight, face=face) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    return lines + [current] if current else lines


def wrap_parts(text, size, width, weight=400):
    lines = []
    for part in text.split(" · "):
        joined = f"{lines[-1]} · {part}" if lines else part
        if lines and advance(joined, size, weight) <= width:
            lines[-1] = joined
        else:
            lines.append(part)
    return lines


def format_number(value):
    return f"{value:g}"


def app_icon(name):
    source = next(path for path in (ICON_DIR / f"{name}.svg", HERE / "brands" / f"{name}.svg") if path.exists()).read_text()
    return re.sub(r"^<svg[^>]*>|</svg>\s*$", "", source.strip())


class Art:

    def __init__(self, theme, width, height, title):
        self.theme = theme
        self.t = THEMES[theme]
        self.width = width
        self.height = height
        self.title = title
        self.glyphs = set()
        self.defs = []
        self.css = {}
        self.body = []
        self.serial = 0

    def add(self, *parts):
        self.body.extend(parts)

    def rule(self, key, text):
        self.css[key] = text

    def uid(self, prefix="i"):
        self.serial += 1
        return f"{prefix}{self.serial}"

    def text(self, x, y, content, size, fill=None, weight=400, anchor="start", tracking=0.0, width=None, extra="", face="g"):
        measured = advance(content, size, weight, tracking, face)
        if width is not None and measured > width + 0.5:
            raise ValueError(f"{self.title}: '{content}' is {measured:.0f} wide, room for {width}")
        if anchor == "middle":
            x -= measured / 2
        elif anchor == "end":
            x -= measured
        table = FACES[face][str(weight)]
        pen = 0
        uses = []
        for index, char in enumerate(content):
            if char not in table["glyphs"]:
                raise ValueError(f"glyph {char!r} is missing, add it in extract_glyphs.py")
            if table["glyphs"][char]["d"]:
                self.glyphs.add((face, weight, char))
                uses.append(f'<use href="#{face}{weight}-{ord(char):x}" x="{pen:.0f}"/>')
            pen += table["glyphs"][char]["a"] + table["kern"].get(content[index:index + 2], 0) + tracking * 1000
        return f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 1000:.4f})" fill="{fill or self.t["ink"]}"{extra}>{"".join(uses)}</g>'

    def paragraph(self, x, y, content, size, width, line_height, fill=None, weight=400):
        lines = wrap(content, size, width, weight)
        parts = [self.text(x, y + index * line_height, line, size, fill or self.t["muted"], weight) for index, line in enumerate(lines)]
        return "".join(parts), y + (len(lines) - 1) * line_height

    def roll(self, x, y, content, size, fill=None, weight=700, anchor="start", tracking=-0.01):
        fill = fill or self.t["ink"]
        total = advance(content, size, weight, tracking)
        x -= total / 2 if anchor == "middle" else total if anchor == "end" else 0
        line = round(size * 1.3)
        pen = x
        parts = []
        digits = [char for char in content if char.isdigit()]
        seen = 0
        for index, char in enumerate(content):
            step = advance(content[index:index + 2], size, weight, tracking) - advance(content[index + 1:index + 2], size, weight, tracking) if index + 1 < len(content) else advance(char, size, weight, tracking)
            if char.isdigit():
                seen += 1
                offset = int(char) * line
                name = self.uid("k")
                clip = self.uid("c")
                self.defs.append(f'<clipPath id="{clip}"><rect x="{pen - 3:.1f}" y="{y - size:.1f}" width="{step + 6:.1f}" height="{size * 1.2:.1f}"/></clipPath>')
                settle = 12 + round(5 * seen / max(1, len(digits)))
                self.rule(name, f"@keyframes {name}{{0%,2%{{transform:translateY(0)}}{settle}%,94%{{transform:translateY(-{offset}px)}}100%{{transform:translateY(0)}}}}")
                column = "".join(self.text(pen, y + value * line, str(value), size, fill, weight) for value in range(int(char) + 1))
                parts.append(f'<g clip-path="url(#{clip})"><g style="transform:translateY(-{offset}px);animation:{name} {LOOP}s {EASE} infinite">{column}</g></g>')
            else:
                parts.append(self.text(pen, y, char, size, fill, weight))
            pen += step
        return "".join(parts)

    def icon(self, name, x, y, size, color=None, stroke=2):
        return (
            f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 24:.3f})" color="{color or self.t["accent"]}" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{app_icon(name)}</g>'
        )

    def mark(self, x, y, size, fill):
        return f'<path transform="translate({x:.1f} {y:.1f}) scale({size / 192:.4f}) translate(-32 -32)" d="{MARK}" fill="{fill}"/>'

    def gradient(self, start, stop, x1=0, y1=0, x2=1, y2=1):
        name = self.uid("l")
        self.defs.append(f'<linearGradient id="{name}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{start}"/><stop offset="1" stop-color="{stop}"/></linearGradient>')
        return f"url(#{name})"

    def glow(self, cx, cy, rx, ry, color, opacity, extra=""):
        name = self.uid("r")
        self.defs.append(f'<radialGradient id="{name}"><stop offset="0" stop-color="{color}" stop-opacity="{opacity}"/><stop offset=".55" stop-color="{color}" stop-opacity="{opacity * 0.34:.3f}"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>')
        return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{name})"{extra}/>'

    def frame(self, x, y, w, h, extra=""):
        radius = min(max(self.width * CORNER, 12), min(w, h) / 4)
        return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{radius:.1f}"{extra}/>'

    def clip(self, x, y, w, h):
        name = self.uid("c")
        self.defs.append(f'<clipPath id="{name}">{self.frame(x, y, w, h)}</clipPath>')
        return name

    def tile(self, x, y, size, index, extra=""):
        start, stop = TILES[index % len(TILES)]
        return self.frame(x, y, size, size, f' fill="{self.gradient(start, stop)}"{extra}')

    def render(self):
        glyphs = "".join(f'<path id="{face}{weight}-{ord(char):x}" d="{FACES[face][str(weight)]["glyphs"][char]["d"]}"/>' for face, weight, char in sorted(self.glyphs))
        style = ""
        if self.css:
            style = "<style>" + "".join(self.css.values()) + "@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>"
        label = html.escape(self.title, quote=True)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" viewBox="0 0 {self.width} {self.height}" role="img" aria-label="{label}">'
            f"<title>{html.escape(self.title)}</title>{style}<defs>{glyphs}{''.join(self.defs)}</defs>{''.join(self.body)}</svg>\n"
        )


DRIFT = (
    "@keyframes da{to{transform:translate(26%,18%)}}@keyframes db{to{transform:translate(-24%,-16%)}}"
    ".da,.db{transform-box:fill-box}.da{animation:da 47s ease-in-out infinite alternate}.db{animation:db 61s ease-in-out infinite alternate}"
)


def card(a, x, y, w, h, hues=("blue",), fill=None):
    a.rule("drift", DRIFT)
    clip = a.clip(x, y, w, h)
    strength = a.t["hueOpacity"]
    first = a.glow(round(x + w * 0.2), round(y + h * 0.15), round(w * 0.6), round(h * 1.05), HUES[hues[0]], strength, ' class="da"')
    second = a.glow(round(x + w * 0.85), round(y + h * 0.9), round(w * 0.5), round(h * 0.95), HUES[hues[-1]], strength * 0.8 * LITTLE.get(hues[-1], 1), ' class="db"')
    a.add(f'<g clip-path="url(#{clip})"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill or a.t["panel"]}"/>{first}{second}</g>')


def wordmark(a, x, baseline, size, ink):
    cap = size * 0.7
    tall = cap * 1.04
    drawn = a.mark(x, baseline - tall + cap * 0.02, tall, a.gradient(a.t["markFrom"], a.t["markTo"]))
    return drawn + a.text(x + tall + size * 0.035, baseline, "uvo", size, ink, 800, tracking=-0.03)


def wordmark_width(size):
    return size * 0.7 * 1.04 + size * 0.035 + advance("uvo", size, 800, -0.03)


def app_window(a, x, y, width):
    left, top, full_width, full_height = SHOT_WINDOW
    scale = width / full_width
    height = full_height * scale
    clip = a.clip(x, y, width, height)
    soft = a.uid("b")
    a.defs.append(f'<filter id="{soft}" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>')
    source = base64.b64encode((HERE / "shots" / f"home-{a.theme}.webp").read_bytes()).decode()
    image_x = x - left * scale
    image_y = y - top * scale
    return (
        a.frame(x, y + 16, width, height, f' fill="{a.t["shade"]}" opacity="{a.t["shadeOpacity"]}" filter="url(#{soft})"') +
        f'<g clip-path="url(#{clip})"><image href="data:image/webp;base64,{source}" x="{image_x:.1f}" y="{image_y:.1f}" width="{SHOT_SIZE[0] * scale:.1f}" height="{SHOT_SIZE[1] * scale:.1f}"/></g>' +
        a.frame(x, y, width, height, f' fill="none" stroke="{a.t["edge"]}" stroke-width="1"')
    )


def hero(a, narrow):
    t = a.t
    w, h = a.width, a.height
    clip = a.clip(0, 0, w, h)
    a.rule("hero", (
        "@keyframes rise{from{transform:translateY(34px)}to{transform:none}}"
        ".rise{animation:rise 1.8s cubic-bezier(.16,1,.3,1) both}"
        "@keyframes da{to{transform:translate(9%,6%)}}@keyframes db{to{transform:translate(-8%,5%)}}"
        ".da,.db{transform-box:fill-box}.da{animation:da 43s ease-in-out infinite alternate}.db{animation:db 59s ease-in-out infinite alternate}"
    ))
    if narrow:
        size, window_y, window_width = 150, 176, 444
        window_x = (w - window_width) / 2
        name = wordmark(a, (w - wordmark_width(size)) / 2, 122, size, t["ink"])
        line = a.text(w / 2, 158, DATA["tagline"], 27, t["ink"], 600, "middle")
    else:
        size, window_y, window_width = 216, 172, 840
        window_x = (w - window_width) / 2
        name = wordmark(a, window_x, 190, size, t["ink"])
        first, second = wrap(DATA["tagline"], 36, 300, 600)
        right = window_x + window_width
        line = a.text(right, 104, first, 36, t["ink"], 600, "end", -0.01) + a.text(right, 148, second, 36, t["ink"], 600, "end", -0.01)
    glow_y = window_y + 10
    a.add(
        f'<g clip-path="url(#{clip})"><rect width="{w}" height="{h}" fill="{a.gradient(t["fieldFrom"], t["fieldTo"], 0, 0, 0, 1)}"/>',
        a.glow(round(w * 0.5), glow_y, round(w * 0.62), round(h * 0.7), t["glow"], t["glowOpacity"]),
        a.glow(round(w * 0.3), glow_y, round(w * 0.3), round(h * 0.5), WARM["deep"], t["coverOpacity"] * 0.36, ' class="da"'),
        a.glow(round(w * 0.68), glow_y, round(w * 0.3), round(h * 0.5), HUES["yellow"], t["coverOpacity"], ' class="db"'),
        name,
        line,
        f'<g class="rise">{app_window(a, window_x, window_y, window_width)}</g></g>',
        a.frame(.5, .5, w - 1, h - 1, f' fill="none" stroke="{t["edge"]}"'),
    )


CORE_ICONS = ["library", "playlist", "history", "radio", "import", "folder", "lyrics", "database"]

def title_block(a, icon, title, sub, x=30, y=30, width=None, size=38):
    width = width or a.width - x * 2
    a.add(a.icon(icon, x, y + 1, 32))
    a.add(a.text(x + 46, y + 29, title, size, a.t["ink"], 700, tracking=-0.012, width=width - 46))
    text, end = a.paragraph(x, y + 68, sub, 19, width, 26)
    a.add(text)
    return end


def story(a, narrow):
    t = a.t
    total = DATA["metrics"]["memIdle"]["p50"]
    card(a, 0, 0, a.width, a.height, ("blue", "sky"))
    rows = 15
    columns = math.ceil(round(total) / rows)
    pitch = 18 if narrow else 14
    left = 30 if narrow else a.width - 30 - columns * pitch
    top = 288 if narrow else 62
    text_w = a.width - 60 if narrow else 520
    a.add(a.text(30, 74, "A small Rust core,", 42, t["ink"], 700, tracking=-0.015, width=a.width - 40))
    a.add(a.text(30, 124, "behind the window", 42, t["ink"], 700, tracking=-0.015))
    text, _ = a.paragraph(30, 168, "One small process holds your library, ranking, imports and caches. Each square is one megabyte of the whole app at idle.", 19, text_w, 27)
    a.add(text)
    number = format_number(total)
    a.add(a.roll(left, top - 14, number, 30))
    a.add(a.text(left + advance(number, 30, 700, -0.01) + 8, top - 14, "MB, whole app", 15, t["muted"], 500))
    size = pitch - 2.5
    cells = [a.frame(left + (index // rows) * pitch, top + (index % rows) * pitch, size, size) for index in range(round(total))]
    clip = a.uid("c")
    a.defs.append(f'<clipPath id="{clip}"><rect class="fill" x="{left}" y="{top}" width="{columns * pitch}" height="{rows * pitch}"/></clipPath>')
    a.rule("fill", f"@keyframes fill{{0%,2%{{transform:scale(0)}}17%,94%{{transform:scale(1)}}100%{{transform:scale(0)}}}}.fill{{transform-box:fill-box;transform-origin:center;animation:fill {LOOP}s {EASE} infinite}}")
    a.add(f'<g clip-path="url(#{clip})" fill="{t["accent"]}" opacity=".45">{"".join(cells)}</g>')
    jobs = list(zip(DATA["coreJobs"].split(", "), CORE_ICONS, strict=True))
    turn = LOOP / len(jobs)
    a.rule("job", f"@keyframes job{{0%{{opacity:0}}1%,{100 / len(jobs) - 1}%{{opacity:1}}{100 / len(jobs)}%,100%{{opacity:0}}}}.job{{opacity:0;animation:job {LOOP}s linear infinite}}")
    y = top + rows * pitch + 8
    for index, (job, icon) in enumerate(jobs):
        # the first job stays lit when motion is off
        state = f' class="job" style="animation-delay:{index * turn:g}s{";opacity:1" if index == 0 else ""}"'
        x = left + index * 26
        a.add(f'<g opacity=".55">{a.icon(icon, x, y, 18, t["muted"])}</g><g{state}>{a.icon(icon, x, y, 18)}</g>')
        a.add(a.text(left + len(jobs) * 26 + 6, y + 14, job.capitalize(), 16, t["ink"], 600, extra=state))


CHAPTERS = ["Karaoke", "Equalizer", "Home", "Queue", "Colours", "Tour"]


def see(a, narrow):
    t = a.t
    card(a, 0, 0, a.width, a.height, ("sky", "blue"))
    title_block(a, "gallery", "See it move", "Real captures of the app, in this order.")
    top = 150
    columns = 3 if narrow else 6
    gap = 10
    width = (a.width - 60 - gap * (columns - 1)) / columns
    period = 18
    frames = []
    for index, name in enumerate(CHAPTERS):
        x = 30 + (index % columns) * (width + gap)
        y = top + (index // columns) * 54
        start = round(index * 100 / len(CHAPTERS), 1)
        stop = round((index + 1) * 100 / len(CHAPTERS), 1)
        frames.append(f"@keyframes s{index}{{0%,{max(start - 2, 0)}%{{opacity:.6}}{start + 1.5}%,{stop - 2}%{{opacity:1}}{min(stop + 1, 100)}%,100%{{opacity:.6}}}}.s{index}{{animation:s{index} {period}s linear infinite}}")
        surface = a.frame(x, y, width, 44, f' fill="{t["raised"]}"')
        a.add(f'<g class="s{index}">{surface}{a.text(x + width / 2, y + 28, name, 17, t["ink"], 600, "middle")}</g>')
    a.rule("chapters", "".join(frames))


def features_head(a, narrow):
    t = a.t
    card(a, 0, 0, a.width, a.height, ("blue", "yellow"))
    title_block(a, "grid", "Everything in the box", "No account, no plan to choose, nothing locked.")
    names = ["library", "radio", "equalizer", "lyrics", "import", "link", "palette", "folder", "lock"]
    step = (a.width - 60) / len(names)
    for index, name in enumerate(names):
        a.add(a.icon(name, 30 + index * step + (step - 26) / 2, a.height - 52, 26, t["muted"]))


def plain_head(icon, title, sub, hues):
    def draw(a, narrow):
        card(a, 0, 0, a.width, a.height, hues)
        title_block(a, icon, title, sub)
    return draw


BANNERS = {
    "download": {
        "title": "Download Nuvo", "subtitle": "Free · Linux, Windows and macOS", "action": "Download",
        "icon": "download", "badgeIcon": 30, "badge": "#0068D6", "button": "#0058B8", "shadow": "#0068D6",
        "stops": ((0, "#3D8BFF"), (0.45, "#0068D6"), (0.7, "#0A5BD6"), (1, "#0B4FB8")),
    },
    "telegram": {
        "title": "Join the Nuvo channel", "subtitle": "@getnuvo · news and releases", "action": "Open Telegram",
        "icon": "telegram", "badgeIcon": 34, "badge": "#2A9FE3", "button": "#1571B5", "shadow": "#2086D0",
        "stops": ((0, "#6CC0F5"), (0.45, "#2A9FE3"), (0.7, "#1D86D0"), (1, "#1A78BD")),
    },
    "support": {
        "title": "Support the author", "subtitle": "Nuvo stays free. This keeps it going.", "action": "Support",
        "icon": "liked", "badgeIcon": 30, "badge": "#F6634F", "button": "#C2412F", "shadow": "#F6634F",
        "stops": ((0, "#FF9470"), (0.45, "#F6634F"), (0.7, "#EA5047"), (1, "#DB4441")),
    },
}
PLANES = [(0.06, 0.18, 26, 0), (0.24, 0.72, 18, -3), (0.41, 0.10, 22, -6), (0.58, 0.66, 30, -2), (0.72, 0.12, 16, -8), (0.92, 0.62, 24, -5)]
BANNER_MARGIN = (16, 6, 26)  # sides, top, bottom: room for the site's 0 10px 30px -14px shadow
TITLE_SIZE, NOTE_SIZE, ACTION_SIZE = 20.48, 14.8, 16


def golos_line(size, height=None):
    """Line box as Chrome lays out Golos Text: ascent .98 em, descent .22 em, rounded to a pixel"""
    ascent, descent = round(size * 0.98), round(size * 0.22)
    height = height or ascent + descent
    return height, (height - ascent - descent) / 2 + ascent


def banner_layout(spec, width, narrow):
    card = width - BANNER_MARGIN[0] * 2
    pill = advance(spec["action"], ACTION_SIZE, 600, face="o") + 44
    room = card - 16 - 60 - 18 - 18 - (0 if narrow else pill + 18)
    lines = wrap(spec["subtitle"], NOTE_SIZE, room, face="o")
    row = max(60, TITLE_SIZE * 1.2 + 2 + len(lines) * golos_line(NOTE_SIZE)[0])
    height = 16 + row + (18 + 46 if narrow else 0) + 16
    return card, height, row, pill, lines


def banner_size(spec, width, narrow):
    return width, math.ceil(banner_layout(spec, width, narrow)[1] + BANNER_MARGIN[1] + BANNER_MARGIN[2])


def banner(spec):
    def draw(a, narrow):
        w, h, row, pill, lines = banner_layout(spec, a.width, narrow)
        x0, y0 = BANNER_MARGIN[0], BANNER_MARGIN[1]
        a.rule("planes", (
            "@keyframes drift{from{transform:translate(-6px,6px) rotate(-8deg)}to{transform:translate(10px,-8px) rotate(8deg)}}"
            ".plane{transform-box:fill-box;transform-origin:center;animation:drift 9s ease-in-out infinite alternate}"
        ))
        # CSS linear-gradient(115deg) over a 160% wide background, pinned at its left edge
        angle = math.radians(115)
        field = w * 1.6
        dx, dy = math.sin(angle), -math.cos(angle)
        half = (field * abs(dx) + h * abs(dy)) / 2
        cx, cy = x0 + field / 2, y0 + h / 2
        fill = a.uid("l")
        a.defs.append(
            f'<linearGradient id="{fill}" gradientUnits="userSpaceOnUse" x1="{cx - dx * half:.1f}" y1="{cy - dy * half:.1f}" x2="{cx + dx * half:.1f}" y2="{cy + dy * half:.1f}">'
            + "".join(f'<stop offset="{offset:g}" stop-color="{color}"/>' for offset, color in spec["stops"]) + "</linearGradient>"
        )
        blur = a.uid("b")
        a.defs.append(f'<filter id="{blur}" filterUnits="userSpaceOnUse" x="0" y="0" width="{a.width}" height="{a.height}"><feGaussianBlur stdDeviation="15"/></filter>')
        a.add(f'<rect x="{x0 + 14}" y="{y0 + 24}" width="{w - 28:.1f}" height="{h - 28:.1f}" rx="16" fill="{spec["shadow"]}" opacity=".55" filter="url(#{blur})"/>')
        clip = a.uid("c")
        a.defs.append(f'<clipPath id="{clip}"><rect x="{x0}" y="{y0}" width="{w:.1f}" height="{h:.1f}" rx="30.0"/></clipPath>')
        planes = "".join(
            f'<g class="plane" style="animation-delay:{delay}s">{a.icon(spec["icon"], x0 + left * w, y0 + top * h, size, "#FFFFFF")}</g>'
            for left, top, size, delay in PLANES
        )
        a.add(f'<g clip-path="url(#{clip})"><rect x="{x0}" y="{y0}" width="{field:.1f}" height="{h:.1f}" fill="url(#{fill})"/><g opacity=".2">{planes}</g></g>')
        middle = y0 + 16 + row / 2
        a.add(f'<circle cx="{x0 + 46}" cy="{middle:.1f}" r="30" fill="#FFFFFF"/>')
        icon = spec["badgeIcon"]
        a.add(a.icon(spec["icon"], x0 + 46 - icon / 2, middle - icon / 2, icon, spec["badge"]))
        tx = x0 + 94
        title_line, title_base = golos_line(TITLE_SIZE, TITLE_SIZE * 1.2)
        note_line, note_base = golos_line(NOTE_SIZE)
        top = middle - (title_line + 2 + len(lines) * note_line) / 2
        a.add(a.text(tx, top + title_base, spec["title"], TITLE_SIZE, "#FFFFFF", 640, tracking=-0.02, face="o"))
        for index, line in enumerate(lines):
            a.add(a.text(tx, top + title_line + 2 + index * note_line + note_base, line, NOTE_SIZE, "#FFFFFF", face="o", extra=' fill-opacity=".92"'))
        if narrow:
            px, py, pw = x0 + 16, y0 + 16 + row + 18, w - 34
        else:
            px, py, pw = x0 + w - 18 - pill, middle - 23, pill
        a.add(f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="46" rx="23" fill="#FFFFFF"/>')
        action_line, action_base = golos_line(ACTION_SIZE)
        a.add(a.text(px + pw / 2, py + 23 - action_line / 2 + action_base, spec["action"], ACTION_SIZE, spec["button"], 600, "middle", face="o"))
    return draw


def heading(a, x, y, icon, title, sub, width):
    a.add(a.icon(icon, x, y, 28))
    a.add(a.text(x + 40, y + 23, title, 28, a.t["ink"], 700, tracking=-0.01, width=width - 40))
    text, end = a.paragraph(x, y + 58, sub, 18, width, 25)
    a.add(text)
    return end


def v_library(a, x, y, w, h):
    size = min(118, h)
    gap = 14
    count = 6
    span = count * (size + gap)
    clip = a.clip(x, y, w, size + 4)
    a.rule("shelf", f"@keyframes shelf{{to{{transform:translateX(-{span}px)}}}}.shelf{{animation:shelf 70s linear infinite}}")
    tiles = "".join(a.tile(x + index * (size + gap), y + 2, size, index % count) for index in range(count * 2))
    a.add(f'<g clip-path="url(#{clip})"><g class="shelf">{tiles}</g></g>')
    a.add(a.icon("liked", x + 12, y + size - 26, 22, "#FFFFFF"))


def v_mixes(a, x, y, w, h):
    size = min(h, 170)
    cell = (size - 4) / 2
    cx = x + (w - size) / 2
    clip = a.clip(cx, y, size, size)
    frames = []
    tiles = []
    for index in range(4):
        px = cx + (index % 2) * (cell + 4)
        py = y + (index // 2) * (cell + 4)
        start, stop = TILES[index]
        other, other_stop = TILES[(index + 3) % len(TILES)]
        tiles.append(f'<rect x="{px:.1f}" y="{py:.1f}" width="{cell}" height="{cell}" fill="{a.gradient(start, stop)}"/>')
        name = f"m{index}"
        lead = 8 + index * 20
        frames.append(f"@keyframes {name}{{0%,{lead}%{{opacity:0}}{lead + 9}%,{lead + 34}%{{opacity:1}}{lead + 43}%,100%{{opacity:0}}}}.{name}{{animation:{name} 28s ease-in-out infinite}}")
        tiles.append(f'<rect class="{name}" x="{px:.1f}" y="{py:.1f}" width="{cell}" height="{cell}" fill="{a.gradient(other, other_stop)}"/>')
    a.rule("mix", "".join(frames))
    a.add(f'<g clip-path="url(#{clip})">{"".join(tiles)}</g>')
    a.add(a.text(cx + 14, y + size - 14, "MIX", 30, "#FFFFFF", 700))


def v_sound(a, x, y, w, h):
    t = a.t
    bars = 46
    step = w / bars
    a.rule("bars", "@keyframes bar{0%,100%{transform:scaleY(.5)}35%{transform:scaleY(1)}70%{transform:scaleY(.68)}}.bar{transform-box:fill-box;transform-origin:bottom;animation:bar 7s ease-in-out infinite}")
    for index in range(bars):
        k = index / bars
        height = h * (0.3 + 0.62 * abs(math.sin(k * 7.3 + 0.8)) * (1 - k * 0.55))
        a.add(f'<rect class="bar" style="animation-delay:{-((index * 37) % 70) / 10}s" x="{x + index * step:.1f}" y="{y + h - height:.1f}" width="{step - 4:.1f}" height="{height:.1f}" rx="3" fill="{t["accent"]}" opacity=".24"/>')
    gains = [0.1, 0.3, 0.72, 0.42, 0.12, 0.02, -0.14, -0.44, -0.2, 0.05]
    points = [(x + 18 + index * (w - 36) / 9, y + h / 2 - gain * h * 0.42) for index, gain in enumerate(gains)]
    path = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        middle = (x0 + x1) / 2
        path += f" C{middle:.1f} {y0:.1f} {middle:.1f} {y1:.1f} {x1:.1f} {y1:.1f}"
    a.add(f'<path d="{path}" fill="none" stroke="{t["accent"]}" stroke-width="3" stroke-linecap="round"/>')
    for px, py in points:
        a.add(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="6.5" fill="{t["panel"]}" stroke="{t["accent"]}" stroke-width="2.5"/>')


def v_lyrics(a, x, y, w, h):
    t = a.t
    size = min(27, w / 14.8)
    gap = size * 1.75
    beat = 5.0
    total = beat * len(LYRICS)
    clip = a.uid("c")
    a.defs.append(f'<clipPath id="{clip}"><rect x="{x - 4}" y="{y}" width="{w + 8}" height="{h}"/></clipPath>')
    steps = []
    for index in range(len(LYRICS) + 1):
        at = index * 100 / len(LYRICS)
        steps.append(f"{max(at - 3, 0):.1f}%{{transform:translateY(-{max(index - 1, 0) * gap:.1f}px)}}{at:.1f}%{{transform:translateY(-{index * gap:.1f}px)}}")
    a.rule("climb", "@keyframes climb{" + "".join(steps[1:]) + f"}}.climb{{animation:climb {total}s ease-in-out infinite}}")
    frames = []
    parts = []
    for line_index, line in enumerate(LYRICS[-1:] + LYRICS + LYRICS[:3]):
        cursor = x
        ly = y + size + gap * line_index
        active = (line_index - 1) % len(LYRICS)
        for word_index, word in enumerate(line.split()):
            name = f"y{line_index}x{word_index}"
            begin = (active * beat + 0.3 + word_index * 0.62) / total * 100
            end = ((active + 1) * beat - 0.2) / total * 100
            frames.append(f"@keyframes {name}{{0%,{max(begin - 1, 0):.1f}%{{opacity:.24}}{begin + 1:.1f}%,{end:.1f}%{{opacity:1}}{min(end + 2, 100):.1f}%,100%{{opacity:.24}}}}.{name}{{animation:{name} {total}s linear infinite}}")
            parts.append(a.text(cursor, ly, word, size, t["ink"], 700, extra=f' class="{name}"'))
            cursor += advance(word + " ", size, 700)
    a.rule("lines", "".join(frames))
    a.add(f'<g clip-path="url(#{clip})"><g class="climb">{"".join(parts)}</g></g>')


def v_imports(a, x, y, w, h):
    t = a.t
    sources = ["YouTube", "SoundCloud", "Apple Music", "Deezer", "CSV, JSON, M3U"]
    row = h / len(sources)
    target_x = x + w - 96
    target_y = y + h / 2
    a.rule("flow", "@keyframes flow{to{stroke-dashoffset:-40}}.flow{animation:flow 5s linear infinite}")
    for index, name in enumerate(sources):
        cy = y + row * index + row / 2
        chip = advance(name, 16, 500) + 28
        a.add(a.frame(x, cy - 16, chip, 32, f' fill="{t["raised"]}"'))
        a.add(a.text(x + 14, cy + 5.5, name, 16, t["ink"], 500))
        start = x + chip + 6
        middle = (start + target_x) / 2
        a.add(f'<path class="flow" d="M{start:.1f} {cy:.1f} C{middle:.1f} {cy:.1f} {middle:.1f} {target_y:.1f} {target_x:.1f} {target_y:.1f}" fill="none" stroke="{t["accent"]}" stroke-opacity=".6" stroke-width="1.8" stroke-dasharray="3 7" stroke-linecap="round"/>')
    for index in range(3):
        a.add(a.tile(target_x + 22 - index * 8, target_y - 44 + index * 7, 74, 3 - index))


def v_links(a, x, y, w, h):
    t = a.t
    a.rule("found", f"@keyframes found{{0%,22%{{opacity:0;transform:translateY(8px)}}34%,88%{{opacity:1;transform:none}}100%{{opacity:0}}}}.found{{animation:found 12s {EASE} infinite}}@keyframes type{{0%{{transform:scaleX(0)}}20%,92%{{transform:scaleX(1)}}100%{{transform:scaleX(0)}}}}.type{{transform-box:fill-box;transform-origin:left;animation:type 12s steps(30) infinite}}")
    a.add(a.frame(x, y, w, 50, f' fill="{t["raised"]}"'))
    a.add(a.icon("link", x + 15, y + 14, 22))
    link = "music.example/song/harbor-window"
    clip = a.uid("c")
    a.defs.append(f'<clipPath id="{clip}"><rect class="type" x="{x + 46}" y="{y + 6}" width="{advance(link, 17) + 6:.1f}" height="38"/></clipPath>')
    a.add(f'<g clip-path="url(#{clip})">{a.text(x + 48, y + 31, link, 17, t["ink"], 400, width=w - 62)}</g>')
    row = [a.tile(x + 8, y + 66, 56, 2), a.text(x + 78, y + 90, "Harbor Window", 20, t["ink"], 600), a.text(x + 78, y + 114, "Paper Satellites", 16, t["muted"])]
    a.add(f'<g class="found">{"".join(row)}</g>')


def v_local(a, x, y, w, h):
    t = a.t
    formats = ["MP3", "FLAC", "M4A", "AAC", "Ogg", "Opus", "WAV"]
    cursor = x
    line = y + 2
    frames = []
    for index, name in enumerate(formats):
        chip = advance(name, 16, 500) + 26
        if cursor + chip > x + w:
            cursor = x
            line += 42
        at = 4 + index * 5
        frames.append(f"@keyframes c{index}{{0%,{at}%{{opacity:.3}}{at + 4}%,90%{{opacity:1}}100%{{opacity:.3}}}}.c{index}{{animation:c{index} 16s ease-out infinite}}")
        surface = a.frame(cursor, line, chip, 32, f' fill="{t["raised"]}"')
        a.add(f'<g class="c{index}">{surface}{a.text(cursor + 13, line + 21.5, name, 16, t["ink"], 500)}</g>')
        cursor += chip + 8
    a.rule("chips", "".join(frames))
    bars = int(w / 7)
    base = line + 48
    wave_h = y + h - base
    shapes = []
    for index in range(bars):
        k = abs(math.sin(index * 0.47) * math.sin(index * 0.13 + 1))
        height = 6 + k * (wave_h - 6)
        shapes.append(f'<rect x="{x + index * 7:.1f}" y="{base + (wave_h - height) / 2:.1f}" width="3.4" height="{height:.1f}" rx="1.7"/>')
    clip = a.uid("c")
    a.defs.append(f'<clipPath id="{clip}"><rect class="sweep" x="{x}" y="{base}" width="{w}" height="{wave_h}"/></clipPath>')
    a.rule("sweep", "@keyframes sweep{0%{transform:scaleX(0)}88%,96%{transform:scaleX(1)}100%{transform:scaleX(0)}}.sweep{transform-box:fill-box;transform-origin:left;animation:sweep 16s linear infinite}")
    wave = "".join(shapes)
    a.add(f'<g fill="{t["accent"]}" opacity=".26">{wave}</g><g clip-path="url(#{clip})" fill="{t["accent"]}">{wave}</g>')


def v_security(a, x, y, w, h):
    t = a.t
    columns = 6 if w > 600 else 4
    rows = 24 // columns
    step_x = w / columns
    step_y = h / rows
    frames = []
    for index in range(24):
        cx = x + (index % columns) * step_x
        cy = y + (index // columns) * step_y
        at = 3 + index * 2.8
        tall = step_y - 8
        width = step_x - 8
        frames.append(f"@keyframes z{index}{{0%,{at:.1f}%{{transform:scaleX(0)}}{at + 2.4:.1f}%,90%{{transform:scaleX(1)}}100%{{transform:scaleX(0)}}}}.z{index}{{transform-box:fill-box;transform-origin:left;animation:z{index} 22s ease-out infinite}}")
        a.add(a.frame(cx, cy, width, tall, f' fill="{t["raised"]}" opacity=".8"'))
        a.add(a.text(cx + 12, cy + tall / 2 + 5, str(index + 1), 14, t["faint"], 500))
        a.add(f'<rect class="z{index}" x="{cx + 38:.1f}" y="{cy + tall / 2 - 2:.1f}" width="{width - 52:.1f}" height="4" rx="2" fill="{t["accent"]}"/>')
    a.rule("phrase", "".join(frames))


WIDGETS = {
    "library": ("library", "Library", "Likes, albums, artists and playlists in one encrypted file.", ("blue", "ice"), v_library),
    "mixes": ("radio", "Radio and mixes", "Ranked on your machine, from your plays.", ("sky", "red"), v_mixes),
    "sound": ("equalizer", "Sound", "Ten bands on one curve over a live spectrum, twelve presets, auto gain.", ("sky", "blue"), v_sound),
    "lyrics": ("lyrics", "Lyrics, word by word", "Synced highlight and a full-screen karaoke view.", ("ice", "blue"), v_lyrics),
    "imports": ("import", "Imports", "Bring playlists by link or by file.", ("blue", "yellow"), v_imports),
    "local": ("folder", "Local files", "Watched folders. Moved files keep their likes.", ("sky", "ice"), v_local),
    "links": ("link", "Links", "Paste a song link into Search.", ("blue", "sky"), v_links),
    "security": ("lock", "Security", "24-word recovery phrase. No account to lose.", ("ice", "blue"), v_security),
}


def widget(a, name, x, y, w, h):
    icon, title, sub, hues, vignette = WIDGETS[name]
    card(a, x, y, w, h, hues)
    pad = 28
    end = heading(a, x + pad, y + 26, icon, title, sub, w - pad * 2)
    top = end + 24
    vignette(a, x + pad, top, w - pad * 2, y + h - top - 26)


BANDS = {
    "band-a": ([("library", 590), ("mixes", 394)], 340),
    "band-b": ([("sound", 1000)], 340),
    "band-c": ([("lyrics", 450), ("imports", 534)], 360),
    "band-d": ([("local", 560), ("links", 424)], 320),
    "band-e": ([("security", 1000)], 330),
}


def band(key):
    items, height = BANDS[key]

    def draw(a, narrow):
        if narrow:
            for index, (name, _) in enumerate(items):
                widget(a, name, 0, index * (height + 14), a.width, height)
            return
        x = 0
        for name, width in items:
            widget(a, name, x, 0, width, a.height)
            x += width + 16
    return draw


def stamp():
    build = DATA["build"]
    return f"Measured {build['date']}, {build['short']}, median of {build['runs']} runs"


def perf_launch(a, narrow):
    t = a.t
    m = DATA["metrics"]
    card(a, 0, 0, a.width, a.height, ("blue", "ice"))
    pad = 30
    a.add(a.icon("speed", pad, 26, 30))
    a.add(a.text(pad + 42, 51, "Launch to Home", 28, t["ink"], 700))
    a.add(a.roll(pad, 132, f"{m['home']['p50']} ms", 70))
    a.add(a.text(pad, 166, stamp(), 14 if narrow else 16, t["muted"], width=a.width - 2 * pad))
    axis_y = 306 if narrow else 262
    x0, x1 = pad + 4, a.width - pad - 4
    scale = (x1 - x0) / 500
    a.rule("run", f"@keyframes run{{0%,2%{{transform:scaleX(0)}}22%,94%{{transform:scaleX(1)}}100%{{transform:scaleX(0)}}}}.run{{transform-box:fill-box;transform-origin:left;animation:run {LOOP}s {EASE} infinite}}")
    a.add(f'<rect x="{x0}" y="{axis_y - 3}" width="{x1 - x0}" height="6" rx="3" fill="{t["track"]}"/>')
    a.add(f'<rect class="run" x="{x0}" y="{axis_y - 3}" width="{m["home"]["p50"] * scale:.1f}" height="6" rx="3" fill="{t["accent"]}"/>')
    for key, label, side in (("windowText", "Window with text", -1), ("home", "Home shown", -1)):
        value = m[key]["p50"]
        px = x0 + value * scale
        a.add(f'<circle cx="{px:.1f}" cy="{axis_y}" r="7" fill="{t["panel"]}" stroke="{t["accent"]}" stroke-width="3"/>')
        ly = axis_y - 40 if side < 0 else axis_y + 44
        anchor = "end" if key == "windowText" else "start"
        ox = -12 if anchor == "end" else 12
        if narrow and key == "home":
            anchor, ox, ly = "end", 26, axis_y - 92
            a.add(f'<rect x="{px - 1:.1f}" y="{ly + 28}" width="2" height="{axis_y - ly - 36}" fill="{t["hair"]}"/>')
        a.add(a.text(px + ox, ly, f"{value} ms", 19, t["ink"], 700, anchor))
        a.add(a.text(px + ox, ly + 21, label, 15, t["muted"], 400, anchor))
    a.add(a.text(x0, axis_y + 28, "0", 15, t["faint"]))
    a.add(a.text(x1, axis_y + 28, "500 ms", 15, t["faint"], 400, "end"))


def perf_memory(a, narrow):
    t = a.t
    m = DATA["metrics"]
    pad = 30
    card(a, 0, 0, a.width, a.height, ("sky", "blue"))
    a.add(a.icon("database", pad, 26, 30))
    a.add(a.text(pad + 42, 51, "Memory, whole app", 28, t["ink"], 700, width=a.width - pad * 2 - 42))
    a.add(a.roll(pad, 104, f"{format_number(m['memIdle']['p50'])} MB", 44))
    text, end = a.paragraph(pad, 134, DATA["memoryNote"], 16 if narrow else 18, a.width - 2 * pad, 24, t["muted"])
    a.add(text)
    y = end + 36
    for index, (label, value, high) in enumerate(DATA["memoryBars"]):
        meter(a, pad, y + index * 56, a.width - pad * 2, label, value, "MB", 500, high)


def meter(a, x, y, w, label, value, unit, maximum, high=None):
    t = a.t
    a.add(a.text(x, y, label, 17, t["muted"], width=w * .7))
    a.add(a.roll(x + w, y, f"{format_number(value)} {unit}".strip(), 24, anchor="end"))
    bar_y = y + 12
    a.rule("fill", f"@keyframes fill{{0%,2%{{transform:scaleX(0)}}20%,94%{{transform:scaleX(1)}}100%{{transform:scaleX(0)}}}}.fill{{transform-box:fill-box;transform-origin:left;animation:fill {LOOP}s {EASE} infinite}}")
    a.add(f'<rect x="{x}" y="{bar_y}" width="{w}" height="8" rx="4" fill="{t["track"]}"/>')
    a.add(f'<rect class="fill" x="{x}" y="{bar_y}" width="{max(4, w * value / maximum):.1f}" height="8" rx="4" fill="{t["accent"]}"/>')
    if high:
        a.add(f'<rect x="{x + w * high / maximum:.1f}" y="{bar_y - 3}" width="2" height="14" rx="1" fill="{t["faint"]}"/>')


def perf_pair(a, narrow):
    t = a.t
    m = DATA["metrics"]
    pad = 28
    left, right = ((0, 0, a.width, 226), (0, 240, a.width, 226)) if narrow else ((0, 0, 560, a.height), (576, 0, 424, a.height))
    x, y, w, h = left
    card(a, x, y, w, h, ("blue", "red"))
    a.add(a.icon("stats", x + pad, y + 24, 30))
    a.add(a.text(x + pad + 42, y + 49, "Statistics page, 171,429 plays", 26, t["ink"], 700, width=w - pad * 2 - 42))
    meter(a, x + pad, y + 104, w - pad * 2, "Range switch", m["statsRange"]["p50"], "ms", 120, m["statsRange"]["high"])
    meter(a, x + pad, y + 164, w - pad * 2, "First open after a restart", m["statsFirst"]["p50"], "ms", 120, m["statsFirst"]["high"])
    x, y, w, h = right
    card(a, x, y, w, h, ("sky", "ice"))
    a.add(a.icon("stats", x + pad, y + 24, 30))
    a.add(a.text(x + pad + 42, y + 49, "CPU, one core", 26, t["ink"], 700))
    meter(a, x + pad, y + 104, w - pad * 2, "At idle", m["cpuIdle"]["p50"], "%", 5)
    meter(a, x + pad, y + 164, w - pad * 2, "While playing", m["cpuPlaying"]["p50"], "%", 5)


def perf_karaoke(a, narrow):
    t = a.t
    scale = DATA["karaoke"]
    pad = 30
    card(a, 0, 0, a.width, a.height, ("ice", "yellow"))
    a.add(a.icon("lyrics", pad, 26, 30))
    a.add(a.text(pad + 42, 51, "Karaoke, CPU of one core", 28, t["ink"], 700))
    rows = scale["rows"]
    if narrow:
        for index, row in enumerate(rows):
            y = 112 + index * 66
            a.add(a.roll(pad, y, row["value"], 30))
            a.add(a.text(pad, y + 24, row["label"], 15, t["muted"], width=a.width - pad * 2))
    else:
        step = (a.width - pad * 2) / len(rows)
        for index, row in enumerate(rows):
            x = pad + index * step
            a.add(a.roll(x, 124, row["value"], 38))
            text, _ = a.paragraph(x, 152, row["label"], 16, step - 22, 22)
            a.add(text)
    note, _ = a.paragraph(pad, a.height - (44 if narrow else 24), scale["note"], 14.5, a.width - pad * 2, 20, t["faint"])
    a.add(note)


def numbers(a, narrow):
    t = a.t
    items = list(DATA["metrics"].values())
    card(a, 0, 0, a.width, a.height, ("blue", "sky"))
    pad = 30
    a.add(a.text(pad, 48, "Every number, median to highest run", 24, t["ink"], 700, width=a.width - pad * 2))
    top = 90
    row = 66 if narrow else 44
    label_w = 0 if narrow else 400
    value_w = 150
    ruler_x = pad + label_w
    ruler_w = a.width - pad * 2 - label_w - value_w
    if narrow:
        ruler_w = a.width - pad * 2
    limits = {}
    for item in items:
        limits[item["unit"]] = max(limits.get(item["unit"], 0), item["high"])
    for index, item in enumerate(items):
        y = top + index * row
        scale = ruler_w / limits[item["unit"]]
        a.add(a.text(pad, y + 14, item["label"], 15 if narrow else 16, t["ink"], 500, width=a.width - pad * 2 - (110 if narrow else 0) if narrow else label_w - 12))
        value = f"{format_number(item['p50'])} {item['unit']}"
        a.add(a.text(a.width - pad, y + 14, value, 15 if narrow else 16, t["ink"], 700, "end"))
        ry = y + 36 if narrow else y + 9
        a.add(f'<rect x="{ruler_x}" y="{ry}" width="{ruler_w}" height="2" rx="1" fill="{t["track"]}"/>')
        a.add(f'<rect x="{ruler_x + item["p50"] * scale:.1f}" y="{ry - 2}" width="{max(3, (item["high"] - item["p50"]) * scale):.1f}" height="6" rx="3" fill="{t["accent"]}" opacity=".45"/>')
        a.add(f'<circle cx="{ruler_x + item["p50"] * scale:.1f}" cy="{ry + 1}" r="5" fill="{t["accent"]}"/>')


def pending_pill(a, x, y, anchor="start"):
    t = a.t
    label = DATA["pendingLabel"]
    w = advance(label, 14, 500) + 22
    if anchor == "end":
        x -= w
    a.add(a.frame(x, y - 17, w, 24, f' fill="none" stroke="{t["faint"]}" stroke-dasharray="3 4"'))
    a.add(a.text(x + 11, y, label, 14, t["muted"], 500))


def compare_chart(a, narrow):
    t = a.t
    comparison = DATA["comparison"]
    columns = [column for column in comparison["columns"] if column.get("chart", True)]
    apps = comparison["apps"]
    pad = 30
    card(a, 0, 0, a.width, a.height, ("sky", "blue"))
    a.add(a.text(pad, 52, "Idle memory", 27, t["ink"], 700))
    a.add(a.text(a.width - pad, 50, f"Measured {comparison['date']}", 16, t["muted"], 400, "end"))
    text, end = a.paragraph(pad, 84, comparison["claim"], 17, a.width - pad * 2, 24, t["ink"])
    a.add(text)
    known = [app["idleMemoryMb"] for app in apps if app["idleMemoryMb"] is not None]
    maximum = max(known) * 1.04
    name_w = 0 if narrow else 150
    row_h = 62 if narrow else 46
    top = end + 46
    bar_x = pad + name_w
    extras_w = 0 if narrow else 100 + 84 * (len(columns) - 1)
    bar_w = a.width - pad * 2 - name_w - extras_w
    if not narrow:
        for index, column in enumerate(columns[1:]):
            a.add(a.text(a.width - pad - extras_w + 92 + index * 84, top - 14, column["label"], 13.5, t["faint"], 500, "end", width=84))
    for index, app in enumerate(apps):
        y = top + index * row_h
        lead = app["name"] == "Nuvo"
        memory = app["idleMemoryMb"]
        a.add(a.text(pad, y + (14 if narrow else 21), app["name"], 18, t["ink"], 700 if lead else 500))
        bar_y = y + 26 if narrow else y + 6
        if memory is None:
            if narrow:
                pending_pill(a, a.width - pad, y + 16, "end")
            else:
                pending_pill(a, bar_x, y + 22)
        else:
            width = bar_w * memory / maximum
            a.add(f'<rect x="{bar_x}" y="{bar_y}" width="{width:.1f}" height="22" rx="11" fill="{t["accent"] if lead else t["faint"]}" opacity="{1 if lead else .55}"/>')
            value = f"{format_number(memory)} MB"
            if narrow:
                a.add(a.text(a.width - pad, y + 14, value, 16, t["ink"], 700, "end"))
            else:
                if width < 110:
                    a.add(a.text(bar_x + width + 10, bar_y + 16.5, value, 15, t["ink"], 700))
                else:
                    a.add(a.text(bar_x + width - 10, bar_y + 16.5, value, 15, t["onAccent"] if lead else "#101320", 700, "end"))
        if not narrow:
            for column_index, column in enumerate(columns[1:]):
                cx = a.width - pad - extras_w + 92 + column_index * 84
                value = app[column["key"]]
                shown = app.get("display", {}).get(column["key"])
                if shown:
                    a.add(a.text(cx, y + 21, shown["chart"], 15.5, t["muted"], 500, "end"))
                elif value is None:
                    a.add(f'<rect x="{cx - 26}" y="{y + 15}" width="26" height="2" rx="1" fill="{t["faint"]}" opacity=".7"/>')
                else:
                    a.add(a.text(cx, y + 21, f"{format_number(value)} {column['unit']}".strip(), 15.5, t["ink"], 500, "end"))
    if not narrow:
        a.add(a.text(a.width - pad, a.height - 24, f"A dash means {DATA['pendingLabel']}.", 14.5, t["faint"], 400, "end"))


MATRIX_COLUMNS = ["Nuvo", "Riff", "Liner", "Spotify", "YouTube Music", "Apple Music", "Strawberry"]
MATRIX_PANELS = {
    "Playback and sound": ("equalizer", ("blue", "sky")),
    "Lyrics": ("lyrics", ("sky", "blue")),
    "Discovery": ("radio", ("sky", "blue")),
    "Search, links and sharing": ("link", ("blue", "sky")),
    "Library and files": ("library", ("sky", "blue")),
    "Look and feel": ("palette", ("blue", "sky")),
    "Privacy and system": ("lock", ("blue", "sky")),
}
MATRIX_WORDS = {"y": "yes", "p": "partly", "n": "no", "u": "unknown"}
LABEL_SIZE = 16.5
FLAG_SIZE = 16
WIDE_HEAD, WIDE_ROW = 106, 46
NARROW_HEAD, NARROW_LINE, NARROW_ROW, NARROW_NAMES, NARROW_REPEAT = 104, 21, 44, 42, 8
WIDE_LEAD, WIDE_COLUMN = 84, 74
NARROW_LEAD, NARROW_GAP = 46, 12


def matrix_cells(row):
    apps = DATA["matrix"]["apps"]
    if len(row["cells"]) != len(apps):
        raise ValueError(f"{row['label']}: needs {len(apps)} cells")
    return [row["cells"][apps.index(name)] for name in MATRIX_COLUMNS]


def matrix_slug(group):
    return "compare-matrix-" + re.sub(r"[^a-z]+", "-", group["name"].lower())


def matrix_marks(a):
    t = a.t
    marks = (("m", t["accent"], t["onAccent"], t["muted"], t["faint"]), ("l", t["onAccent"], t["accent"], t["onAccent"], t["onAccent"]))
    for prefix, main, inner, cross, dot in marks:
        a.defs.append(f'<g id="{prefix}y">{a.frame(-11, -11, 22, 22, f" fill=\"{main}\"")}{a.icon("check", -8, -8, 16, inner)}</g>')
        half = a.clip(-10, -10, 20, 20)
        a.defs.append(f'<g id="{prefix}p">{a.frame(-10, -10, 20, 20, f" fill=\"none\" stroke=\"{main}\" stroke-width=\"2\"")}<polygon clip-path="url(#{half})" points="-10,-10 10,10 -10,10" fill="{main}"/></g>')
        a.defs.append(f'<g id="{prefix}n">{a.icon("close", -9, -9, 18, cross)}</g>')
        a.defs.append(f'<circle id="{prefix}u" r="2.5" fill="{dot}" opacity=".65"/>')


def matrix_card(a, hues):
    card(a, 0, 0, a.width, a.height, hues)
    matrix_marks(a)


def use_mark(prefix, state, x, y):
    return f'<use href="#{prefix}{state}" x="{x:.1f}" y="{y:.1f}"/>'


def label_lines(row, narrow):
    width = label_width(narrow) - (FLAG_SIZE + 8 if "branch" in row else 0)
    return wrap(row["label"], LABEL_SIZE, width)


def label_width(narrow):
    if narrow:
        return 480 - 16 - 20 - NARROW_LEAD - NARROW_GAP
    return 1000 - 30 * 2 - WIDE_LEAD - WIDE_COLUMN * 6 - 14


def narrow_row(row):
    return NARROW_ROW + NARROW_LINE * len(label_lines(row, True))


def matrix_height(group, narrow):
    rows = group["rows"]
    if not narrow:
        return WIDE_HEAD + WIDE_ROW * len(rows) + 28
    repeats = (len(rows) - 1) // NARROW_REPEAT
    return NARROW_HEAD + NARROW_NAMES * (repeats + 1) + sum(narrow_row(row) for row in rows) + 28


def matrix_label(a, x, baseline, row, lines, line_height):
    for index, line in enumerate(lines):
        a.add(a.text(x, baseline + index * line_height, line, LABEL_SIZE, a.t["ink"]))
    if "branch" in row:
        end = x + advance(lines[-1], LABEL_SIZE) + 8
        a.add(a.icon("clock", end, baseline + (len(lines) - 1) * line_height - FLAG_SIZE + 3, FLAG_SIZE, a.t["accent"]))


def matrix_names(a, centers, bottom, size):
    for cx, name in zip(centers, MATRIX_COLUMNS[1:], strict=True):
        lines = wrap(name, size, 66)
        for index, line in enumerate(lines):
            a.add(a.text(cx, bottom - (len(lines) - 1 - index) * (size + 3), line, size, a.t["ink"], 500, "middle", width=72))


def matrix_row_marks(a, row, lead_cx, centers, middle):
    cells = matrix_cells(row)
    a.add(use_mark("l", cells[0], lead_cx, middle))
    a.add("".join(use_mark("m", state, cx, middle) for cx, state in zip(centers, cells[1:], strict=True)))


def matrix_panel(group):
    icon, hues = MATRIX_PANELS[group["name"]]
    flagged = sum("branch" in row for row in group["rows"])
    sub = f"{len(group['rows'])} features" + (f", {flagged} not merged yet" if flagged else "")

    def draw(a, narrow):
        matrix_card(a, hues)
        if narrow:
            draw_narrow(a)
        else:
            draw_wide(a)

    def draw_wide(a):
        t = a.t
        pad = 30
        lead_x = a.width - pad - WIDE_COLUMN * 6 - WIDE_LEAD
        lead_cx = lead_x + WIDE_LEAD / 2
        centers = [lead_x + WIDE_LEAD + WIDE_COLUMN * (index + .5) for index in range(6)]
        heading(a, pad, 28, icon, group["name"], sub, lead_x - pad - 14)
        top = WIDE_HEAD
        for index, row in enumerate(group["rows"]):
            a.add(f'<rect x="{pad}" y="{top + WIDE_ROW * index}" width="{a.width - pad * 2}" height="1" fill="{t["hair"]}"/>')
        a.add(a.frame(lead_x, 20, WIDE_LEAD, a.height - 40, f' fill="{t["accent"]}"'))
        a.add(a.mark(lead_cx - 11, 40, 22, t["onAccent"]))
        a.add(a.text(lead_cx, top - 16, "Nuvo", 16, t["onAccent"], 700, "middle"))
        matrix_names(a, centers, top - 16, 14)
        for index, row in enumerate(group["rows"]):
            y = top + WIDE_ROW * index
            middle = y + WIDE_ROW / 2
            lines = label_lines(row, False)
            matrix_label(a, pad, middle + 6 - (len(lines) - 1) * 9.5, row, lines, 19)
            matrix_row_marks(a, row, lead_cx, centers, middle)

    def draw_narrow(a):
        t = a.t
        pad = 20
        left = pad + NARROW_LEAD + NARROW_GAP
        column = (a.width - 16 - left) / 6
        lead_cx = pad + NARROW_LEAD / 2
        centers = [left + column * (index + .5) for index in range(6)]
        heading(a, pad, 26, icon, group["name"], sub, a.width - pad * 2)
        top = NARROW_HEAD
        a.add(a.frame(pad, top, NARROW_LEAD, a.height - top - 20, f' fill="{t["accent"]}"'))
        y = top
        for index, row in enumerate(group["rows"]):
            if index % NARROW_REPEAT == 0:
                a.add(a.text(lead_cx, y + 32, "Nuvo", 13.5, t["onAccent"], 700, "middle"))
                matrix_names(a, centers, y + 32, 13)
                y += NARROW_NAMES
            a.add(f'<rect x="{left}" y="{y}" width="{a.width - 16 - left:.1f}" height="1" fill="{t["hair"]}"/>')
            lines = label_lines(row, True)
            matrix_label(a, left, y + 23, row, lines, NARROW_LINE)
            middle = y + NARROW_LINE * len(lines) + 20
            matrix_row_marks(a, row, lead_cx, centers, middle)
            y += narrow_row(row)
    return draw


def compare_head(a, narrow):
    t = a.t
    data = DATA["matrix"]
    matrix_card(a, ("blue", "sky"))
    end = title_block(a, "list", "Next to other players", f"{data['total']} Nuvo features. Each cell comes from a public source or says it does not.")
    x = 30
    y = end + 38
    for state, label in (("y", "Yes"), ("p", "Partly"), ("n", "No"), ("u", "Unknown, no source found"), (None, "Not merged yet")):
        width = 28 + advance(label, 16.5)
        if x + width > a.width - 30:
            x = 30
            y += 32
        if state:
            a.add(use_mark("m", state, x + 11, y - 6))
        else:
            a.add(a.icon("clock", x + 3, y - 14, FLAG_SIZE))
        a.add(a.text(x + 28, y, label, 16.5, t["ink"]))
        x += width + 26


def roadmap_rows(width, weights):
    unit = (width - 60 - 18 * 3) / sum(weights)
    return [weight * unit for weight in weights]


def roadmap(a, narrow):
    t = a.t
    stages = DATA["roadmap"]["stages"]
    card(a, 0, 0, a.width, a.height, ("blue", "yellow"))
    icons = ["check", "forward", "clock", "close"]
    if narrow:
        y = 28
        for index, stage in enumerate(stages):
            a.add(a.icon(icons[index], 28, y, 22))
            a.add(a.text(60, y + 19, stage["title"], 23, t["ink"], 700))
            for item_index, item in enumerate(stage["items"]):
                a.add(a.text(60, y + 50 + item_index * 27, item, 16.5, t["muted"], width=a.width - 80))
            y += 50 + 27 * len(stage["items"]) + 12
        return
    widths = roadmap_rows(a.width, ROADMAP_WEIGHTS)
    x = 30
    for index, stage in enumerate(stages):
        a.add(a.icon(icons[index], x, 30, 22))
        a.add(a.text(x + 32, 49, stage["title"], 23, t["ink"], 700))
        y = 90
        for item in stage["items"]:
            text, end = a.paragraph(x, y, item, 16, widths[index] - 8, 22)
            a.add(text)
            y = end + 28
        x += widths[index] + 18


ROADMAP_WEIGHTS = [1.15, 1.2, 1, .95]


def roadmap_height():
    widths = roadmap_rows(1000, ROADMAP_WEIGHTS)
    tallest = 0
    for width, stage in zip(widths, DATA["roadmap"]["stages"]):
        lines = sum(len(wrap(item, 16, width - 8)) for item in stage["items"])
        tallest = max(tallest, lines * 22 + len(stage["items"]) * 6)
    return 90 + tallest + 18


def roadmap_narrow_height():
    return 28 + sum(50 + 27 * len(stage["items"]) + 12 for stage in DATA["roadmap"]["stages"]) + 6


def download_art(theme):
    label = "Download"
    size, height = 19, 54
    width = round(advance(label, size, 700) + 84)
    a = Art(theme, width, height, label)
    t = a.t
    a.rule("drop", f"@keyframes drop{{0%,70%,100%{{transform:translateY(0)}}82%{{transform:translateY(4px)}}}}.drop{{animation:drop 5s {EASE} infinite}}")
    clip = a.clip(0, 0, width, height)
    a.rule("sheen", "@keyframes sheen{0%,60%{transform:translateX(-120%)}100%{transform:translateX(420%)}}.sheen{animation:sheen 9s ease-in-out infinite}")
    a.add(f'<g clip-path="url(#{clip})"><rect width="{width}" height="{height}" fill="{t["accent"]}"/><rect class="sheen" width="{width * .3:.0f}" height="{height}" fill="#fff" opacity=".22"/></g>')
    a.add(f'<g class="drop">{a.icon("download", 26, 16, 22, t["onAccent"], 2.2)}</g>')
    a.add(a.text(58, 34, label, size, t["onAccent"], 700))
    return a


def docs_art(theme):
    label = "Read the docs"
    size, height = 19, 54
    width = round(advance(label, size, 600) + 56)
    a = Art(theme, width, height, label)
    t = a.t
    a.add(a.frame(0, 0, width, height, f' fill="{t["raised"]}"'))
    a.add(a.text(width / 2, 34, label, size, t["ink"], 600, "middle"))
    return a


def plate(a, bleed=False):
    t = a.t
    w, h = a.width, a.height
    clip = a.clip(-99, -99, w + 198, h + 198) if bleed else a.clip(0, 0, w, h)
    a.add(
        f'<g clip-path="url(#{clip})"><rect width="{w}" height="{h}" fill="{a.gradient(t["fieldFrom"], t["fieldTo"], 0, 0, 0, 1)}"/>',
        a.glow(round(w * 0.62), round(h * 0.5), round(w * 0.62), round(h * 0.9), t["glow"], t["glowOpacity"]),
        a.glow(round(w * 0.5), round(h * 0.75), round(w * 0.3), round(h * 0.6), WARM["deep"], t["coverOpacity"] * 0.36),
        a.glow(round(w * 0.9), round(h * 0.1), round(w * 0.3), round(h * 0.6), HUES["ice"], t["coverOpacity"]),
        "</g>",
    )
    return clip


def social(a):
    t = a.t
    plate(a, bleed=True)
    a.add(wordmark(a, 72, 268, 204, t["ink"]))
    for index, line in enumerate(wrap(DATA["tagline"], 62, 520, 600)):
        a.add(a.text(76, 368 + index * 76, line, 62, t["ink"], 600, tracking=-0.012))
    a.add(app_window(a, 640, 96, 900))


def release_head(a):
    t = a.t
    clip = plate(a)
    a.add(wordmark(a, 44, 132, 124, t["ink"]))
    a.add(a.text(46, 184, DATA["tagline"], 30, t["ink"], 600, tracking=-0.01))
    a.add(f'<g clip-path="url(#{clip})">{app_window(a, 530, 48, 620)}</g>')
    a.add(a.frame(.5, .5, a.width - 1, a.height - 1, f' fill="none" stroke="{t["edge"]}"'))


def page_head(a, narrow):
    t = a.t
    plate(a)
    if narrow:
        a.add(wordmark(a, 24, 61, 54, t["ink"]))
        a.add(a.text(a.width - 24, 61, DATA["tagline"], 20, t["ink"], 600, "end"))
    else:
        a.add(wordmark(a, 32, 77, 70, t["ink"]))
        a.add(a.text(a.width - 40, 77, DATA["tagline"], 26, t["ink"], 600, "end", -0.01))
    a.add(a.frame(.5, .5, a.width - 1, a.height - 1, f' fill="none" stroke="{t["edge"]}"'))


def rasterize(art, target, scale=1):
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    if not chrome:
        print(f"no Chrome, kept {target.name}")
        return
    with tempfile.TemporaryDirectory(dir=Path.home() / ".cache") as temp:
        page = Path(temp) / "art.html"
        page.write_text(f"<!doctype html><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style>{art.render()}")
        subprocess.run([
            chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={temp}/profile",
            f"--force-device-scale-factor={scale}", f"--window-size={art.width},{art.height}",
            "--default-background-color=00000000", f"--screenshot={target}", page.as_uri(),
        ], check=True, capture_output=True)


def build_png():
    a = Art(SOCIAL_THEME, 1280, 640, "Nuvo. " + DATA["tagline"])
    social(a)
    rasterize(a, HERE / "social.png")
    for theme in THEMES:
        a = Art(theme, 1000, 240, "Nuvo. " + DATA["tagline"])
        release_head(a)
        rasterize(a, HERE / f"release-{theme}.png", 2)
        a = Art(theme, 1000, 104, "Nuvo. " + DATA["tagline"])
        page_head(a, False)
        rasterize(a, HERE / f"page-head-{theme}.png", 2)


def wide_narrow(name, title, wide, narrow, draw):
    for theme in THEMES:
        for suffix, size, is_narrow in (("", wide, False), ("-narrow", narrow, True)):
            if size is None:
                continue
            a = Art(theme, size[0], size[1], title)
            draw(a, is_narrow)
            (HERE / f"{name}{suffix}-{theme}.svg").write_text(a.render())


def band_size(key):
    items, height = BANDS[key]
    return (1000, height), (480, height * len(items) + 14 * (len(items) - 1))


def build_art():
    for old in HERE.glob("*.svg"):
        old.unlink()
    wide_narrow("hero", "Nuvo. " + DATA["tagline"], (1000, 410), (480, 302), hero)
    wide_narrow("page-head", "Nuvo. " + DATA["tagline"], (1000, 104), (480, 84), page_head)
    wide_narrow("section-story", "A small Rust core", (1000, 330), (480, 616), story)
    wide_narrow("section-see", "See it move", (1000, 216), (480, 276), see)
    wide_narrow("section-features", "Everything in the box", (1000, 190), (480, 200), features_head)
    wide_narrow("section-themes", "Themes", (1000, 128), (480, 150), plain_head("palette", "Themes", "Nine presets. Below, one window cut into nine real captures.", ("ice", "red")))
    wide_narrow("section-how", "How it works", (1000, 128), (480, 150), plain_head("widget", "How it works", "Three parts and one private socket between them.", ("blue", "ice")))
    wide_narrow("section-compare", "Next to other players", (1000, 176), (480, 236), compare_head)
    for name, spec in BANNERS.items():
        wide = BANNER_WIDE + BANNER_MARGIN[0] * 2
        narrow = BANNER_NARROW + BANNER_MARGIN[0] * 2
        wide_narrow(f"banner-{name}", spec["title"], banner_size(spec, wide, False), banner_size(spec, narrow, True), banner(spec))
    wide_narrow("section-roadmap", "Roadmap", (1000, roadmap_height()), (480, roadmap_narrow_height()), roadmap)
    for key in BANDS:
        wide, narrow = band_size(key)
        wide_narrow(key, ", ".join(WIDGETS[name][1] for name, _ in BANDS[key][0]), wide, narrow, band(key))
    wide_narrow("perf-launch", "Launch timeline", (1000, 340), (480, 384), perf_launch)
    wide_narrow("perf-memory", "Memory, whole app", (1000, 388), (480, 420), perf_memory)
    wide_narrow("perf-pair", "Statistics open time and CPU", (1000, 226), (480, 466), perf_pair)
    wide_narrow("perf-karaoke", "Karaoke CPU", (1000, 244), (480, 420), perf_karaoke)
    metrics = len(DATA["metrics"])
    wide_narrow("numbers", "Every number, median to highest run", (1000, 100 + metrics * 44), (480, 100 + metrics * 66), numbers)
    for group in DATA["matrix"]["groups"]:
        wide_narrow(matrix_slug(group), group["name"], (1000, matrix_height(group, False)), (480, matrix_height(group, True)), matrix_panel(group))
    apps = len(DATA["comparison"]["apps"])
    wide_narrow("compare-chart", "Measured comparison", (1000, 200 + apps * 46), (480, 176 + apps * 62), compare_chart)
    for theme in THEMES:
        (HERE / f"button-download-{theme}.svg").write_text(download_art(theme).render())
        (HERE / f"button-docs-{theme}.svg").write_text(docs_art(theme).render())


def picture(name, alt, width="100%", root=ASSET_PATH):
    base = f"{root}/{name}"
    sources = []
    if (HERE / f"{name}-narrow-dark.svg").exists():
        sources.append(f'<source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="{base}-narrow-dark.svg">')
        sources.append(f'<source media="(max-width: 640px)" srcset="{base}-narrow-light.svg">')
    sources.append(f'<source media="(prefers-color-scheme: dark)" srcset="{base}-dark.svg">')
    return f'<picture>{"".join(sources)}<img src="{base}-light.svg" width="{width}" alt="{html.escape(alt, quote=True)}"></picture>'


def inline(name, alt, height):
    base = f"{ASSET_PATH}/{name}"
    return f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}-dark.svg"><img src="{base}-light.svg" height="{height}" alt="{html.escape(alt, quote=True)}"></picture>'


def media(name, kind, alt):
    base = f"{ASSET_PATH}/shots/{name}"
    return f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}-dark.{kind}"><img src="{base}-light.{kind}" width="100%" alt="{html.escape(alt, quote=True)}"></picture>'


def badges():
    base = f"{ASSET_PATH}/badges"
    tech = [("Linux", True), ("Rust", False), ("Electron", False), ("React", True), ("TypeScript", False), ("SQLite", False)]
    icons = []
    for name, themed in tech:
        if themed:
            icons.append(f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}/{name}-Dark.svg"><img src="{base}/{name}-Light.svg" height="38" alt="{name}"></picture>')
        else:
            icons.append(f'<img src="{base}/{name}.svg" height="38" alt="{name}">')
    shields = []
    for name, alt in (("version", f"Version {DATA['version']}"), ("licence", "Licence AGPL-3.0-or-later")):
        shields.append(f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}/{name}-dark.svg"><img src="{base}/{name}-light.svg" height="20" alt="{alt}"></picture>')
    return "&nbsp;".join(icons) + "\n\n" + "\n".join(shields)


def metric(key):
    item = DATA["metrics"][key]
    return f"{format_number(item['p50'])} {item['unit']}"


def comparison_cell(app, column):
    key = column["key"]
    shown = app.get("display", {}).get(key)
    if shown:
        return shown["table"]
    value = app[key]
    if value is None:
        return DATA["pendingLabel"]
    text = f"{format_number(value)} {column['unit']}".strip()
    low_high = app.get("spread", {}).get(key)
    return f"{text} ({format_number(low_high[0])} to {format_number(low_high[1])})" if low_high else text


def comparison_table():
    columns = DATA["comparison"]["columns"]
    rows = ["| App | " + " | ".join(column["label"] for column in columns) + " |", "|---|" + "---|" * len(columns)]
    for app in DATA["comparison"]["apps"]:
        rows.append(f"| {app['name']} | " + " | ".join(comparison_cell(app, column) for column in columns) + " |")
    return "\n".join(rows)


def cell_word(state):
    return "*unknown*" if state == "u" else MATRIX_WORDS[state].capitalize()


def matrix_alt(group):
    columns = list(zip(MATRIX_COLUMNS, zip(*(matrix_cells(row) for row in group["rows"]), strict=True), strict=True))
    parts = []
    for name, states in columns:
        parts.append(name + ": " + ", ".join(f"{states.count(state)} {word}" for state, word in MATRIX_WORDS.items() if state in states))
    flagged = [row["label"] for row in group["rows"] if "branch" in row]
    note = f" Not merged yet: {'; '.join(flagged)}." if flagged else ""
    return f"{group['name']}, {len(group['rows'])} features. " + "; ".join(parts) + "." + note + " Every row is in the plain tables under the art."


def matrix_panels():
    return "\n\n".join(picture(matrix_slug(group), matrix_alt(group)) for group in DATA["matrix"]["groups"])


def matrix_tables():
    data = DATA["matrix"]
    lines = [f"**{data['total']} features in Nuvo.** Each row is a Nuvo feature. *unknown* means we found no source; it is not a no."]
    for group in data["groups"]:
        rows = ["| Feature | " + " | ".join(MATRIX_COLUMNS) + " |", "|---|" + "---|" * len(MATRIX_COLUMNS)]
        for row in group["rows"]:
            label = row["label"] + (" (not merged yet)" if "branch" in row else "")
            rows.append(f"| {label} | " + " | ".join(cell_word(state) for state in matrix_cells(row)) + " |")
        lines.append(f"#### {group['name']} ({len(group['rows'])})\n\n" + "\n".join(rows))
    return f"<details>\n<summary><b>All {data['total']} rows as plain tables</b></summary>\n\n<br>\n\n" + "\n\n".join(lines) + "\n\n</details>"


def numbers_alt():
    return "; ".join(f"{item['label']}: p50 {format_number(item['p50'])} {item['unit']}, high {format_number(item['high'])} {item['unit']}" for item in DATA["metrics"].values())


def build_readme():
    build = DATA["build"]
    comparison = DATA["comparison"]
    values = {
        "hero": picture("hero", "Nuvo. " + DATA["tagline"] + " The Home window with mixes rises in front of the name."),
        "badges": badges(),
        "download": f'<a href="{DATA["repo"]}/releases">{inline("button-download", "Download", 54)}</a>',
        "docs": f'<a href="{DATA["site"]}/docs">{inline("button-docs", "Read the docs", 54)}</a>',
        "support": f'<a href="{DATA["site"]}/donate">{picture("banner-support", "Support the author. Nuvo stays free.", BANNER_WIDE + BANNER_MARGIN[0] * 2)}</a>',
        "download-card": f'<a href="{DATA["repo"]}/releases">{picture("banner-download", "Download Nuvo. Free, for Linux, Windows and macOS.", BANNER_WIDE + BANNER_MARGIN[0] * 2)}</a>',
        "telegram-card": f'<a href="https://t.me/getnuvo">{picture("banner-telegram", "Join the Nuvo channel on Telegram: @getnuvo, news and releases.", BANNER_WIDE + BANNER_MARGIN[0] * 2)}</a>',
        "shot-themes": media("themes", "webp", "One Home window cut into nine strips, each a real capture of one theme preset"),
        "gif-karaoke": media("karaoke", "gif", "The karaoke view lighting up an invented demo song word by word"),
        "gif-eq": media("eq", "gif", "Dragging equalizer bands over a moving spectrum"),
        "gif-home": media("home", "gif", "Home with mixes while the page scrolls"),
        "gif-player": media("player", "gif", "The queue opening beside Home while the track changes"),
        "gif-editor": media("editor", "gif", "Changing the accent colour in the theme editor while the app repaints"),
        "gif-tour": media("tour", "gif", "The welcome tour stepping through the player and the sound panel"),
        "comparison-table": comparison_table(),
        "comparison-method": comparison["method"],
        "compare-panels": matrix_panels(),
        "compare-tables": matrix_tables(),
        "matrix-notes": "\n".join(f"- {note}" for note in DATA["matrix"]["notes"]),
        "matrix-sources": ", ".join(f"[{source['name']}]({source['url']})" for source in DATA["matrix"]["sources"]),
        "matrix-checked": DATA["matrix"]["checked"],
        "build-date": build["date"],
        "build-label": build["label"],
        "build-machine": build["machine"],
        "build-runs": str(build["runs"]),
        "repo": DATA["repo"],
        "site": DATA["site"],
        "version": DATA["version"],
        "prerelease": DATA["prerelease"],
        "unsigned": DATA["unsigned"],
        "pending": DATA["pendingLabel"],
    }
    alts = {
        "section-story": "A small Rust core behind the window. A memory map, one square per megabyte of the whole app at idle.",
        "section-see": "See it move: " + ", ".join(CHAPTERS) + ".",
        "section-features": "Everything in the box. No account, no plan to choose, nothing locked.",
        "section-themes": "Themes. Nine presets.",
        "section-how": "How it works.",
        "section-compare": f"Next to other players. {DATA['matrix']['total']} Nuvo features. Legend for the panels below: a filled mark is yes, a half-filled mark is partly, a cross is no, a faint dot is unknown, meaning no source was found.",
        "section-roadmap": "; ".join(f"{stage['title']}: {', '.join(stage['items'])}" for stage in DATA["roadmap"]["stages"]),
        "perf-launch": f"Launch timeline: window with text at {metric('windowText')}, Home shown at {metric('home')}.",
        "perf-memory": "Memory of the whole app: " + ", ".join(f"{label} {format_number(value)} MB" for label, value, _ in DATA["memoryBars"]) + ".",
        "perf-pair": f"Statistics page with 171,429 plays: {metric('statsRange')} to switch range, {metric('statsFirst')} for the first open after a restart. CPU: {metric('cpuIdle')} at idle, {metric('cpuPlaying')} while playing.",
        "perf-karaoke": "Karaoke CPU, one core: " + ", ".join(f"{row['label']} {row['value']}" for row in DATA["karaoke"]["rows"]) + ".",
        "numbers": numbers_alt(),
        "compare-chart": comparison["claim"] + " " + ", ".join(f"{app['name']} {format_number(app['idleMemoryMb'])} MB" if app["idleMemoryMb"] is not None else f"{app['name']} {DATA['pendingLabel']}" for app in comparison["apps"]) + ".",
    }
    for key, (items, _) in BANDS.items():
        alts[key] = " ".join(f"{WIDGETS[name][1]}: {WIDGETS[name][2]}" for name, _ in items)
    text = (HERE / "README.template.md").read_text()
    for key, alt in alts.items():
        text = text.replace("{{pic:" + key + "}}", picture(key, alt))
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError("unfilled placeholder: " + text[text.index("{{"):][:40])
    (ROOT / "README.md").write_text(text)


def page_nav(target):
    items = []
    for label, path in NAV:
        link = os.path.relpath(ROOT / path, target.parent)
        items.append(f"**{label}**" if ROOT / path == target else f"[{label}]({link})")
    return "<sub>" + " · ".join(items + [f"[Docs]({DATA['site']}/docs)"]) + "</sub>"


def form_head():
    """Issue forms resolve no relative paths"""
    base = f"{DATA['repo']}/raw/main/{ASSET_PATH}/page-head"
    return f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}-dark.png"><img src="{base}-light.png" width="100%" alt="Nuvo"></picture>'


def build_pages():
    for source in PAGES.rglob("*"):
        if not source.is_file():
            continue
        target = ROOT / source.relative_to(PAGES)
        values = {
            "head": picture("page-head", "Nuvo. " + DATA["tagline"], root=os.path.relpath(HERE, target.parent)),
            "nav": page_nav(target),
            "form-head": form_head(),
            "site": DATA["site"],
            "repo": DATA["repo"],
            "version": DATA["version"],
        }
        text = source.read_text()
        for key, value in values.items():
            text = text.replace("{{" + key + "}}", value)
        if "{{" in text:
            raise ValueError(f"{source.name}: unfilled placeholder: " + text[text.index("{{"):][:40])
        note = "Generated by .github/readme/build.py. Edit .github/readme/pages/ and data.json, not this file."
        target.write_text((f"# {note}\n" if target.suffix == ".yml" else f"<!-- {note} -->\n") + text)


if __name__ == "__main__":
    build_art()
    build_readme()
    build_pages()
    build_png()
    total = sum(path.stat().st_size for path in HERE.glob("*.svg"))
    print(f"{len(list(HERE.glob('*.svg')))} SVGs, {total / 1024:.0f} KB")
