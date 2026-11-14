#!/usr/bin/env python3
import base64
import html
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = json.loads((HERE / "data.json").read_text())
BENCH = json.loads((HERE / "bench.json").read_text())
MEDIA = json.loads((HERE / "media.json").read_text())
FONT = json.loads((HERE / "glyphs.json").read_text())["weights"]
TOKENS = json.loads((ROOT / "src/data/look/presetTokens.json").read_text())["nuvo"]["tokens"]
ICONS = ROOT / "src/ui/icons/svg"
BRANDS = HERE / "brands"
SHOTS = HERE / "shots"
PAGES = HERE / "pages"
ASSETS = ".github/readme"
THEMES = ("light", "dark")
WIDE, NARROW = 1000, 480
RADIUS = 28
WINDOW_RADIUS = 10
EASE = "cubic-bezier(.2,.7,.2,1)"
MARK = (
    "M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 "
    "A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 "
    "L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z"
)
NAV = [("Contributing", "CONTRIBUTING.md"), ("Security", "SECURITY.md"), ("Code of conduct", "CODE_OF_CONDUCT.md"), ("Support", ".github/SUPPORT.md")]
MATRIX_WORDS = {"y": "yes", "p": "partly", "n": "no", "u": "unknown"}


def palette(theme):
    tokens = {key.removeprefix("n-"): value for key, value in TOKENS[theme].items()}
    card = tokens["field"] if theme == "light" else tokens["raised"]
    shadow = "rgba(16, 19, 32, 0.16)" if theme == "light" else "rgba(0, 0, 0, 0.5)"
    return {**tokens, "card": card, "shadow": shadow}


def advance(text, size, weight=600, tracking=0.0):
    table = FONT[str(weight)]
    units = sum(table["glyphs"][char]["a"] + table["kern"].get(text[index:index + 2], 0) for index, char in enumerate(text))
    return units * size / 1000 + tracking * size * len(text)


def greedy(text, size, width, weight):
    lines = []
    for word in text.split():
        if lines and advance(f"{lines[-1]} {word}", size, weight) <= width:
            lines[-1] += f" {word}"
        else:
            lines.append(word)
    return lines


def wrap(text, size, width, weight=600):
    lines = greedy(text, size, width, weight)
    while width > 0 and len(greedy(text, size, width - 8, weight)) == len(lines):
        width -= 8
        lines = greedy(text, size, width, weight)
    return lines


def inner_svg(path):
    return re.sub(r"^<svg[^>]*>|</svg>\s*$", "", path.read_text().strip())


