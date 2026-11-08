// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTour } from "../tour/tourStore";
import { ConnectionWatch } from "./ConnectionWatch";
import { useToastStore } from "./toastStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/system", () => ({
  runNetworkCheck: vi.fn(async () => ({ checkedAt: "", rows: [], summary: "", code: "blocked", service: "YouTube" })),
}));

afterEach(() => {
  vi.useRealTimers();
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
    act(() => root.unmount());
  });
});
