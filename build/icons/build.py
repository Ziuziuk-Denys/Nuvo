"""Usage: python3 build/icons/build.py [--thumbar]"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
GLYPHS = HERE.parents[1] / "src" / "ui" / "icons" / "svg"
PANELS = [HERE.parents[1] / "desktop" / "gnome-shell" / "nuvo-panel@nuvo.quest" / "icons", HERE.parents[1] / "desktop" / "plasma" / "quest.nuvo.panel" / "contents" / "icons"]
SIZES = [16, 32, 48, 64, 128, 256, 512]
TRAY_SIZES = [16, 22, 24, 32, 48]
# The taskbar draws thumbnail buttons at 16 px times its scale; Electron hands Windows one bitmap, so each scale gets its own file
THUMBAR_SIZES = [16, 20, 24, 28, 32]
THUMBAR_GLYPHS = ["previous", "play", "pause", "next", "like", "liked"]


def mark(size):
    name, box = ("nuvo-mark-16", (1, 16, 255, 243.5)) if size < 24 else ("nuvo-mark", (14, 29.5, 242, 224))
    return re.search(r' d="([^"]+)"', (GLYPHS / f"{name}.svg").read_text()).group(1), box


def source(size):
    return HERE / ("nuvo-16.svg" if size < 24 else "nuvo-32.svg" if size < 48 else "nuvo-48.svg" if size < 64 else "nuvo.svg")


def trayGlyph(fill, size, box=16):
    path, (x0, y0, x1, y1) = mark(size)
    scale = (box - 1) / (x1 - x0) if size >= 24 else box / 256
    middle = f"translate({box / 2} {box / 2}) scale({scale:.6f}) translate({-(x0 + x1) / 2} {-(y0 + y1) / 2})" if size >= 24 else f"scale({scale})"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" width="{box}" height="{box}">'
            f'<path d="{path}" fill="{fill}" fill-rule="evenodd" transform="{middle}"/></svg>')


def render(svgText, sizes, name, outDir):
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
    for size in SIZES:
        render(source(size).read_text(), [size], "{size}x{size}.png", HERE)
    shutil.copyfile(HERE / "512x512.png", HERE.parents[1] / "public" / "icon.png")

    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp)
        render((HERE / "nuvo.svg").read_text(), [1024], "master-{size}.png", out)
        master = Image.open(out / "master-1024.png").convert("RGBA")
        icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
        for size in icoSizes + [512]:
            render(source(size).read_text(), [size], "ico-{size}.png", out)
        images = [Image.open(out / f"ico-{size}.png").convert("RGBA") for size in icoSizes]
        images[-1].save(HERE / "nuvo.ico", format="ICO", sizes=[(size, size) for size in icoSizes], append_images=images[:-1])

    # Apple's grid: an 824 tile centred on 1024 with a soft shadow below, so Nuvo sits level with other Dock icons
    def dock(tile, size):
        inner, edge = round(size * 824 / 1024), round(size * 100 / 1024)
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 77), (edge, edge + round(size * 12 / 1024)), tile.resize((inner, inner), Image.LANCZOS).getchannel("A"))
        canvas = Image.alpha_composite(Image.new("RGBA", (size, size), (0, 0, 0, 0)), shadow.filter(ImageFilter.GaussianBlur(size * 14 / 1024)))
        canvas.alpha_composite(tile.resize((inner, inner), Image.LANCZOS), (edge, edge))
        return canvas

    with tempfile.TemporaryDirectory() as tmp:
        render((HERE / "nuvo-32.svg").read_text(), [512], "flat-{size}.png", pathlib.Path(tmp))
        flat = Image.open(pathlib.Path(tmp) / "flat-512.png").convert("RGBA")
    dock(master, 1024).save(HERE / "nuvo.icns", format="ICNS", append_images=[dock(flat, 16), dock(flat, 32), dock(flat, 64)])


def dmgBackground():
    """Icon centres match build.dmg.contents (140,180) and (400,180)"""
    from PIL import ImageDraw

    for scale, name in ((1, "background.png"), (2, "background@2x.png")):
        width, height = 540 * scale, 380 * scale
        image = Image.new("RGB", (width, height), "#ffffff")
        draw = ImageDraw.Draw(image)
        for y in range(height):
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


def thumbarIcons():
    glyphs = HERE.parents[1] / "src" / "ui" / "icons" / "svg"
    out = HERE / "thumbar"
    out.mkdir(exist_ok=True)
    for name in THUMBAR_GLYPHS:
        render((glyphs / f"{name}.svg").read_text().replace("currentColor", "#ffffff"), THUMBAR_SIZES, f"{name}-{{size}}.png", out)


def thumbarIcons():
    out = HERE / "thumbar"
    out.mkdir(exist_ok=True)
    for name in THUMBAR_GLYPHS:
        render((GLYPHS / f"{name}.svg").read_text().replace("currentColor", "#ffffff"), THUMBAR_SIZES, f"{name}-{{size}}.png", out)


def trayIcons():
    tray = HERE / "tray"
    for size in TRAY_SIZES:
        render(trayGlyph("#ffffff", size), [size], "nuvo-tray-on-dark-{size}.png", tray)
        render(trayGlyph("#101320", size), [size], "nuvo-tray-on-light-{size}.png", tray)
    # GTK recolours symbolic icons drawn in #2e3436 to the panel's foreground
    for target in [tray, *PANELS]:
        (target / "nuvo-symbolic.svg").write_text(trayGlyph("#2e3436", 16) + "\n")


if __name__ == "__main__":
    if "--thumbar" in sys.argv:
        thumbarIcons()
    else:
        platformIcons()
        dmgBackground()
        trayIcons()
