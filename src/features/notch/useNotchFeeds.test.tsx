import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useNotchSettingsStore } from "./store/notchSettingsStore";
import { usePlaylistAdds } from "./playlistAdds";
import { useNotchFeeds, type NotchLyricsInput, type NotchPlaylistInput } from "./useNotchFeeds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NONE: NotchPlaylistInput[] = [];

function mount(input: NotchLyricsInput, playlists = NONE) {
  function Probe(props: { input: NotchLyricsInput }) {
    useNotchFeeds(props.input, playlists);
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
    (window as unknown as { nuvoShell: object }).nuvoShell = { notchUpdateLyrics, notchUpdatePlaylists: vi.fn(), notchUpdateSettings: vi.fn() };
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
    (window as unknown as { nuvoShell: object }).nuvoShell = { notchUpdateLyrics: vi.fn(), notchUpdatePlaylists: vi.fn(), notchUpdateSettings };
    const view = mount({ trackId: null, lyricsTrackId: null, lines: [] });
    expect(notchUpdateSettings).toHaveBeenCalledTimes(1);
    act(() => useNotchSettingsStore.setState({ expandOn: "click" }));
    expect(notchUpdateSettings.mock.calls.at(-1)![0].expandOn).toBe("click");
    act(() => view.root.unmount());
  });

  it("sends the playlists newest first with a cover from the core, and every answer to an add", () => {
    const notchUpdatePlaylists = vi.fn();
    (window as unknown as { nuvoShell: object }).nuvoShell = { notchUpdateLyrics: vi.fn(), notchUpdatePlaylists, notchUpdateSettings: vi.fn() };
    const view = mount({ trackId: null, lyricsTrackId: null, lines: [] }, [
      { id: "old", title: "Old", coverUrl: "", coverUrls: ["nuvo-core://x", "https://c.test/1.jpg"], trackCount: 2, updatedAt: "2026-01-01" },
      { id: "new", title: "New", coverUrl: "", coverUrls: [], trackCount: 0, updatedAt: "2026-02-01" },
    ]);
    expect(notchUpdatePlaylists).toHaveBeenLastCalledWith({
      items: [
        { id: "new", title: "New", coverUrl: null, trackCount: 0 },
        { id: "old", title: "Old", coverUrl: "nuvo-core://local/v1/covers?src=https%3A%2F%2Fc.test%2F1.jpg&size=128", trackCount: 2 },
      ],
      outcome: null,
    });
    const outcome = { trackId: "t", playlistId: "new", kind: "added" } as const;
    act(() => usePlaylistAdds.setState({ outcome }));
    expect(notchUpdatePlaylists.mock.calls.at(-1)![0].outcome).toEqual(outcome);
    act(() => view.root.unmount());
  });
});
