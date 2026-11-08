import { describe, expect, it, vi } from "vitest";
import { installLegacyBridge } from "./legacyBridge";
import type { NuvoShell } from "./nuvoShell";

describe("legacy bridge", () => {
  it("never sends main a global list: the command registry owns it (Review Focus 1)", async () => {
    const setGlobalShortcuts = vi.fn(async () => []);
    const shell = { getAppInfo: async () => ({ platform: "linux", compositor: null, version: "0.0.0" }), setGlobalShortcuts } as unknown as NuvoShell;
    await installLegacyBridge(shell);
    const bridge = (window as unknown as { nuvoElectron: { setQuickLikeShortcut(accelerator: string): Promise<unknown> } }).nuvoElectron;
    expect(await bridge.setQuickLikeShortcut("Alt+Shift+K")).toEqual([]);
    expect(setGlobalShortcuts).not.toHaveBeenCalled();
  });

  it("clears covers in the daemon's cache", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const shell = { getAppInfo: async () => ({ platform: "linux", compositor: null, version: "0.0.0" }) } as unknown as NuvoShell;
    await installLegacyBridge(shell);
    const bridge = (window as unknown as { nuvoElectron: { clearCoversCache(): Promise<boolean> } }).nuvoElectron;
    expect(await bridge.clearCoversCache()).toBe(true);
    expect(fetch).toHaveBeenCalledWith("nuvo-core://local/v1/cache/covers", { method: "DELETE" });
    vi.unstubAllGlobals();
  });

  it("asks main for the Notch session, so Settings can explain it", async () => {
    const session = { session: "wayland", supported: false, placementError: null, panel: null };
    const shell = {
      getAppInfo: async () => ({ platform: "linux", compositor: null, version: "0.0.0" }),
      getPanelStatus: async () => session,
    } as unknown as NuvoShell;
    await installLegacyBridge(shell);
    const bridge = (window as unknown as { nuvoElectron: { getNotchSession(): Promise<unknown> } }).nuvoElectron;
    expect(await bridge.getNotchSession()).toEqual(session);
  });
});
