/**
 * Copies a release build of nuvo-core to core/target/dist/<os>-<arch>/, the folder electron-builder packs
 * for that target (build.<os>.extraResources). Run after cargo:
 *
 *   node scripts/stage-core.mjs                            the host build in <target>/release
 *   node scripts/stage-core.mjs aarch64-unknown-linux-gnu  a --target build in <target>/<triple>/release
 *
 * <target> is CARGO_TARGET_DIR when set, else core/target.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OS = { linux: "linux", win32: "win", darwin: "mac" };

/** electron-builder's ${os}-${arch} for a Rust target triple, or for the host when none is given. */
export function slot(triple, host = { platform: process.platform, arch: process.arch }) {
  if (!triple) return `${OS[host.platform]}-${host.arch}`;
  const arch = { x86_64: "x64", aarch64: "arm64" }[triple.split("-")[0]];
  const os = triple.includes("-linux-") ? "linux" : triple.includes("-windows-") ? "win" : triple.includes("-apple-darwin") ? "mac" : undefined;
  if (!arch || !os) throw new Error(`unsupported target ${triple}`);
  return `${os}-${arch}`;
}

// realpath: a symlinked script path still counts as running this file
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const triple = process.argv[2];
  const name = slot(triple).startsWith("win-") ? "nuvo-core.exe" : "nuvo-core";
  const target = process.env.CARGO_TARGET_DIR || path.join(ROOT, "core", "target");
  const from = path.join(target, ...(triple ? [triple] : []), "release", name);
  const to = path.join(ROOT, "core", "target", "dist", slot(triple), name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${from} -> ${to}`);
}