def encode(image, width):
    if image.width > width:
        image = image.resize((round(width), round(image.height * width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=84, method=6)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode()


def shot_path(key, theme):
    return next(path for path in (SHOTS / f"{key}-{theme}.webp", SHOTS / f"{key}-{theme}.gif") if path.exists())


class Art:
    def __init__(self, theme, width, height, title):
        self.theme = theme
        self.t = palette(theme)
        self.width = width
        self.height = height
        self.title = title
        self.glyphs = set()
        self.defs = []
        self.css = []
        self.body = []
        self.serial = 0

    def add(self, *parts):
        self.body.extend(parts)

    def uid(self, prefix):
        self.serial += 1
        return f"{prefix}{self.serial}"

    def text(self, x, y, content, size, fill=None, weight=600, anchor="start", tracking=0.0):
        measured = advance(content, size, weight, tracking)
        x -= {"start": 0, "middle": measured / 2, "end": measured}[anchor]
        table = FONT[str(weight)]
        pen, uses = 0, []
        for index, char in enumerate(content):
            if char not in table["glyphs"]:
                raise ValueError(f"glyph {char!r} is missing, add it in extract_glyphs.py")
            if table["glyphs"][char]["d"]:
                self.glyphs.add((weight, char))
                uses.append(f'<use href="#g{weight}-{ord(char):x}" x="{pen:.0f}"/>')
            pen += table["glyphs"][char]["a"] + table["kern"].get(content[index:index + 2], 0) + tracking * 1000
        return f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 1000:.4f})" fill="{fill or self.t["ink"]}">{"".join(uses)}</g>'

    def lines(self, x, y, content, size, width, leading, fill=None, weight=600, anchor="start"):
        rows = wrap(content, size, width, weight)
        drawn = "".join(self.text(x, y + index * leading, row, size, fill, weight, anchor, -0.01 if size > 28 else 0) for index, row in enumerate(rows))
        return drawn, len(rows)

    def icon(self, name, x, y, size, color):
        return f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 24:.3f})" color="{color}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner_svg(ICONS / f"{name}.svg")}</g>'

    def brand(self, name, x, y, size, color):
        return f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 24:.3f})" color="{color}" fill="{color}">{inner_svg(BRANDS / f"{name}.svg")}</g>'

    def wordmark(self, x, baseline, size, anchor="start"):
        cap = size * 0.728
        width = cap + size * 0.035 + advance("uvo", size, 800, -0.03)
        x -= width / 2 if anchor == "middle" else 0
        mark = f'<path transform="translate({x:.1f} {baseline - cap:.1f}) scale({cap / 192:.4f}) translate(-32 -32)" d="{MARK}" fill="{self.t["ink"]}"/>'
        return mark + self.text(x + cap + size * 0.035, baseline, "uvo", size, self.t["ink"], 800, tracking=-0.03)

    def rect(self, x, y, w, h, radius, extra=""):
        return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{radius:.1f}"{extra}/>'

    def card(self):
        self.add(self.rect(0.5, 0.5, self.width - 1, self.height - 1, RADIUS, f' fill="{self.t["card"]}" stroke="{self.t["hair"]}"'))

    def shadow(self):
        name = self.uid("s")
        self.defs.append(f'<filter id="{name}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="{self.t["shadow"]}" flood-opacity="1"/></filter>')
        return name

    def picture(self, image, x, y, w, radius, rise=True):
        h = w * image.height / image.width
        source = encode(image, w * 2)
        clip = self.uid("c")
        self.defs.append(f'<clipPath id="{clip}">{self.rect(x, y, w, h, radius)}</clipPath>')
        shadow = self.shadow()
        body = (
            self.rect(x, y, w, h, radius, f' fill="{self.t["raised"]}" filter="url(#{shadow})"')
            + f'<image href="{source}" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" clip-path="url(#{clip})" preserveAspectRatio="none"/>'
            + self.rect(x, y, w, h, radius, f' fill="none" stroke="{self.t["hair"]}"')
        )
        if rise:
            self.css.append(f"@keyframes rise{{from{{transform:translateY(18px)}}to{{transform:none}}}}.rise{{animation:rise 1s {EASE} both}}")
            return f'<g class="rise">{body}</g>', h
        return body, h

    def render(self):
        glyphs = "".join(f'<path id="g{weight}-{ord(char):x}" d="{FONT[str(weight)]["glyphs"][char]["d"]}"/>' for weight, char in sorted(self.glyphs))
        style = ""
        if self.css:
            style = "<style>" + "".join(dict.fromkeys(self.css)) + "@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>"
        label = html.escape(self.title, quote=True)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height:.0f}" viewBox="0 0 {self.width} {self.height:.0f}" role="img" aria-label="{label}">'
            f"<title>{html.escape(self.title)}</title>{style}<defs>{glyphs}{''.join(self.defs)}</defs>{''.join(self.body)}</svg>\n"
        )


def window(key, theme):
    return Image.open(shot_path(key, theme)).convert("RGBA")


def crop(spec, theme):
    image = window(spec["shot"], theme)
    x, y, w, h = spec["box"]
    return image.crop((round(x * image.width), round(y * image.height), round((x + w) * image.width), round((y + h) * image.height)))


def head(theme, narrow):
    shot = window(MEDIA["hero"], theme)
    if narrow:
        a = Art(theme, NARROW, 0, "Nuvo. " + DATA["tagline"])
        pad, top = 24, 176
        a.height = top + (NARROW - 2 * pad) * shot.height / shot.width + pad + 8
        a.card()
        a.add(a.wordmark(NARROW / 2, 98, 76, "middle"), a.text(NARROW / 2, 140, DATA["tagline"], 22, a.t["ink-3"], 600, "middle"))
    else:
        a = Art(theme, WIDE, 0, "Nuvo. " + DATA["tagline"])
        pad, top = 48, 188
        a.height = top + (WIDE - 2 * pad) * shot.height / shot.width + pad + 8
        a.card()
        a.add(a.wordmark(pad + 8, 132, 112), a.text(WIDE - pad - 8, 132, DATA["tagline"], 30, a.t["ink-3"], 600, "end", -0.01))
    drawn, _ = a.picture(shot, pad, top, a.width - 2 * pad, WINDOW_RADIUS * (a.width - 2 * pad) / shot.width)
    a.add(drawn)
    return a


