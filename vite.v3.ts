import type { Plugin } from "vite";
import { contentSecurityPolicy } from "./electron/app/policy";

/** The deny-by-default policy as a meta tag (packaged pages are file: pages without response headers). */
export function v3CspPlugin(): Plugin {
  let devServer: string | undefined;
  return {
    name: "nuvo-v3-content-security-policy",
    configResolved(config) {
      devServer = config.command === "serve" ? `http://localhost:${config.server.port ?? 5173}` : undefined;
    },
    transformIndexHtml() {
      // wasm stays allowed: the YouTube client may still need WebAssembly in the renderer
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy({ wasm: true, appleMusic: true, devServer }) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
