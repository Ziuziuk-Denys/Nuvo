#!/usr/bin/env python3
"""Usage: release_notes.py <tag> <assets-dir> <changes.md> > release-notes.md"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data.json").read_text())
NAME = re.compile(r"^Nuvo-[^-]+(?:-[^-]+)?-(linux|win|mac)-(x86_64|amd64|x64|arm64|aarch64)\.(AppImage|deb|rpm|exe|zip|dmg)$")
SYSTEMS = {"linux": "Linux", "win": "Windows", "mac": "macOS"}
LABELS = {
    ("linux", "AppImage"): "AppImage",
    ("linux", "deb"): ".deb",
    ("linux", "rpm"): ".rpm",
    ("win", "exe"): "Installer",
    ("win", "zip"): "Portable .zip",
    ("mac", "dmg"): ".dmg",
    ("mac", "zip"): ".zip",
}
ORDER = ["Linux x64", "Linux arm64", "Windows x64", "Windows arm64", "macOS Apple silicon", "macOS Intel"]
RANK = list(LABELS)


def describe(name):
    match = NAME.match(name)
    if not match or (match[1], match[3]) not in LABELS:
        return None
    system, arch, extension = match.groups()
    arm = arch in ("arm64", "aarch64")
    row = f"macOS {'Apple silicon' if arm else 'Intel'}" if system == "mac" else f"{SYSTEMS[system]} {'arm64' if arm else 'x64'}"
    return row, LABELS[(system, extension)]


def rank(name):
    match = NAME.match(name)
    return RANK.index((match[1], match[3])) if match and (match[1], match[3]) in LABELS else len(RANK)


def install_table(names, tag):
    rows = {}
    for name in sorted(names, key=rank):
        found = describe(name)
        if found:
            rows.setdefault(found[0], []).append(f"[{found[1]}]({DATA['repo']}/releases/download/{tag}/{name})")
    if not rows:
        raise ValueError("no installers in the assets folder")
    lines = []
    for system in ORDER:
        if system in rows:
            lines.append(f"| {system} | {' · '.join(rows[system])} |")
    return "\n".join(lines)


def render(tag, names, changes):
    values = {
        "tag": tag,
        "changes": changes.strip(),
        "install": install_table(names, tag),
        "tagline": DATA["tagline"],
        "unsigned": DATA["unsigned"],
        "site": DATA["site"],
        "repo": DATA["repo"],
        "slug": DATA["repo"].removeprefix("https://github.com/"),
    }
    text = (HERE / "release-notes.template.md").read_text()
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError("unfilled placeholder: " + text[text.index("{{"):][:40])
    return text


if __name__ == "__main__":
    tag, assets, changes = sys.argv[1:]
    print(render(tag, [path.name for path in Path(assets).iterdir()], Path(changes).read_text()), end="")
