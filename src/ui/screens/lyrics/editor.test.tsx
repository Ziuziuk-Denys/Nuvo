// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LyricsEditor } from "./LyricsEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools = vi.hoisted(() => ({
  position: 0,
  raw: null as null | { format: string; content: string },
  found: { results: [] as unknown[], failed: [] as string[] },
}));
vi.mock("../../ports/lyricsTools", async () => {
  const sync = await import("@/lyrics/tapSync");
  return {
    ...sync,
    loadEditable: vi.fn(async () => tools.raw),
    saveLyrics: vi.fn(async () => undefined),
    dropUserLyrics: vi.fn(async () => undefined),
    isPlayingTrack: () => true,
    playbackPositionMs: () => tools.position,
    searchLyrics: vi.fn(async () => tools.found),
    formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
  };
});
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import * as ports from "../../ports/lyricsTools";

const TRACK = { id: "t", title: "Song", artists: "A", coverUrl: "", durationMs: 200_000 };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  tools.raw = null;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

function type(area: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LyricsEditor", () => {
  it("starts from the found text and saves pasted LRC as LRC", async () => {
    tools.raw = { format: "plain", content: "found" };
    await act(async () => root.render(<LyricsEditor open track={TRACK} onClose={() => undefined} />));
    const area = document.body.querySelector("textarea")!;
    expect(area.value).toBe("found");
    await act(async () => type(area, "[00:01.00] mine"));
    await act(async () => button("ui.lyrics.save").click());
    expect(ports.saveLyrics).toHaveBeenCalledWith(TRACK, { format: "lrc", content: "[00:01.00] mine" });
  });

  it("starts from a pasted or loaded draft without reading the found text", async () => {
    tools.raw = { format: "plain", content: "found" };
    await act(async () => root.render(<LyricsEditor open track={TRACK} draft={"[00:02.00] from a file"} onClose={() => undefined} />));
    expect(document.body.querySelector("textarea")!.value).toBe("[00:02.00] from a file");
    expect(ports.loadEditable).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("ui.lyrics.detected_synced");
  });

  it("syncs plain lines with Space and saves them as LRC", async () => {
    await act(async () => root.render(<LyricsEditor open track={TRACK} onClose={() => undefined} />));
    await act(async () => type(document.body.querySelector("textarea")!, "One\nTwo"));
    await act(async () => button("ui.lyrics.sync").click());
    const list = document.body.querySelector("ol")!;
    tools.position = 1000;
    await act(async () => key(list, " "));
    tools.position = 4000;
    await act(async () => key(list, " "));
    await act(async () => button("ui.lyrics.save_synced").click());
    expect(ports.saveLyrics).toHaveBeenCalledWith(TRACK, { format: "lrc", content: "[00:01.00] One\n[00:04.00] Two" });
  });

  it("Use found lyrics drops the user's text", async () => {
    await act(async () => root.render(<LyricsEditor open track={TRACK} onClose={() => undefined} />));
    await act(async () => button("ui.lyrics.use_found").click());
    expect(ports.dropUserLyrics).toHaveBeenCalledWith(TRACK);
  });

  it("finds versions by title and artist, the same length first, and a pick fills the editor", async () => {
    const version = (title: string, durationMs: number, content: string) => ({
      provider: "lrclib",
      syncLevel: "line_level",
      quality: { total: 0.8 },
      lyrics: { format: "lrc", content },
      matchedTrack: { title, artists: ["A"], durationMs },
    });
    tools.found = { results: [version("Song (Live)", 260_000, "[00:09.00] live"), version("Song", 200_500, "[00:01.00] studio")], failed: [] };
    await act(async () => root.render(<LyricsEditor open track={TRACK} onClose={() => undefined} />));
    await act(async () => button("ui.lyrics.find").click());
    expect(ports.searchLyrics).toHaveBeenCalledWith({ title: "Song", artist: "A", durationMs: 200_000 }, expect.any(AbortSignal));
    const picks = [...document.body.querySelectorAll("ul button")];
    expect(picks.map((pick) => pick.textContent)).toEqual([
      "Song · A201s · ui.lyrics.version_synced · ui.lyrics.find_fits",
      "Song (Live) · A260s · ui.lyrics.version_synced",
    ]);
    await act(async () => (picks[0] as HTMLButtonElement).click());
    expect(document.body.querySelector("textarea")!.value).toBe("[00:01.00] studio");
    await act(async () => button("ui.lyrics.save").click());
    expect(ports.saveLyrics).toHaveBeenCalledWith(TRACK, { format: "lrc", content: "[00:01.00] studio" });
  });

  it("says so when the search finds nothing or fails", async () => {
    tools.found = { results: [], failed: [] };
    await act(async () => root.render(<LyricsEditor open track={TRACK} onClose={() => undefined} />));
    await act(async () => button("ui.lyrics.find").click());
    expect(document.body.querySelector("[role=status]")!.textContent).toBe("ui.lyrics.find_none");
    vi.mocked(ports.searchLyrics).mockRejectedValueOnce(new Error("down"));
    await act(async () => button("ui.lyrics.find_search").click());
    expect(document.body.querySelector("[role=status]")!.textContent).toBe("ui.lyrics.find_failed");
  });
});
