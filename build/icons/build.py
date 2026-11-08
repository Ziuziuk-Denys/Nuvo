"""Nuvo app, theme and tray icons from the Puffy N. Run: python3 build/icons/build.py [brand-dir], or with --platform for nuvo.ico and nuvo.icns alone

The nine theme icons are the brand's own (brand/app-icons, made by its build.py) and are used as they are, not redrawn.
This script adds what the brand set lacks: the light Nuvo tile and the tray glyphs.

Writes, next to this file:
  NxN.png             the default (Nuvo dark) icon at 16-512, the set electron-builder reads (build.linux.icon)
  nuvo.svg            the same icon as SVG (freedesktop scalable)
  nuvo.ico            Windows: every shell size, 16-256 (build.win.icon)
  nuvo.icns           macOS: the tile on Apple's 824-of-1024 grid with a soft shadow (build.mac.icon)
  ../background.png   the dmg window, 540x380, and background@2x.png for Retina (build.dmg)
  themes/<id>.svg     ten theme icons: the nine brand themes plus nuvo-light
  themes/<id>-N.png   each at 16-512
  tray/nuvo-symbolic.svg          monochrome 16 px symbolic icon for icon themes (GTK recolours it)
  tray/nuvo-tray-on-dark-N.png    white glyph for dark panels, 16 / 22 / 24 / 32 / 48
  tray/nuvo-tray-on-light-N.png   Night glyph for light panels
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
ARGS = [arg for arg in sys.argv[1:] if arg != "--platform"]
BRAND = pathlib.Path(ARGS[0] if ARGS else "~/IT/Projects/Apps/Nuvo/design/brand").expanduser()
THEMES = ["nuvo", "editor", "orbit", "vinyl", "cosmos", "sunset", "amethyst", "y2k", "cassette"]
SIZES = [16, 32, 48, 64, 128, 256, 512]
TRAY_SIZES = [16, 22, 24, 32, 48]
# the glyph outline, read by main() from the brand set; --platform needs only nuvo.svg
PATH = ""

# Same tile as the brand set: 512 box, 22 % corner radius, glyph at 1.12 scale in the centre
RADIUS = 512 * 0.22
GLYPH_SCALE = 1.12
G0, G1 = round(256 - 96 * GLYPH_SCALE), round(256 + 96 * GLYPH_SCALE)
GLYPH_AT = f'transform="translate(256 256) scale({GLYPH_SCALE}) translate(-128 -128)"'


def nuvoLight():
    """Ice tile, Night glyph with a Sky halo: the dark Nuvo icon with its roles swapped."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img">'
            '<title>Nuvo Light icon</title><defs>'
            f'<clipPath id="tile"><rect width="512" height="512" rx="{RADIUS:.2f}"/></clipPath>'
            '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#F7F9FF"/><stop offset="1" stop-color="#E4EAF8"/></linearGradient>'
            f'<linearGradient id="mk" x1="{G0}" y1="{G0}" x2="{G1}" y2="{G1}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#101320"/><stop offset="1" stop-color="#2E3F73"/></linearGradient>'
            '<filter id="halo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="52"/></filter>'
            '</defs><g clip-path="url(#tile)"><rect width="512" height="512" fill="url(#bg)"/>'
            f'<g opacity="0.55" filter="url(#halo)"><path {GLYPH_AT} d="{PATH}" fill="#AFC8F7"/></g>'
            f'<path {GLYPH_AT} d="{PATH}" fill="url(#mk)"/></g>'
            f'<rect x="1" y="1" width="510" height="510" rx="{RADIUS - 1:.2f}" fill="none" stroke="#000000" stroke-opacity="0.09" stroke-width="2"/></svg>')


def trayGlyph(fill, box=16, pad=1):
    """The bare N on a transparent square, `pad` units of air on every side."""
    scale = (box - 2 * pad) / 192
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" width="{box}" height="{box}">'
            f'<path d="{PATH}" fill="{fill}" transform="translate({pad} {pad}) scale({scale:.6f}) translate(-32 -32)"/></svg>')


def render(svgText, sizes, name, outDir):
    """Render once at 1024 with headless Chromium, then downscale with Pillow (the brand build's method)."""
    browser = next((b for b in ("chromium-browser", "chromium", "google-chrome") if shutil.which(b)), None)
    if browser is None:
        raise SystemExit("No Chromium found")
    with tempfile.TemporaryDirectory() as tmp:
        svgPath = pathlib.Path(tmp) / "icon.svg"
        svgPath.write_text(svgText)
        page = pathlib.Path(tmp) / "page.html"
        page.write_text(f'<html><body style="margin:0;background:transparent"><img src="{svgPath.as_uri()}" width="1024" height="1024" style="display:block"></body></html>')
        master = pathlib.Path(tmp) / "master.png"
        subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                        "--default-background-color=00000000", "--window-size=1024,1024", f"--screenshot={master}", page.as_uri()],
                       check=True, capture_output=True, timeout=90)
        image = Image.open(master).convert("RGBA").crop((0, 0, 1024, 1024))
        for size in sizes:
            image.resize((size, size), Image.LANCZOS).save(outDir / name.format(size=size))