def pill(theme, name):
    spec = DATA["pills"][name]
    t = palette(theme)
    size, height, gap = 15, 40, 8
    label = spec["label"]
    width = round(16 + 18 + gap + advance(label, size, 600) + 18)
    a = Art(theme, width, height, spec["alt"])
    primary = name == "download"
    fill, ink = (t["ink"], t["field"]) if primary else (t["tint"], t["ink"])
    stroke = "" if primary else f' stroke="{t["hair"]}"'
    a.add(a.rect(0.5, 0.5, width - 1, height - 1, (height - 1) / 2, f' fill="{fill}"{stroke}'))
    glyph = a.brand(spec["brand"], 16, 11, 18, "#26A5E4") if "brand" in spec else a.icon(spec["icon"], 16, 11, 18, ink)
    a.add(glyph, a.text(16 + 18 + gap, 25.5, label, size, ink, 600))
    return a


def block(theme, spec, index, narrow):
    a = Art(theme, NARROW if narrow else WIDE, 0, f"{spec['title']} {spec['sub']}")
    widget = MEDIA["widgets"][spec["widget"]]
    image = crop(widget, theme)
    radius = widget.get("radius", 14)
    if narrow:
        pad = 32
        width = min(NARROW - 2 * pad, widget.get("width", 460))
        title, rows = a.lines(pad, pad + 30, spec["title"], 32, NARROW - 2 * pad, 38)
        sub, subs = a.lines(pad, pad + 30 + rows * 38 + 4, spec["sub"], 17, NARROW - 2 * pad, 25, a.t["ink-3"], 500)
        top = pad + 30 + rows * 38 + subs * 25 + 24
        drawn, h = a.picture(image, (NARROW - width) / 2, top, width, radius)
        a.height = top + h + pad + 8
    else:
        pad = 56
        width = widget.get("width", 460)
        h = width * image.height / image.width
        column = WIDE - 3 * pad - width
        rows, subs = len(wrap(spec["title"], 42, column)), len(wrap(spec["sub"], 19, column, 500))
        text_height = rows * 50 + 12 + subs * 28
        a.height = max(h, text_height) + 2 * pad + 8
        left = index % 2 == 1
        image_x = pad if left else WIDE - pad - width
        text_x = 2 * pad + width if left else pad
        text_top = (a.height - 8 - text_height) / 2 + 38
        title, _ = a.lines(text_x, text_top, spec["title"], 42, column, 50)
        sub, _ = a.lines(text_x, text_top + rows * 50 + 8, spec["sub"], 19, column, 28, a.t["ink-3"], 500)
        drawn, _ = a.picture(image, image_x, (a.height - 8 - h) / 2, width, radius)
    a.card()
    a.add(title, sub, drawn)
    return a


def format_number(value):
    return f"{value:g}"


def speed(theme, narrow):
    chart = BENCH["chart"]
    apps = [app for app in BENCH["apps"] if app["name"] == "Nuvo" or app.get(chart["key"]) is not None]
    a = Art(theme, NARROW if narrow else WIDE, 0, chart["title"])
    t = a.t
    pad = 32 if narrow else 56
    title, rows = a.lines(pad, pad + 30, chart["title"], 32 if narrow else 40, a.width - 2 * pad, 44)
    note, notes = a.lines(pad, pad + 30 + rows * 44 + 2, chart["sub"], 16 if narrow else 18, a.width - 2 * pad, 26, t["ink-3"], 500)
    top = pad + 30 + rows * 44 + notes * 26 + 28
    step = 62 if narrow else 46
    a.height = top + len(apps) * step + pad - 8
    a.card()
    a.add(title, note)
    peak = max(app[chart["key"]] or 0 for app in apps)
    label_width = 0 if narrow else 170
    track = a.width - 2 * pad - label_width - (0 if narrow else 110)
    for row, app in enumerate(apps):
        value = app.get(chart["key"])
        y = top + row * step
        bar_y = y + (26 if narrow else 0)
        ours = app["name"] == "Nuvo"
        ink = t["ink"] if ours else t["ink-3"]
        a.add(a.text(pad, y + (18 if narrow else 22), app["name"], 17, t["ink"], 700 if ours else 500))
        x = pad + label_width
        a.add(a.rect(x, bar_y + 6, track, 22, 11, f' fill="{t["tint"]}"'))
        if value is None:
            a.add(a.text(x + 14, bar_y + 22, BENCH["pending"], 14, t["ink-3"], 600))
            continue
        length = max(22, track * value / peak)
        a.add(a.rect(x, bar_y + 6, length, 22, 11, f' fill="{t["accent"] if ours else t["ink-3"]}" fill-opacity="{1 if ours else 0.55}"'))
        shown = f"{format_number(value)} {chart['unit']}"
        if narrow:
            a.add(a.text(a.width - pad, y + 18, shown, 16, ink, 600, "end"))
        else:
            a.add(a.text(x + length + 12, bar_y + 23, shown, 16, ink, 600))
    return a


