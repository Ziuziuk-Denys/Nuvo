import assert from "node:assert/strict";
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { test } from "node:test";
import { referencedPackages, unusedPackages } from "./unused-deps.mjs";

test("finds imports, scoped packages, CSS imports and config references; keeps tools", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deps-"));
  const write = (name, body) => {
    fs.mkdirSync(path.join(root, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  };
  write("src/a.tsx", 'import { create } from "zustand";\nimport "@braccato/core/element";\nimport x from "zustand/middleware";\n');
  write("src/b.css", '@import "@braccato/core/styles/lyrics.css";\n');
  write("vite.config.ts", 'import react from "@vitejs/plugin-react";\n');
  const referenced = referencedPackages(root);
  assert.ok(referenced.has("zustand") && referenced.has("@braccato/core") && referenced.has("@vitejs/plugin-react"));
  const pkg = { devDependencies: { zustand: "1", "@braccato/core": "1", "@vitejs/plugin-react": "1", "left-pad": "1", typescript: "5" } };
  assert.deepEqual(unusedPackages(pkg, referenced), ["left-pad"]);
  fs.rmSync(root, { recursive: true });
});
