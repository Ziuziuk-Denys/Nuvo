import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useNotchSettingsStore } from "./store/notchSettingsStore";
import { useNotchFeeds, type NotchLyricsInput } from "./useNotchFeeds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(input: NotchLyricsInput) {
  function Probe(props: { input: NotchLyricsInput }) {
    useNotchFeeds(props.input);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { input })));
  return { root, rerender: (next: NotchLyricsInput) => act(() => root.render(createElement(Probe, { input: next }))) };
}

afterEach(() => {
  delete (window as { nuvoShell?: unknown }).nuvoShell;
});

describe("Notch feeds under the new shell", () => {
  it("sends lyrics once they belong to the current track, without blank lines", () => {
    const notchUpdateLyrics = vi.fn();
    (window as unknown as { nuvoShell: object }).nuvoShell = { notchUpdateLyrics, notchUpdateSettings: vi.fn() };
    const lines = [
      { timeMs: 0, text: "one" },
      { timeMs: 500, text: "  " },
    ];
    const view = mount({ trackId: "t1", lyricsTrackId: "t0", lines });
    expect(notchUpdateLyrics).not.toHaveBeenCalled();
    view.rerender({ trackId: "t1", lyricsTrackId: "t1", lines });
    expect(notchUpdateLyrics).toHaveBeenCalledWith({ trackId: "t1", lines: [{ timeMs: 0, text: "one" }] });
    act(() => view.root.unmount());
  });

  it("sends the settings at once and on every change", () => {
    const notchUpdateSettings = vi.fn();
    (window as unknown as { nuvoShell: object }).nuvoShell = { notchUpdateLyrics: vi.fn(), notchUpdateSettings };
    const view = mount({ trackId: null, lyricsTrackId: null, lines: [] });
    expect(notchUpdateSettings).toHaveBeenCalledTimes(1);
    act(() => useNotchSettingsStore.setState({ expandOn: "click" }));
    expect(notchUpdateSettings.mock.calls.at(-1)![0].expandOn).toBe("click");
    act(() => view.root.unmount());
  });
});
