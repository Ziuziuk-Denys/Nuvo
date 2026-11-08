/**
 * `window.nuvoElectron` for legacy callers, built on `window.nuvoShell`.
 * Retired channels answer as no-ops (main drives the Notch and the sleep blocker from
 * `player:state`). Deleted with the last legacy caller.
 */
import { deliverShareLink } from "@/links/inbox";
import { CORE_BASE_URL } from "@/data/core/request";
import { clearStorageCategories } from "@/data/storage/storage";
import type { CoreStatus, DeeplinkTarget, NuvoShell } from "./nuvoShell";

const off = () => () => undefined;

type AppInfo = Awaited<ReturnType<NuvoShell["getAppInfo"]>>;

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
  isVisible?: boolean;
}

export function makeLegacyBridge(shell: NuvoShell, info: AppInfo) {
  return {
    platform: info.platform,
    isHyprland: info.compositor === "hyprland",
    minimize: () => shell.minimize(),
    close: () => shell.close(),
    toggleMaximize: () => shell.toggleMaximize(),
    isMaximized: async () => (await shell.getWinState()).maximized,
    isFullScreen: async () => (await shell.getWinState()).fullscreen,
    onWindowStateChange: (cb: (state: WindowState) => void) =>
      shell.onWinState((s) => cb({ isMaximized: s.maximized, isFullScreen: s.fullscreen, isVisible: s.visible })),
    dragStart: () => shell.drag("start"),
    // main follows the cursor itself; the deltas are not needed
    dragMove: (_deltaX?: number, _deltaY?: number) => shell.drag("move"),
    dragEnd: () => shell.drag("end"),
    onDeeplink: (cb: (target: DeeplinkTarget) => void) => {
      // share links open in the search screen; the legacy handler knows only the catalog types
      const deliver = (t: DeeplinkTarget) => (t.type === "share" ? deliverShareLink(t.id) : cb(t));
      void shell.takePendingLink().then((t) => t && deliver(t));
      return shell.onLink(deliver);
    },
    getCoreStatus: () => shell.getCoreStatus(),
    onCoreStatus: (cb: (status: CoreStatus) => void) => shell.onCoreStatus(cb),
    getAppVersion: async () => info.version,
    getCacheStats: async () => {
      const usage = await shell.chromiumUsage();
      return {
        cacheSize: usage.httpCacheBytes + usage.codeCacheBytes,
        httpCacheSize: usage.httpCacheBytes,
        codeCacheSize: usage.codeCacheBytes,
        serviceWorkerSize: usage.serviceWorkerBytes,
        indexedDbSize: usage.indexedDbBytes,
        localStorageSize: usage.localStorageBytes,
        blobStorageSize: usage.blobBytes,
        cachePath: usage.path,
      };
    },
    clearHttpCache: () => shell.clearChromiumCache(),
    clearAudioCache: async (_all?: boolean) => {
      await clearStorageCategories(["audio"]);
      return true;
    },
    // Covers live in the daemon's encrypted cache.
    clearCoversCache: async () => {
      const response = await fetch(`${CORE_BASE_URL}/v1/cache/covers`, { method: "DELETE" }).catch(() => null);
      return response?.ok ?? false;
    },
    // The command registry owns main's global list; a second writer here would replace the whole list.
    setQuickLikeShortcut: async (_accelerator: string) => [],
    openCacheFolder: async () => shell.reveal((await shell.chromiumUsage()).path),
    setAppIcon: (pngDataUrl: string, options: { isDefault: boolean }) => shell.applyIcon(pngDataUrl, { stock: options.isDefault }),
    getNotchSession: () => shell.getPanelStatus(),
    installPanelWidget: () => shell.installPanelWidget(),
    enablePanelWidget: () => shell.enablePanelWidget(),
    openExtensionsApp: () => shell.openExtensionsApp(),
    notchUpdateLyrics: shell.notchUpdateLyrics,
    notchUpdateSettings: shell.notchUpdateSettings,
    notchUpdateState: () => undefined,
    onNotchAction: off,
  };
}

export type LegacyBridge = ReturnType<typeof makeLegacyBridge>;

export async function installLegacyBridge(shell: NuvoShell): Promise<void> {
  window.nuvoElectron = makeLegacyBridge(shell, await shell.getAppInfo());
}
