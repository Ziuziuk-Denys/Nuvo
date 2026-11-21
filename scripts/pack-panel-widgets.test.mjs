import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { test } from "node:test";
import { GNOME_UUID, packGnome } from "./pack-panel-widgets.mjs";

test("packs the GNOME extension into a zip a standard reader accepts, byte for byte", (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "panel-pack-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const file = packGnome(out);
  const source = path.join(import.meta.dirname, "..", "desktop", "gnome-shell", GNOME_UUID);
  const check = `
import sys, zipfile, pathlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
root = pathlib.Path(sys.argv[2])
names = sorted(z.namelist())
want = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())
assert names == want, (names, want)
for name in names:
    assert z.read(name) == (root / name).read_bytes(), name
print(len(names))`;
  const count = execFileSync("python3", ["-I", "-c", check, file, source], { encoding: "utf8" }).trim();
  assert.ok(Number(count) >= 4);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(packGnome(out)));
});

test("a change to the GNOME extension bumps its version, so installed copies get replaced", (t) => {
  const root = path.join(import.meta.dirname, "..");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const dir = `desktop/gnome-shell/${GNOME_UUID}`;
  let base;
  try {
    base = git("merge-base", "HEAD", process.env.NUVO_BASE_REF ?? "origin/main");
  } catch {
    t.skip("no base branch");
    return;
  }
  if (!git("diff", "--name-only", base, "--", dir)) return;
  const version = (text) => JSON.parse(text).version ?? 0;
  let before = 0;
  try {
    before = version(git("show", `${base}:${dir}/metadata.json`));
  } catch {}
  const now = version(fs.readFileSync(path.join(root, dir, "metadata.json"), "utf8"));
  assert.ok(now > before, `${dir} changed: raise "version" in metadata.json above ${before}`);
});
