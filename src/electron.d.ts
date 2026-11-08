import type { LegacyBridge } from "./shell/legacyBridge";

declare global {
  interface Window {
    nuvoElectron?: LegacyBridge;
  }
}

export {};