def matrix_counts():
    matrix = DATA["matrix"]
    rows = [row for group in matrix["groups"] for row in group["rows"]]
    counts = {}
    for column, name in enumerate(matrix["apps"]):
        if name != "Nuvo":
            counts[name] = {state: sum(row["cells"][column] == state for row in rows) for state in MATRIX_WORDS}
    return counts, len(rows)


def matrix_chart(theme, narrow):
    counts, total = matrix_counts()
    a = Art(theme, NARROW if narrow else WIDE, 0, f"How many of Nuvo's {total} features each app has")
    t = a.t
    pad = 32 if narrow else 56
    title, rows = a.lines(pad, pad + 30, f"Nuvo's {total} features, app by app", 32 if narrow else 40, a.width - 2 * pad, 44)
    note, notes = a.lines(pad, pad + 30 + rows * 44 + 2, DATA["matrix"]["summary"], 16 if narrow else 18, a.width - 2 * pad, 26, t["ink-3"], 500)
    top = pad + 30 + rows * 44 + notes * 26 + 30
    step = 64 if narrow else 50
    a.height = top + 30 + len(counts) * step + pad - 6
    a.card()
    a.add(title, note)
    fills = {"y": (t["accent"], 1), "p": (t["accent"], 0.45), "n": (t["ink-3"], 0.35), "u": (t["tint"], 1)}
    legend_x = pad
    for state, word in MATRIX_WORDS.items():
        color, opacity = fills[state]
        a.add(a.rect(legend_x, top - 12, 14, 14, 4, f' fill="{color}" fill-opacity="{opacity}" stroke="{t["hair"]}"'))
        a.add(a.text(legend_x + 22, top, word.capitalize(), 15, t["ink-3"], 500))
        legend_x += 22 + advance(word.capitalize(), 15, 500) + 24
    top += 30
    label_width = 0 if narrow else 170
    track = a.width - 2 * pad - label_width
    for row, (name, count) in enumerate(counts.items()):
        y = top + row * step
        bar_y = y + (24 if narrow else 0)
        a.add(a.text(pad, y + (18 if narrow else 24), name, 17, t["ink"], 500))
        x = pad + label_width
        clip = a.uid("c")
        a.defs.append(f'<clipPath id="{clip}">{a.rect(x, bar_y + 6, track, 24, 8)}</clipPath>')
        segments = []
        for state in MATRIX_WORDS:
            if count[state]:
                color, opacity = fills[state]
                length = track * count[state] / total
                segments.append(f'<rect x="{x:.1f}" y="{bar_y + 6:.1f}" width="{length:.1f}" height="24" fill="{color}" fill-opacity="{opacity}"/>')
                if length > 30:
                    ink = t["field"] if state == "y" else t["ink"]
                    segments.append(a.text(x + length / 2, bar_y + 23, str(count[state]), 13, ink, 700, "middle"))
                x += length
        a.add(f'<g clip-path="url(#{clip})">{"".join(segments)}</g>', a.rect(pad + label_width, bar_y + 6, track, 24, 8, f' fill="none" stroke="{t["hair"]}"'))
    return a


