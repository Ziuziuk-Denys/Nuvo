#!/usr/bin/env node
// Builds THIRD-PARTY-NOTICES from what Nuvo ships: npm packages the window and main process import (with their
// installed dependencies), the daemon's Rust crates, and the icon sets whose drawings Nuvo uses. Electron ships
// its own notices inside the packaged app, so it is not repeated here.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|@import\s+)["']([^"'./][^"']*)["']/g;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;
const packageOf = (specifier) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
const skipped = (name) => name === "electron" || name.startsWith("@types/") || name.startsWith("node:");

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Texts for packages that ship no licence file, one file per package, "/" written as "__".
const MISSING = path.join(path.dirname(fileURLToPath(import.meta.url)), "notices", "missing");

function licenseText(dir, name) {
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((entry) => LICENSE_FILE.test(entry)) : undefined;
  if (file) return fs.readFileSync(path.join(dir, file), "utf8").trim();
  const supplied = path.join(MISSING, `${name.replace("/", "__")}.txt`);
  return fs.existsSync(supplied) ? fs.readFileSync(supplied, "utf8").trim() : "";
}

/** Imported packages and their installed dependencies, resolved through pnpm's sibling layout. */
export function runtimePackages(root) {
  const queue = [];
  for (const file of [...sources(path.join(root, "src")), ...sources(path.join(root, "electron"))]) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const name = packageOf(match[1]);
      const dir = path.join(root, "node_modules", name);
      if (!skipped(name) && fs.existsSync(path.join(dir, "package.json"))) queue.push({ name, dir: fs.realpathSync(dir) });
    }
  }
  const seen = new Map();
  while (queue.length > 0) {
    const next = queue.shift();
    if (seen.has(next.dir)) continue;
    seen.set(next.dir, next);
    const manifest = JSON.parse(fs.readFileSync(path.join(next.dir, "package.json"), "utf8"));
    const siblings = next.name.startsWith("@") ? path.dirname(path.dirname(next.dir)) : path.dirname(next.dir);
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      const depDir = path.join(siblings, dep);
      if (!skipped(dep) && fs.existsSync(path.join(depDir, "package.json"))) queue.push({ name: dep, dir: fs.realpathSync(depDir) });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function npmEntries(packages) {
  return packages.map(({ dir }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const license = typeof manifest.license === "string" ? manifest.license : (manifest.license?.type ?? "see text");
    return { name: manifest.name, version: manifest.version, license, text: licenseText(dir, manifest.name) };
  });
}

export function cargoEntries(metadata) {
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const start = metadata.packages.find((p) => p.name === "nuvo-server");
  const members = new Set(metadata.workspace_members);
  const seen = new Set();
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => byId.get(id))
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "see text", text: licenseText(path.dirname(p.manifest_path), p.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const NOTICES = path.join(path.dirname(fileURLToPath(import.meta.url)), "notices");
export const ICON_ENTRIES = [
  { name: "MingCute icons", version: "subset", license: "Apache-2.0", file: "mingcute.txt" },
  { name: "Solar icons", version: "subset", license: "CC BY 4.0", file: "solar.txt" },
  { name: "Lucide icons", version: "subset", license: "ISC", file: "lucide.txt" },
]
  .filter((entry) => fs.existsSync(path.join(NOTICES, entry.file)))
  .map(({ file, ...entry }) => ({ ...entry, text: fs.readFileSync(path.join(NOTICES, file), "utf8").trim() }));

export function render(entries) {
  const head = "Third-party software in Nuvo\n\nNuvo includes the software below. Each entry keeps its own licence.\n";
  return `${head}\n${entries.map((e) => `${e.name} ${e.version} - ${e.license}\n\n${e.text || "(no licence file shipped by the package)"}\n`).join("\n---\n\n")}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", "core/Cargo.toml"], { maxBuffer: 1 << 28 }).toString(),
  );
  const entries = [...npmEntries(runtimePackages(process.cwd())), ...cargoEntries(metadata), ...ICON_ENTRIES];
  fs.writeFileSync("THIRD-PARTY-NOTICES", render(entries));
  console.log(`${entries.length} entries`);
}
