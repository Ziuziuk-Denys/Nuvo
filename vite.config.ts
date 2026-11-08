import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import pkg from "./package.json" with { type: "json" };
import { v3CspPlugin } from "./vite.v3";

/** A sandboxed preload may require only `electron`; anything else fails the build instead of the launch. */
function onlyElectronRequires(): Plugin {
  return {
    name: "nuvo-preload-requires",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const names = [...chunk.code.matchAll(/require\((["'`])([^"'`]+)\1\)/g)].map((m) => m[2]).filter((name) => name !== "electron");
        if (names.length > 0) this.error(`${chunk.fileName} requires ${names.join(", ")}`);
      }
    },
  };
}

/** Each preload is its own single-file CommonJS build, so no chunk is shared between them. */
function preload(name: string, input: string, alias: Record<string, string> = {}) {
  return {
    input: { [name]: input },
    vite: {
      resolve: { alias },
      plugins: [onlyElectronRequires()],
      build: { rollupOptions: { output: { format: "cjs" as const, entryFileNames: "[name].cjs" } } },
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    v3CspPlugin(),
    electron({
      main: {
        entry: { main: "electron/app/entry.ts" },
        // shipped in node_modules next to the bundle, not inlined
        vite: { build: { rolldownOptions: { external: ["electron-updater"] } } },
        onstart: async ({ startup }) => {
          await startup(process.env.NUVO_X11 ? [".", "--no-sandbox", "--ozone-platform=x11"] : undefined);
        },
      },
      preload: [
        preload("preload", "electron/app/preload.ts"),
        preload("preload-notch", "electron/app/preload-notch.ts"),
        // fflate's node build needs the `module` built-in, which a sandboxed preload cannot load
        preload("youtube-worker", "electron/youtube/worker/preload.ts", { fflate: "fflate/browser" }),
      ],
    }),
  ],
  clearScreen: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
