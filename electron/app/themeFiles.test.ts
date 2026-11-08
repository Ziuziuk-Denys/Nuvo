// @vitest-environment node
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readThemeFile, themeFileName, validateThemeExport, writeThemeFile } from "./themeFiles";

const dirs: string[] = [];
const write = (name: string, bytes: Buffer | string) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-theme-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, name), bytes);
  return path.join(dir, name);
};
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("theme files", () => {
  it("names the export from the theme without path characters", () => {
    expect(themeFileName("Dusk Rose")).toBe("Dusk Rose.nuvotheme.json");
    expect(themeFileName("../../etc/passwd")).toBe("-..-etc-passwd.nuvotheme.json");
    expect(themeFileName("...")).toBe("theme.nuvotheme.json");
  });

  it("checks the export payload", () => {
    expect(validateThemeExport({ name: "A", text: "{}" })).toEqual({ name: "A", text: "{}" });
    expect(validateThemeExport({ name: "A", text: "x".repeat(48 * 1024 + 1) })).toBeNull();
    expect(validateThemeExport({ name: 1, text: "{}" })).toBeNull();
  });

  it("reads UTF-8 up to 48 KB and refuses the rest", () => {
    expect(readThemeFile(write("a.json", '{"name":"Ünï"}'))).toEqual({ ok: true, text: '{"name":"Ünï"}' });
    expect(readThemeFile(write("b.json", Buffer.from([0xff, 0xfe, 0x00])))).toEqual({ ok: false, error: "theme_encoding" });
    expect(readThemeFile(write("c.json", "x".repeat(48 * 1024 + 1)))).toEqual({ ok: false, error: "theme_size" });
    expect(readThemeFile("/nonexistent/x.json")).toEqual({ ok: false, error: "theme_encoding" });
  });
});

describe("theme file css", () => {
  it("refuses a file whose css fetches, passes a clean one", () => {
    const bad = JSON.stringify({ css: "a{background:url(https://e.test/x)}" });
    expect(readThemeFile(write("d.json", bad))).toEqual({ ok: false, error: "theme_css" });
    const good = JSON.stringify({ css: "a{color:red}" });
    expect(readThemeFile(write("e.json", good))).toEqual({ ok: true, text: good });
  });

  it("writes the export through a temporary file in the same folder and leaves nothing behind", () => {
    const old = write("a.nuvotheme.json", "old");
    const dir = path.dirname(old);
    expect(writeThemeFile(old, "new")).toBe(true);
    expect(fs.readFileSync(old, "utf8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["a.nuvotheme.json"]);
  });

  it("a failed write is reported calmly and keeps the old file", () => {
    const old = write("a.nuvotheme.json", "old");
    const dir = path.dirname(old);
    // a directory where the temporary file would go makes the write fail
    fs.mkdirSync(path.join(dir, `a.nuvotheme.json.${process.pid}.tmp`));
    expect(writeThemeFile(old, "new")).toBe(false);
    expect(fs.readFileSync(old, "utf8")).toBe("old");
    expect(writeThemeFile(path.join(dir, "missing", "b.json"), "x")).toBe(false);
  });
});
