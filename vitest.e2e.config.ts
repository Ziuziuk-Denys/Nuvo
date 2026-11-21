import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    setupFiles: ["e2e/failures.ts"],
    // one font on every machine: the system sans differs between desktops, headless sessions and runners
    env: { FONTCONFIG_FILE: path.resolve(import.meta.dirname, "e2e/fonts.conf") },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    expect: { poll: { timeout: 15_000 } },
  },
});
