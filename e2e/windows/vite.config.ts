import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "e2e/windows/notch-zorder.ts",
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: "notch-zorder.mjs" } },
  },
});
