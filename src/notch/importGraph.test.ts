import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";

const notchDir = path.resolve(__dirname);
const importPattern = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("notch bundle", () => {
  it("imports nothing from feature folders", () => {
    const offenders = sourceFiles(notchDir).flatMap((file) =>
      [...fs.readFileSync(file, "utf8").matchAll(importPattern)]
        .map((match) => match[1] ?? match[2])
        .filter((spec) => spec.startsWith("@/features/") || spec.includes("/features/"))
        .map((spec) => `${path.relative(notchDir, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the notch sources", () => {
    expect(sourceFiles(notchDir).some((file) => file.endsWith("NotchApp.tsx"))).toBe(true);
  });
});
