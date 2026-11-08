import assert from "node:assert/strict";
import { test } from "node:test";
import { slot } from "./stage-core.mjs";

test("Rust triples map to electron-builder's os-arch folders", () => {
  assert.equal(slot("x86_64-unknown-linux-gnu"), "linux-x64");
  assert.equal(slot("aarch64-unknown-linux-gnu"), "linux-arm64");
  assert.equal(slot("x86_64-pc-windows-msvc"), "win-x64");
  assert.equal(slot("aarch64-pc-windows-msvc"), "win-arm64");
  assert.equal(slot("x86_64-apple-darwin"), "mac-x64");
  assert.equal(slot("aarch64-apple-darwin"), "mac-arm64");
  assert.equal(slot(undefined, { platform: "win32", arch: "arm64" }), "win-arm64");
  assert.throws(() => slot("riscv64gc-unknown-linux-gnu"));
});
