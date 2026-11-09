"""Needs fonttools and hb-shape: extract_glyphs.py <font> <out.json> [weights...]"""
import json, subprocess, sys, tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

source, target = sys.argv[1], sys.argv[2]
weights = [int(weight) for weight in sys.argv[3:]] or [400, 500, 600, 700, 800]
chars = [chr(c) for c in range(32, 127)] + list("·–—…’‘“”×→↑↓≈°é")
table = {"unitsPerEm": 1000, "weights": {}}
folder = tempfile.TemporaryDirectory()
for weight in weights:
    font = instantiateVariableFont(TTFont(source), {"wght": weight})
    font.flavor = None
    path = f"{folder.name}/{weight}.ttf"
    font.save(path)
    font = TTFont(path)
    cmap, glyphs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    scale = 1000 / font["head"].unitsPerEm
    entry = {"glyphs": {}, "kern": {}}
    present = [c for c in chars if ord(c) in cmap]
    for char in present:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs, ntos=lambda v: str(round(v)))
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, 0, 0)))
        entry["glyphs"][char] = {"a": round(hmtx[name][0] * scale), "d": pen.getCommands()}
    pairs = [a + b for a in present for b in present if a != " " and b != " "]
    text = "\n".join(pairs)
    out = subprocess.run(["hb-shape", path, "--text-file=/dev/stdin", "--no-glyph-names", "--no-clusters"], input=text, capture_output=True, text=True, check=True).stdout
    for pair, line in zip(pairs, out.splitlines()):
        first = line.strip("[]").split("|")[0]
        advance = int(first.split("+")[1]) * scale
        delta = round(advance - entry["glyphs"][pair[0]]["a"])
        if abs(delta) >= 4:
            entry["kern"][pair] = delta
    table["weights"][str(weight)] = entry
json.dump(table, open(target, "w"), ensure_ascii=False, separators=(",", ":"))