def platforms(theme, narrow):
    items = DATA["platforms"]
    a = Art(theme, NARROW if narrow else WIDE, 92 * len(items) + 40 if narrow else 196, ", ".join(f"{item['name']}: {item['status']}" for item in items))
    t = a.t
    a.card()
    for index, item in enumerate(items):
        if narrow:
            x, y = 32, 20 + index * 92
            a.add(a.brand(item["brand"], x, y + 22, 32, t["ink"]))
            a.add(a.text(x + 52, y + 38, item["name"], 20, t["ink"], 700), a.text(a.width - 32, y + 38, item["status"], 15, t["ink-3"], 600, "end"))
            a.add(a.text(x + 52, y + 64, item["formats"], 15, t["ink-3"], 500))
        else:
            x = 56 + index * (WIDE - 112) / len(items)
            a.add(a.brand(item["brand"], x, 44, 36, t["ink"]))
            a.add(a.text(x, 122, item["name"], 24, t["ink"], 700), a.text(x, 150, item["status"], 17, t["ink-3"], 600))
            a.add(a.text(x, 174, item["formats"], 15, t["ink-3"], 500))
    return a


def banner(theme, narrow, height=None):
    a = Art(theme, NARROW if narrow else WIDE, height or (96 if narrow else 120), "Nuvo. " + DATA["tagline"])
    a.card()
    pad = 28 if narrow else 44
    middle = a.height / 2
    if narrow:
        a.add(a.wordmark(pad, middle + 17, 48), a.text(a.width - pad, middle + 7, DATA["tagline"], 16, a.t["ink-3"], 600, "end"))
    else:
        a.add(a.wordmark(pad, middle + 23, 64), a.text(a.width - pad, middle + 10, DATA["tagline"], 24, a.t["ink-3"], 600, "end", -0.01))
    return a


def poster(theme, width, height, title, word_size, tagline_size, tagline_width, shot_x, shot_y, shot_width, note=None):
    a = Art(theme, width, height, title)
    t = a.t
    a.add(f'<rect width="{width}" height="{height}" fill="{t["card"]}"/>')
    left = round(width * 0.056)
    a.add(a.wordmark(left, shot_y + word_size * 0.95, word_size))
    top = shot_y + word_size * 0.95 + tagline_size * 1.6
    lines, rows = a.lines(left + 4, top, DATA["tagline"], tagline_size, tagline_width, tagline_size * 1.18)
    a.add(lines)
    if note:
        a.add(a.lines(left + 4, top + rows * tagline_size * 1.18 + 30, note, 24, tagline_width, 34, t["ink-3"], 500)[0])
    shot = window(MEDIA["hero"], theme)
    drawn, _ = a.picture(shot, shot_x, shot_y, shot_width, WINDOW_RADIUS * shot_width / shot.width, rise=False)
    a.add(drawn)
    return a


def rasterize(art, target, scale=1):
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        sys.exit(f"Chrome is needed to draw {target.name}")
    with tempfile.TemporaryDirectory(dir=Path.home() / ".cache") as temp:
        page = Path(temp) / "art.html"
        page.write_text(f"<!doctype html><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style>{art.render()}")
        subprocess.run([
            chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={temp}/profile",
            f"--force-device-scale-factor={scale}", f"--window-size={art.width},{round(art.height)}",
            "--default-background-color=00000000", f"--screenshot={target}", page.as_uri(),
        ], check=True, capture_output=True)


def save(name, art):
    (HERE / f"{name}.svg").write_text(art.render())


def build_art():
    for old in HERE.glob("*.svg"):
        old.unlink()
    for theme in THEMES:
        for suffix, narrow in (("", False), ("-narrow", True)):
            save(f"head{suffix}-{theme}", head(theme, narrow))
            save(f"banner{suffix}-{theme}", banner(theme, narrow))
            save(f"speed{suffix}-{theme}", speed(theme, narrow))
            save(f"matrix{suffix}-{theme}", matrix_chart(theme, narrow))
            save(f"platforms{suffix}-{theme}", platforms(theme, narrow))
            for index, spec in enumerate(DATA["features"]):
                save(f"feature-{spec['widget']}{suffix}-{theme}", block(theme, spec, index, narrow))
        for name in DATA["pills"]:
            save(f"pill-{name}-{theme}", pill(theme, name))


