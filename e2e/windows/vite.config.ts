import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: true,
    emptyOutDir: true,
    rolldownOptions: {
      input: { "notch-zorder": "e2e/windows/notch-zorder.ts", thumbar: "e2e/windows/thumbar.ts" },
      output: { entryFileNames: "[name].mjs" },
    },
  },
});
