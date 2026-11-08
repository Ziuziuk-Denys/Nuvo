#!/usr/bin/env python3
"""Fills release-notes.template.md for one tag. Standard library only.

    python3 .github/readme/release_notes.py v0.3.0 assets notes.md > release-notes.md

The install table lists only files in the assets folder, because a Windows or macOS job may fail
without blocking the release.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data.json").read_text())
SYSTEMS = {".AppImage": "Linux", ".deb": "Linux", ".rpm": "Linux", ".tar.gz": "Linux", ".exe": "Windows", ".dmg": "macOS", ".zip": "macOS"}
ORDER = ["Linux x64", "Linux arm64", "Windows x64", "Windows arm64", "macOS universal"]


def describe(name):
    """System, architecture and label of a release file, or None for anything that is not an installer."""
    extension = next((item for item in SYSTEMS if name.endswith(item)), None)
    if extension is None:
        return None
    arch = "universal" if "universal" in name else "arm64" if re.search(r"arm64|aarch64", name) else "x64"
    label = extension
    if extension == ".exe":
        label = "Installer" if "Setup" in name else "Portable"
    elif extension == ".AppImage":
        label = "AppImage"
    return f"{SYSTEMS[extension]} {arch}", label


def rank(name):
    """AppImage first on Linux and the installer first on Windows, in the order of SYSTEMS."""
    return next((index for index, item in enumerate(SYSTEMS) if name.endswith(item)), len(SYSTEMS)), "Setup" not in name


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
            status = "" if system.startswith("Linux") else ", not tested"
            lines.append(f"| {system}{status} | {' · '.join(rows[system])} |")
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