def build_png():
    rasterize(poster("light", 1280, 640, "Nuvo. " + DATA["tagline"], 132, 46, 420, 600, 120, 900, DATA["social"]), HERE / "social.png")
    for theme in THEMES:
        rasterize(poster(theme, 1000, 260, "Nuvo. " + DATA["tagline"], 84, 26, 300, 470, 44, 620), HERE / f"release-{theme}.png", 2)
        rasterize(banner(theme, False), HERE / f"banner-{theme}.png", 2)


def picture(name, alt, width="100%", root=ASSETS):
    base = f"{root}/{name}"
    sources = []
    if (HERE / f"{name}-narrow-dark.svg").exists():
        sources.append(f'<source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="{base}-narrow-dark.svg">')
        sources.append(f'<source media="(max-width: 600px)" srcset="{base}-narrow-light.svg">')
    sources.append(f'<source media="(prefers-color-scheme: dark)" srcset="{base}-dark.svg">')
    return f'<picture>{"".join(sources)}<img src="{base}-light.svg" width="{width}" alt="{html.escape(alt, quote=True)}"></picture>'


def pills():
    links = []
    for name, spec in DATA["pills"].items():
        base = f"{ASSETS}/pill-{name}"
        image = f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}-dark.svg"><img src="{base}-light.svg" height="40" alt="{html.escape(spec["alt"], quote=True)}"></picture>'
        links.append(f'<a href="{spec["url"]}">{image}</a>')
    return "&nbsp; ".join(links)


def shot(key, alt):
    light, dark = (shot_path(key, theme).relative_to(ROOT) for theme in THEMES)
    return f'<picture><source media="(prefers-color-scheme: dark)" srcset="{dark}"><img src="{light}" width="100%" alt="{html.escape(alt, quote=True)}"></picture>'


def showcase():
    parts = []
    for item in MEDIA["showcase"]:
        caption = f"**{item['title']}** {item['caption']}"
        media = item["video"] if item.get("video") else shot(item["shot"], item["alt"])
        parts.append(f'<div align="center">\n\n{caption}\n\n</div>\n\n{media}')
    return "\n\n<br>\n\n".join(parts)


def features():
    parts = []
    for spec in DATA["features"]:
        bullets = "\n".join(f"- {line}" for line in spec["bullets"])
        parts.append(f"### {spec['name']}\n\n{picture('feature-' + spec['widget'], spec['title'] + ' ' + spec['alt'])}\n\n{bullets}")
    return "\n\n".join(parts)


def cell_word(state):
    return "*unknown*" if state == "u" else MATRIX_WORDS[state].capitalize()


def matrix_tables():
    matrix = DATA["matrix"]
    sections = []
    for group in matrix["groups"]:
        rows = ["| Feature | " + " | ".join(matrix["apps"]) + " |", "|---|" + "---|" * len(matrix["apps"])]
        rows += [f"| {row['label']} | " + " | ".join(cell_word(state) for state in row["cells"]) + " |" for row in group["rows"]]
        sections.append(f"#### {group['name']} ({len(group['rows'])})\n\n" + "\n".join(rows))
    return "\n\n".join(sections)


def matrix_alt():
    counts, total = matrix_counts()
    return f"Nuvo's {total} features, app by app. " + "; ".join(f"{name}: " + ", ".join(f"{count[state]} {word}" for state, word in MATRIX_WORDS.items()) for name, count in counts.items()) + "."


def speed_value(app, column):
    value = app.get(column["key"])
    note = app.get("notes", {}).get(column["key"])
    if value is None:
        return note or BENCH["pending"]
    spread = app.get("spread", {}).get(column["key"])
    text = f"{format_number(value)} {column['unit']}".strip()
    text += f" ({format_number(spread[0])} to {format_number(spread[1])})" if spread else ""
    return f"{text}, {note}" if note else text


def speed_table():
    columns = BENCH["columns"]
    rows = ["| App | " + " | ".join(column["label"] for column in columns) + " |", "|---|" + "---|" * len(columns)]
    rows += [f"| {app['name']} | " + " | ".join(speed_value(app, column) for column in columns) + " |" for app in BENCH["apps"]]
    return "\n".join(rows)


def speed_alt():
    chart = BENCH["chart"]
    values = [f"{app['name']} {format_number(app[chart['key']])} {chart['unit']}" if app.get(chart["key"]) is not None else f"{app['name']} {BENCH['pending']}" for app in BENCH["apps"]]
    return f"{chart['title']} {chart['sub']} " + ", ".join(values) + "."


