// Dev server for the EQ harness without the Electron plugin: node e2e/sound/serve.mjs
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const server = await createServer({
  root,
  configFile: false,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify("harness") },
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { port: 5199, strictPort: true },
});
await server.listen();
console.log("http://localhost:5199/e2e/sound/harness.html");
