import json
import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import build
import release_notes

build.build_art()
build.build_readme()
build.build_pages()
for path in build.HERE.glob("*.svg"):
    source = path.read_text()
    ElementTree.fromstring(source)
    assert "<script" not in source and "<text" not in source and "@font-face" not in source, path
    assert not re.search(r'(href|src)="https?:', source), path
    assert path.stat().st_size < 200_000, path
for variant in ("light", "dark", "narrow-light", "narrow-dark"):
    assert "data:image/webp;base64," in (build.HERE / f"hero-{variant}.svg").read_text(), variant
readme = (build.ROOT / "README.md").read_text()
for reference in re.findall(r'(?:srcset|src)="(\.github/[^"]+)"', readme):
    assert (build.ROOT / reference).exists(), reference
for icon in re.findall(r'a\.icon\("([a-z-]+)"', (build.HERE / "build.py").read_text()):
    assert (build.ICON_DIR / f"{icon}.svg").exists() or (build.HERE / "brands" / f"{icon}.svg").exists(), icon
for gif in (build.HERE / "shots").glob("*.gif"):
    assert gif.stat().st_size < 3 * 1024 * 1024, gif
matrix = build.DATA["matrix"]
groups = matrix["groups"]
rows = [row for group in groups for row in group["rows"]]
assert sorted(build.MATRIX_COLUMNS) == sorted(matrix["apps"])
assert set(build.MATRIX_PANELS) == {group["name"] for group in groups}
assert len(rows) == matrix["total"]
sources = {(cell["app"], cell["feature"]): cell["answer"] for cell in json.loads((build.HERE / "comparison-sources.json").read_text())["cells"]}
for row in rows:
    for name, state in zip(build.MATRIX_COLUMNS, build.matrix_cells(row), strict=True):
        assert name == "Nuvo" or sources.get((name, row["label"]), "unknown") == build.MATRIX_WORDS[state], (name, row["label"])
for group in groups:
    for variant in ("light", "dark", "narrow-light", "narrow-dark"):
        panel = (build.HERE / f"{build.matrix_slug(group)}-{variant}.svg").read_text()
        assert len(re.findall(r'<use href="#[ml][ypnu]"', panel)) == len(group["rows"]) * len(build.MATRIX_COLUMNS), group["name"]
section = readme.split('<a name="comparison">')[1].split("<details>\n<summary><b>Notes and sources")[0]
assert section.count("<picture>") == len(groups) + 1 and section.count("<details>") == 1
assert len(re.findall(r"^\| (?!Feature |---)", section, re.M)) == len(rows)
assert "cut_corners" not in (build.HERE / "build.py").read_text()
for path in build.HERE.glob("*.svg"):
    source = path.read_text()
    width = int(re.search(r'width="(\d+)"', source).group(1))
    radius = 30 if path.name.startswith("banner-") else max(width * build.CORNER, 12)
    assert f'rx="{radius:.1f}"' in source, path
    assert not re.search(r"<polygon (?!clip-path)", source), path
social = (build.HERE / "social.png").read_bytes()
assert social[:8] == b"\x89PNG\r\n\x1a\n" and social[16:24] == (1280).to_bytes(4, "big") + (640).to_bytes(4, "big")
assert len(social) < 1_000_000
for theme in build.THEMES:
    assert (build.HERE / f"release-{theme}.png").stat().st_size < 1_000_000, theme
    assert (build.HERE / f"page-head-{theme}.png").exists(), theme
files = ["Nuvo-1.0.0-x64.AppImage", "nuvo_1.0.0_amd64.deb", "Nuvo-1.0.0-aarch64.rpm", "Nuvo-Setup-1.0.0-x64.exe", "Nuvo-1.0.0-universal.dmg", "SHA256SUMS"]
notes = release_notes.render("v1.0.0", files, "The changes.\n")
assert notes.count("releases/download/v1.0.0/") == 5 and "SHA256SUMS)" not in notes, notes
assert "| Linux arm64 | [.rpm]" in notes and "| macOS universal |" in notes and "Windows arm64" not in notes, notes
order = release_notes.install_table(["b.deb", "a.tar.gz", "c.AppImage"], "v1")
assert order.index("AppImage") < order.index(".deb") < order.index(".tar.gz"), order
assert "/raw/v1.0.0/.github/readme/release-dark.png" in notes and "The changes." in notes
pages = [build.ROOT / source.relative_to(build.PAGES) for source in build.PAGES.rglob("*") if source.is_file()]
for page in [build.ROOT / "README.md", build.ROOT / ".github/PULL_REQUEST_TEMPLATE.md", *pages]:
    text = page.read_text()
    assert "nuvo.example" not in text, page
    assert not re.search(r"`docs/", text), page
    for link in re.findall(r'\]\(([^)\s]+)\)|href="([^"]+)"', text):
        target = (link[0] or link[1]).split("#")[0]
        if target and not target.startswith(("http:", "https:", "mailto:")):
            resolved = (page.parent / target).resolve()
            assert resolved.exists() and not resolved.is_relative_to(build.ROOT / "docs"), (page, target)
funding = (build.ROOT / ".github/FUNDING.yml").read_text()
assert not re.search(r"^[^#\n]*example", funding, re.M), "FUNDING.yml has a placeholder as a live value"
print("ok")
