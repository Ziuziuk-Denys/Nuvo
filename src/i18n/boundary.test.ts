// @vitest-environment node
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";

const SRC = path.resolve(__dirname, "..");
const OLD_I18N = /(?:from\s+|import\(\s*)["'](?:@\/languages|(?:\.\.?\/)+languages)(?:\/[^"']*)?["']/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("i18n boundary", () => {
  it("nothing imports the old i18n module", () => {
    const offenders = [...files(SRC), ...files(path.resolve(SRC, "../e2e"))]
      .filter((file) => !file.endsWith("boundary.test.ts") && OLD_I18N.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("the old directory is gone", () => {
    expect(fs.existsSync(path.join(SRC, "languages"))).toBe(false);
  });
});
