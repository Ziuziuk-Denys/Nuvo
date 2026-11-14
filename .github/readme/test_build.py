import json
import re
import xml.etree.ElementTree as ElementTree

import build
import release_notes

build.build_art()
build.build_readme()
build.build_pages()
readme = (build.ROOT / "README.md").read_text()

for path in build.HERE.glob("*.svg"):
    source = path.read_text()
    ElementTree.fromstring(source)
    assert "<script" not in source and "<text" not in source and "@font-face" not in source, path
    assert not re.search(r'(href|src)="https?:', source), path
    assert path.stat().st_size < 400_000, path
    if "animation:" in source:
        assert "prefers-reduced-motion" in source and "opacity:0" not in source, path

for name in ["head", "speed", "matrix", "platforms", "banner"] + [f"feature-{spec['widget']}" for spec in build.DATA["features"]]:
    for variant in ("light", "dark", "narrow-light", "narrow-dark"):
        assert (build.HERE / f"{name}-{variant}.svg").exists(), (name, variant)
for name in build.DATA["pills"]:
    for theme in build.THEMES:
        assert (build.HERE / f"pill-{name}-{theme}.svg").exists(), name
assert "data:image/webp;base64," in (build.HERE / "head-dark.svg").read_text()

for reference in re.findall(r'(?:srcset|src)="(\.github/[^"]+)"', readme):
    assert (build.ROOT / reference).exists(), reference
for icon in re.findall(r'"icon": "([a-z-]+)"', (build.HERE / "data.json").read_text()):
    assert (build.ICONS / f"{icon}.svg").exists(), icon
for item in build.DATA["platforms"]:
    assert (build.BRANDS / f"{item['brand']}.svg").exists(), item["brand"]
for key in build.MEDIA["sources"]:
    for theme in build.THEMES:
        assert build.shot_path(key, theme).stat().st_size < 3 * 1024 * 1024, key
assert {spec["widget"] for spec in build.DATA["features"]} <= set(build.MEDIA["widgets"])

assert "{{" not in readme and "None" not in readme
assert "—" not in readme and "–" not in readme
assert not re.search(r"\b(Electron|React|Rust|TypeScript)\b", readme)
why = readme.split("## Why Nuvo")[1].split("## Install")[0]
outside = readme.replace(why, "")
for name in ("Liner", "Riff", "Strawberry", "mpthree"):
    assert name not in outside, name

matrix = build.DATA["matrix"]
rows = [row for group in matrix["groups"] for row in group["rows"]]
assert len(rows) == matrix["total"]
sources = {(cell["app"], cell["feature"]): cell["answer"] for cell in json.loads((build.HERE / "comparison-sources.json").read_text())["cells"]}
for row in rows:
    assert len(row["cells"]) == len(matrix["apps"]), row["label"]
    for name, state in zip(matrix["apps"], row["cells"], strict=True):
        assert name == "Nuvo" or sources.get((name, row["label"]), "unknown") == build.MATRIX_WORDS[state], (name, row["label"])
assert len(re.findall(r"^\| (?!Feature |App |---)", why, re.M)) == len(rows) + len(build.BENCH["apps"])
counts, total = build.matrix_counts()
assert total == len(rows) and all(sum(count.values()) == total for count in counts.values())

pending = [app["name"] for app in build.BENCH["apps"] if app.get(build.BENCH["chart"]["key"]) is None]
assert all(f"{name} {build.BENCH['pending']}" in build.speed_alt() for name in pending)

assert build.wrap("Ten bands over a live spectrum.", 42, 332) == ["Ten bands over", "a live spectrum."]
assert len(build.wrap("A B C", 42, 0)) == 3

bug = (build.ROOT / ".github/ISSUE_TEMPLATE/bug.yml").read_text()
assert f"placeholder: {build.DATA['version']}" in bug
for page in ("SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "DESIGN-NOTES.md", ".github/SUPPORT.md"):
    text = (build.ROOT / page).read_text()
    for reference in re.findall(r'(?:srcset|src)="([^"h][^"]+)"', text):
        assert (build.ROOT / page).parent.joinpath(reference).resolve().exists(), (page, reference)

social = (build.HERE / "social.png").read_bytes()
assert social[:8] == b"\x89PNG\r\n\x1a\n" and social[16:24] == (1280).to_bytes(4, "big") + (640).to_bytes(4, "big")
assert len(social) < 1_000_000
for theme in build.THEMES:
    assert (build.HERE / f"release-{theme}.png").stat().st_size < 1_000_000, theme
    assert (build.HERE / f"banner-{theme}.png").exists(), theme
assert sum(path.stat().st_size for path in build.HERE.rglob("*") if path.is_file()) < 15 * 1024 * 1024

files = ["Nuvo-1.0.0-x64.AppImage", "nuvo_1.0.0_amd64.deb", "Nuvo-1.0.0-aarch64.rpm", "Nuvo-Setup-1.0.0-x64.exe", "Nuvo-1.0.0-universal.dmg", "SHA256SUMS"]
notes = release_notes.render("v1.0.0", files, "The changes.\n")
assert notes.count("releases/download/v1.0.0/") == 5 and "SHA256SUMS)" not in notes, notes
assert "| Linux arm64 | [.rpm]" in notes and "| macOS universal |" in notes and "Windows arm64" not in notes, notes
