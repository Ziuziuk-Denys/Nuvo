import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cargoEntries, npmEntries, render, runtimePackages } from "./third-party-notices.mjs";

function pkg(root, name, version, deps = {}, license = "MIT") {
  const dir = path.join(root, ".pnpm", `${name.replace("/", "+")}@${version}`, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, license, dependencies: deps }));
  fs.writeFileSync(path.join(dir, "LICENSE"), `${license} text of ${name}`);
  return dir;
}

test("runtime packages follow imports and installed dependencies, without electron and types", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nm = path.join(root, "node_modules");
  const zustand = pkg(nm, "zustand", "5.0.0", { "use-sync-external-store": "1" });
  const sync = pkg(nm, "use-sync-external-store", "1.2.0");
  fs.symlinkSync(sync, path.join(path.dirname(zustand), "use-sync-external-store"));
  fs.symlinkSync(zustand, path.join(nm, "zustand"));
  fs.mkdirSync(path.join(nm, "electron"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "a.ts"),
    'import { create } from "zustand";\nimport { app } from "electron";\nimport type { X } from "@types/node";\n',
  );
  const names = runtimePackages(root);
  assert.deepEqual(
    names.map((entry) => entry.name),
    ["use-sync-external-store", "zustand"],
  );
  const entries = npmEntries(names);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.version, entry.license]),
    [
      ["use-sync-external-store", "1.2.0", "MIT"],
      ["zustand", "5.0.0", "MIT"],
    ],
  );
  assert.match(render(entries), /zustand 5\.0\.0 - MIT\n\nMIT text of zustand/);
});

test("cargo entries follow normal dependencies of the server, not dev ones or the workspace", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "LICENSE-MIT"), "MIT text of serde");
  const metadata = {
    workspace_members: ["server 0.1.0", "store 0.1.0"],
    packages: [
      { id: "server 0.1.0", name: "nuvo-server", version: "0.1.0", license: null, manifest_path: "/w/server/Cargo.toml" },
      { id: "store 0.1.0", name: "nuvo-store", version: "0.1.0", license: null, manifest_path: "/w/store/Cargo.toml" },
      { id: "serde 1.0.0", name: "serde", version: "1.0.0", license: "MIT OR Apache-2.0", manifest_path: path.join(dir, "Cargo.toml") },
      { id: "tempfile 3.0.0", name: "tempfile", version: "3.0.0", license: "MIT", manifest_path: "/x/Cargo.toml" },
    ],
    resolve: {
      nodes: [
        {
          id: "server 0.1.0",
          deps: [
            { pkg: "store 0.1.0", dep_kinds: [{ kind: null }] },
            { pkg: "tempfile 3.0.0", dep_kinds: [{ kind: "dev" }] },
          ],
        },
        { id: "store 0.1.0", deps: [{ pkg: "serde 1.0.0", dep_kinds: [{ kind: null }] }] },
        { id: "serde 1.0.0", deps: [] },
        { id: "tempfile 3.0.0", deps: [] },
      ],
    },
  };
  assert.deepEqual(
    cargoEntries(metadata).map((entry) => [entry.name, entry.license, entry.text]),
    [["serde", "MIT OR Apache-2.0", "MIT text of serde"]],
  );
});
