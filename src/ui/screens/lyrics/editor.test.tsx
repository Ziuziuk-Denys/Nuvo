// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LyricsEditor } from "./LyricsEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools = vi.hoisted(() => ({ position: 0, raw: null as null | { format: string; content: string } }));
vi.mock("../../ports/lyricsTools", async () => {
  const sync = await import("@/lyrics/tapSync");
  return {
    ...sync,
    loadEditable: vi.fn(async () => tools.raw),
    saveLyrics: vi.fn(async () => undefined),
    dropUserLyrics: vi.fn(async () => undefined),
    isPlayingTrack: () => true,
    playbackPositionMs: () => tools.position,
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
});
