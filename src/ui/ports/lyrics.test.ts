import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LyricsEngine, setLyrics, type StreamEvent, type Version } from "@/lyrics";
import type { TFunction } from "./i18n";
import { lyricsCommands, lyricsErrorText, useLyrics, versionLabel } from "./lyrics";

const t = ((key: string) => `t:${key}`) as unknown as TFunction;
const version = (syncLevel: string, label: string | null = null): Version => ({
  provider: "p",
  label,
  syncLevel,
  quality: 0.5,
  topPriority: false,
});

describe("lyrics port", () => {
  it("labels a version with the daemon's word, else by its sync depth", () => {
    expect(versionLabel(version("line_level"), t)).toBe("t:ui.lyrics.version_synced");
    expect(versionLabel(version("word_level"), t)).toBe("t:ui.lyrics.version_word");
    expect(versionLabel(version("syllable_level"), t)).toBe("t:ui.lyrics.version_word");
    expect(versionLabel(version("plain"), t)).toBe("t:ui.lyrics.version_plain");
    expect(versionLabel(version("line_level", "Aligned"), t)).toBe("Aligned");
    expect(versionLabel({ ...version("line_level"), topPriority: true }, t)).toBe("t:ui.lyrics.version_own");
  });

  it("8 translates the error text only in the error state", () => {
    expect(lyricsErrorText({ status: "error" }, t)).toBe("t:ui.lyrics.load_failed");
    expect(lyricsErrorText({ status: "none" }, t)).toBeNull();
  });

  it("reads the running engine and sends commands to it", async () => {
    const finished: StreamEvent = { type: "done", cached: false, status: "not_found" };
    const engine = new LyricsEngine({
      stream: async function* () {
        yield finished;
      },
      saveOffset: async () => undefined,
      requestFrame: () => 0,
      cancelFrame: () => undefined,
      now: () => 0,
    });
    setLyrics(engine);
    await engine.follow({ id: "t", title: "Song", artists: "Nova", coverUrl: "", durationMs: 1000 });
    function Probe() {
      return createElement(
        "span",
        null,
        useLyrics((state) => state.status),
      );
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>none</span>");
    lyricsCommands.changeOffset(200);
    expect(engine.getState().offsetMs).toBe(200);
    expect(lyricsCommands.wordProgress({ fromMs: 0, toMs: 100 }, 50)).toBe(50);
    engine.dispose();
  });
});
