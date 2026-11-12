// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../feedback/toastStore";
import { BUSY_MS, downloadText, TOAST_ID, useToolDownloadToast } from "./useToolDownloadToast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const system = vi.hoisted(() => ({ readTools: vi.fn() }));
vi.mock("../ports/system", async (original) => ({ ...(await original<typeof import("../ports/system")>()), ...system }));
vi.mock("../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => `${key} ${JSON.stringify(vars ?? {})}` }),
}));

function Probe() {
  useToolDownloadToast();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ queue: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe("tool download toast", () => {
  it("names the tool and the percent while it downloads and goes away after", async () => {
    system.readTools
      .mockResolvedValueOnce({ tools: [], download: { tool: "ffmpeg", received: 50, total: 200, failed: false } })
      .mockResolvedValueOnce({ tools: [] });
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    await flush();
    const toast = useToastStore.getState().queue.find((item) => item.id === TOAST_ID);
    expect(toast?.message).toBe('ui.settings.tools.progress {"tool":"ffmpeg","percent":25}');
    await act(async () => void (await vi.advanceTimersByTimeAsync(BUSY_MS)));
    expect(useToastStore.getState().queue.find((item) => item.id === TOAST_ID)).toBeUndefined();
    act(() => root.unmount());
  });

  it("says a failed download once", async () => {
    system.readTools.mockResolvedValue({ tools: [], download: { tool: "yt-dlp", received: 0, failed: true } });
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(useToastStore.getState().queue.filter((item) => item.variant === "error")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("names Deno by its name", async () => {
    system.readTools.mockResolvedValue({ tools: [], download: { tool: "deno", received: 0, failed: true } });
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    await flush();
    expect(useToastStore.getState().queue.find((item) => item.variant === "error")?.message).toBe('ui.settings.tools.failed {"tool":"Deno"}');
    act(() => root.unmount());
  });

  it("falls back to the name alone when the size is unknown", () => {
    const t = (key: string) => key;
    expect(downloadText({ tool: "yt-dlp", received: 5, failed: false }, t)).toBe("ui.settings.tools.downloading");
  });
});