def fill(text, values, name):
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError(f"{name}: unfilled placeholder " + text[text.index("{{"):][:40])
    return text


def build_readme():
    values = {
        "head": picture("head", "Nuvo. " + DATA["tagline"] + " " + MEDIA["heroAlt"]),
        "pills": pills(),
        "new": "\n".join(f"- {line}" for line in DATA["new"]),
        "why": "\n".join(f"- **{item['claim']}** {item['why']}" for item in DATA["why"]),
        "showcase": showcase(),
        "features": features(),
        "speed": picture("speed", speed_alt()),
        "speed-table": speed_table(),
        "speed-method": "\n".join(f"- {line}" for line in BENCH["method"]),
        "speed-date": BENCH["date"],
        "matrix": picture("matrix", matrix_alt()),
        "matrix-tables": matrix_tables(),
        "matrix-notes": "\n".join(f"- {note}" for note in DATA["matrix"]["notes"]),
        "matrix-checked": DATA["matrix"]["checked"],
        "matrix-sources": ", ".join(f"[{source['name']}]({source['url']})" for source in DATA["matrix"]["sources"]),
        "platforms-art": picture("platforms", "; ".join(f"{item['name']}: {item['status']}, {item['formats']}" for item in DATA["platforms"])),
        "platforms": "\n".join(f"- **{item['name']}:** {item['text']}" for item in DATA["platforms"]),
        "roadmap": "\n".join(f"- **{stage['title']}:** " + ", ".join(stage["items"]) + "." for stage in DATA["roadmap"]),
        "unsigned": DATA["unsigned"],
        "version": DATA["version"],
        "repo": DATA["repo"],
        "site": DATA["site"],
    }
    text = fill((HERE / "README.template.md").read_text(), values, "README")
    (ROOT / "README.md").write_text(text)


def page_nav(target):
    items = []
    for label, path in NAV:
        link = os.path.relpath(ROOT / path, target.parent)
        items.append(f"**{label}**" if ROOT / path == target else f"[{label}]({link})")
    return "<sub>" + " · ".join(items + [f"[Docs]({DATA['site']}/docs)"]) + "</sub>"


def form_head():
    base = f"{DATA['repo']}/raw/main/{ASSETS}/banner"
    return f'<picture><source media="(prefers-color-scheme: dark)" srcset="{base}-dark.png"><img src="{base}-light.png" width="100%" alt="Nuvo"></picture>'


def build_pages():
    for source in PAGES.rglob("*"):
        if not source.is_file():
            continue
        target = ROOT / source.relative_to(PAGES)
        values = {
            "head": picture("banner", "Nuvo. " + DATA["tagline"], root=os.path.relpath(HERE, target.parent)),
            "nav": page_nav(target),
            "form-head": form_head(),
            "site": DATA["site"],
            "repo": DATA["repo"],
            "version": DATA["version"],
        }
        text = fill(source.read_text(), values, source.name)
        note = "Generated by .github/readme/build.py. Edit .github/readme/pages/ and data.json, not this file."
        target.write_text((f"# {note}\n" if target.suffix == ".yml" else f"<!-- {note} -->\n") + text)


def import_media(folder):
    for key, name in MEDIA["sources"].items():
        for theme in THEMES:
            source = Path(folder) / name.format(theme=theme)
            if not source.exists():
                print(f"missing {source}")
                continue
            for old in SHOTS.glob(f"{key}-{theme}.*"):
                old.unlink()
            if source.suffix == ".gif":
                shutil.copyfile(source, SHOTS / f"{key}-{theme}.gif")
                continue
            image = Image.open(source).convert("RGBA")
            if image.width > 1680:
                image = image.resize((1680, round(image.height * 1680 / image.width)), Image.LANCZOS)
            image.save(SHOTS / f"{key}-{theme}.webp", "WEBP", quality=90, method=6)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--media":
        import_media(sys.argv[2])
    build_art()
    build_readme()
    build_pages()
    build_png()
    total = sum(path.stat().st_size for path in ROOT.joinpath(ASSETS).rglob("*") if path.is_file())
    print(f"{len(list(HERE.glob('*.svg')))} SVGs, {total / 1024 / 1024:.1f} MB in {ASSETS}")
