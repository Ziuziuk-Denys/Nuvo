#!/usr/bin/env node
// Declared packages nothing references: a source import, a CSS import, a config file, or the tool list below.
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { fileURLToPath } from "node:url";

/** Used by command line or by name in config, not by import. */
export const TOOLS = [
  "typescript",
  "vite",
  "vitest",
  "electron",
  "electron-builder",
  "oxlint",
  "prettier",
  "jsdom",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "playwright-core",
];

const ROOTS = ["src", "electron", "e2e", "scripts", "vite.config.ts", "vite.v3.ts", "vitest.config.ts", "vitest.e2e.config.ts", "index.html"];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*|@import\s+)["']([^"'./][^"']*)["']/g;

function files(root, rel, out) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return out;
  if (fs.statSync(full).isFile()) {
    out.push(rel);
    return out;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "artifacts") continue;
    files(root, path.join(rel, entry.name), out);
  }
  return out;
}

const packageOf = (specifier) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);

export function referencedPackages(root) {
  const found = new Set();
  for (const rel of ROOTS.flatMap((r) => files(root, r, []))) {
    if (!/\.(ts|tsx|mts|mjs|js|css|html)$/.test(rel)) continue;
    for (const match of fs.readFileSync(path.join(root, rel), "utf8").matchAll(SPECIFIER)) found.add(packageOf(match[1]));
  }
  return found;
}

export function unusedPackages(pkg, referenced) {
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return declared.filter((name) => !referenced.has(name) && !TOOLS.includes(name)).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const unused = unusedPackages(pkg, referencedPackages(process.cwd()));
  for (const name of unused) console.log(name);
  if (process.argv.includes("--fail") && unused.length > 0) process.exit(1);
}