def platformIcons():
    """nuvo.ico and nuvo.icns from nuvo.svg. The brand PNGs are used where they exist; other sizes come from a 1024 render."""
    with tempfile.TemporaryDirectory() as tmp:
        render((HERE / "nuvo.svg").read_text(), [1024], "master-{size}.png", pathlib.Path(tmp))
        master = Image.open(pathlib.Path(tmp) / "master-1024.png").convert("RGBA")

    def sized(size):
        own = HERE / f"{size}x{size}.png"
        return Image.open(own).convert("RGBA") if own.exists() else master.resize((size, size), Image.LANCZOS)

    icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    images = [sized(size) for size in icoSizes]
    images[-1].save(HERE / "nuvo.ico", format="ICO", sizes=[(size, size) for size in icoSizes], append_images=images[:-1])

    # Apple's grid: an 824 tile centred on 1024 with a soft shadow below, so Nuvo sits level with other Dock icons
    tile = master.resize((824, 824), Image.LANCZOS)
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 77), (100, 112), tile.getchannel("A"))
    canvas = Image.alpha_composite(Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)), shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(tile, (100, 100))
    canvas.save(HERE / "nuvo.icns", format="ICNS")


def dmgBackground():
    """Light dmg window: a soft blue glow under the app icon and a thin arrow to Applications.
    Icon centres match build.dmg.contents (140,180) and (400,180)."""
    from PIL import ImageDraw

    for scale, name in ((1, "background.png"), (2, "background@2x.png")):
        width, height = 540 * scale, 380 * scale
        image = Image.new("RGB", (width, height), "#ffffff")
        draw = ImageDraw.Draw(image)
        for y in range(height):
            # white at the top to Apple's #f5f5f7 at the bottom
            t = y / (height - 1)
            draw.line([(0, y), (width, y)], fill=tuple(round(255 + (c - 255) * t) for c in (0xF5, 0xF5, 0xF7)))
        glow = Image.new("L", (width, height), 0)
        ImageDraw.Draw(glow).ellipse([(140 - 90) * scale, (180 - 80) * scale, (140 + 90) * scale, (180 + 80) * scale], fill=90)
        glow = glow.filter(ImageFilter.GaussianBlur(48 * scale))
        image = Image.composite(Image.new("RGB", (width, height), "#cfe0ff"), image, glow)
        draw = ImageDraw.Draw(image)
        y, x0, x1, head = 180 * scale, 222 * scale, 318 * scale, 9 * scale
        stroke = "#b8b8c0"
        draw.line([(x0, y), (x1, y)], fill=stroke, width=2 * scale)
        draw.line([(x1 - head, y - head), (x1, y), (x1 - head, y + head)], fill=stroke, width=2 * scale, joint="curve")
        image.save(HERE.parent / name, optimize=True)


def main():
    global PATH
    PATH = re.search(r' d="([^"]+)"', (BRAND / "concepts" / "round-2" / "c-puffy-n.svg").read_text()).group(1)
    themes = HERE / "themes"
    tray = HERE / "tray"
    themes.mkdir(exist_ok=True)
    tray.mkdir(exist_ok=True)

    for theme in THEMES:
        shutil.copyfile(BRAND / "app-icons" / "svg" / f"{theme}.svg", themes / f"{theme}.svg")
        for size in SIZES:
            shutil.copyfile(BRAND / "app-icons" / "png" / f"{theme}-{size}.png", themes / f"{theme}-{size}.png")

    for size in SIZES:
        shutil.copyfile(themes / f"nuvo-{size}.png", HERE / f"{size}x{size}.png")
    shutil.copyfile(themes / "nuvo.svg", HERE / "nuvo.svg")

    light = nuvoLight()
    (themes / "nuvo-light.svg").write_text(light)
    render(light, SIZES, "nuvo-light-{size}.png", themes)

    # GTK recolours symbolic icons drawn in #2e3436 to the panel's foreground
    (tray / "nuvo-symbolic.svg").write_text(trayGlyph("#2e3436"))
    render(trayGlyph("#ffffff"), TRAY_SIZES, "nuvo-tray-on-dark-{size}.png", tray)
    render(trayGlyph("#101320"), TRAY_SIZES, "nuvo-tray-on-light-{size}.png", tray)
    print("wrote", len(THEMES) + 1, "theme icons, the default set and the tray glyphs")


if __name__ == "__main__":
    if "--platform" in sys.argv:
        platformIcons()
        dmgBackground()
    else:
        main()
        platformIcons()
        dmgBackground()
