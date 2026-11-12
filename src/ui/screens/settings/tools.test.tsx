// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolsView } from "../../ports/system";
import { ToolsGroup } from "./ToolsGroup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const system = vi.hoisted(() => ({ readTools: vi.fn(), downloadTool: vi.fn() }));
vi.mock("../../ports/system", async (original) => ({ ...(await original<typeof import("../../ports/system")>()), ...system }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
}));

const VIEW: ToolsView = {
  tools: [
    { name: "yt-dlp", status: "ok", version: "2026.10.26" },
    { name: "js-runtime", status: "missing" },
    { name: "ffmpeg", status: "ok", version: "9.0.2" },
    { name: "ffmpeg-pulse", status: "missing" },
  ],
  download: { tool: "deno", received: 21, total: 42, failed: false },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Settings tools", () => {
  it("shows every tool with its version, and the download on the row it belongs to", async () => {
    system.readTools.mockResolvedValue(VIEW);
    await act(async () => root.render(<ToolsGroup />));
    expect(host.textContent).toContain("ui.settings.tools.title");
    expect(host.textContent).toContain('ui.settings.tools.status_ok {"version":"2026.10.26"}');
    expect(host.textContent).toContain('ui.settings.tools.status_ok {"version":"9.0.2"}');
    expect(host.textContent).toContain('ui.settings.tools.progress {"tool":"Deno","percent":50}');
    expect(host.textContent).not.toContain("ffmpeg-pulse");
    expect(host.querySelectorAll("button")).toHaveLength(3);
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });

  it("asks the core to download a tool again and follows the download", async () => {
    system.readTools.mockResolvedValue({ ...VIEW, download: undefined });
    system.downloadTool.mockResolvedValue(true);
    await act(async () => root.render(<ToolsGroup />));
    system.readTools.mockResolvedValue({ ...VIEW, download: { tool: "ffmpeg", received: 0, failed: false } });
    await act(async () => [...host.querySelectorAll("button")][2].click());
    expect(system.downloadTool).toHaveBeenCalledWith("ffmpeg");
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(host.textContent).toContain('ui.settings.tools.downloading {"tool":"ffmpeg"}');
  });

  it("says when a download failed", async () => {
    system.readTools.mockResolvedValue({ ...VIEW, download: { tool: "yt-dlp", received: 0, failed: true } });
    await act(async () => root.render(<ToolsGroup />));
    expect(host.textContent).toContain('ui.settings.tools.failed {"tool":"yt-dlp"}');
    expect([...host.querySelectorAll("button")].some((button) => button.disabled)).toBe(false);
  });
});
