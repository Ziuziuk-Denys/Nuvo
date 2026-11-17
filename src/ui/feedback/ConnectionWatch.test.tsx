// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../shell/sheets";
import { useTour } from "../tour/tourStore";
import { ConnectionWatch } from "./ConnectionWatch";
import { useToastStore } from "./toastStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ports/i18n", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("../ports/system", () => ({
  runNetworkCheck: vi.fn(async () => ({
    checkedAt: "",
    rows: [],
    services: [{ service: "SoundCloud", state: "works", ms: 300 }],
    summary: "",
    code: "blocked",
    service: "YouTube",
  })),
}));

function mountAfterTour() {
  const show = vi.spyOn(useToastStore.getState(), "show").mockClear();
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<ConnectionWatch />));
  return { show, root };
}

afterEach(() => {
  vi.useRealTimers();
  delete (window as { nuvoShell?: unknown }).nuvoShell;
  act(() => useTour.setState({ phase: "off" }));
});

describe("ConnectionWatch", () => {
  it("tells a first launch that YouTube is blocked once the tour is out of the way, not under it", async () => {
    vi.useFakeTimers();
    const show = vi.spyOn(useToastStore.getState(), "show");
    useTour.setState({ phase: "chapter" });
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<ConnectionWatch />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(show).not.toHaveBeenCalled();
    act(() => useTour.setState({ phase: "off" }));
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: "ui.network_advice.blocked" }));
    act(() => show.mock.calls[0][0].action?.onClick());
    expect(useModalStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: "network" });
    act(() => root.unmount());
  });

  it("tells a blocked YouTube once, however often a weak link drops and comes back", async () => {
    vi.useFakeTimers();
    const { show, root } = mountAfterTour();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    for (let drop = 0; drop < 5; drop++) {
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new CustomEvent("nuvo:network-check", { detail: "timeout" }));
        await vi.advanceTimersByTimeAsync(3_000);
      });
    }
    expect(show).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("tells it again after the proxy changes and YouTube is still blocked", async () => {
    vi.useFakeTimers();
    let proxyChanged = () => undefined as void;
    (window as { nuvoShell?: unknown }).nuvoShell = {
      onNetworkChanged: (listener: () => void) => {
        proxyChanged = listener;
        return () => undefined;
      },
    };
    const { show, root } = mountAfterTour();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await act(async () => {
      proxyChanged();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(show).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
