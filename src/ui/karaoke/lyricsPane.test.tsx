import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LyricsState } from "../ports/lyrics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let state: Partial<LyricsState> = {};
vi.mock("@braccato/core/element", () => ({}));
vi.mock("../ports/lyrics", () => ({
  FRAME_MS: 1000 / 30,
  useLyrics: (select: (s: LyricsState) => unknown) => select(state as LyricsState),
  lyricsCommands: { clock: () => ({ atMs: 0, playing: false }), onFrame: () => () => undefined },
  romanizerFor: () => null,
  romanizeKana: () => "",
  lyricsErrorText: (s: { status: string }) => (s.status === "ready" ? null : `status ${s.status}`),
}));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { layoutFor } from "./layout";
import { LyricsPane, toBraccatoLines } from "./LyricsPane";
import { lyricsTheme } from "./lyricsTheme";

describe("lyric lines", () => {
  it("lines become braccato lyrics, a companion line rides on the line before as background", () => {
    const lines = [
      {
        fromMs: 0,
        toMs: 1000,
        text: "one two",
        words: [
          { fromMs: 0, toMs: 400, text: "one ", background: false },
          { fromMs: 400, toMs: 1000, text: "two", background: false },
        ],
        companion: false,
        instrumental: false,
      },
      { fromMs: 500, toMs: 900, text: "(ooh)", companion: true, instrumental: false },
    ];
    const out = toBraccatoLines(lines, true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startTimeMs: 0, durationMs: 1000, words: "one two" });
    expect(out[0].parts).toEqual([
      { startTimeMs: 0, durationMs: 400, words: "one " },
      { startTimeMs: 400, durationMs: 600, words: "two" },
      { startTimeMs: 500, durationMs: 400, words: "(ooh)", isBackground: true },
    ]);
  });

  it("romanized text rides under each line as a background part and the line keeps its words", () => {
    const lines = [
      { fromMs: 0, toMs: 1000, text: "안녕", companion: false, instrumental: false },
      { fromMs: 1000, toMs: 2000, text: "hello", companion: false, instrumental: false },
    ];
    const out = toBraccatoLines(lines, false, (text) => (text === "안녕" ? "annyeong" : text));
    expect(out[0]).toMatchObject({ words: "안녕" });
    expect(out[0].parts).toEqual([
      { startTimeMs: 0, durationMs: 1000, words: "안녕" },
      { startTimeMs: 0, durationMs: 1000, words: "annyeong", isBackground: true },
    ]);
    expect(out[1].parts).toBeUndefined();
  });

  it("a line without word times has no parts", () => {
    const out = toBraccatoLines([{ fromMs: 100, toMs: 300, text: "plain line", companion: false, instrumental: false }], true);
    expect(out).toEqual([{ startTimeMs: 100, durationMs: 200, words: "plain line" }]);
  });

  const word = (fromMs: number, toMs: number, text: string) => ({ fromMs, toMs, text, background: false });

  it("word mode gives parts only to lines with real word timing, a line without stays a line", () => {
    const out = toBraccatoLines(
      [
        { fromMs: 0, toMs: 100, text: "real", words: [word(0, 100, "real")], companion: false, instrumental: false },
        { fromMs: 100, toMs: 200, text: "plain", companion: false, instrumental: false },
      ],
      true,
    );
    expect(out.map((line) => line.parts?.[0].words)).toEqual(["real", undefined]);
  });

  it("line mode has no word parts", () => {
    const out = toBraccatoLines([{ fromMs: 0, toMs: 100, text: "real", words: [word(0, 100, "real")], companion: false, instrumental: false }], false);
    expect(out.every((line) => line.parts === undefined)).toBe(true);
  });

  it("the theme carries the measured size and colours, a 220 ms change and the follow position", () => {
    const css = lyricsTheme({
      x: 600,
      width: 520,
      fontSize: 34,
      activeColor: "rgb(255, 255, 255)",
      inactiveColor: "rgba(255, 255, 255, 0.3)",
      scrollRatio: 0.38,
    });
    expect(css).toContain("--blyrics-font-size: calc(34px * var(--n-lyrics-scale, 1))");
    // the Lyrics font and size from Settings > Look
    expect(css).toMatch(/--blyrics-font-family: var\(--n-font-lyrics, /);
    expect(css).toContain("blyrics-target-scroll-pos-ratio = 0.38");
    expect(css).toContain("--blyrics-lyric-active-color: rgb(255, 255, 255)");
    expect(css).toContain("--blyrics-lyric-inactive-color: rgba(255, 255, 255, 0.3)");
    // measured: 40 px between lines, the first word at the column edge
    expect(css).toContain("--blyrics-padding: 20px");
    expect(css).toMatch(/padding-inline: 0/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none/);
  });

  it("what is being sung is flat colour: no glow, wobble, scale or blur, and no highlight copies drawn", () => {
    const css = lyricsTheme({
      x: 600,
      width: 520,
      fontSize: 34,
      activeColor: "rgb(255, 255, 255)",
      inactiveColor: "rgba(255, 255, 255, 0.3)",
      scrollRatio: 0.38,
    });
    for (const effect of ["highlight-swipe", "highlight-glow", "highlight-fade", "word-wobble", "line-scale"])
      expect(css).toContain(`--blyrics-animate-${effect}: 0`);
    expect(css).toContain("--blyrics-richsync-timing-offset: 0s");
    expect(css).toMatch(/\.blyrics-highlight-run \{[^}]*display: none/);
    expect(css).toMatch(/\[data-nuvo-now\] \.blyrics--word \{[^}]*color: var\(--blyrics-lyric-active-color\)/);
    expect(css).not.toMatch(/drop-shadow|text-shadow|blur/);
    // the fill: two flat colours with a hard edge, the second stop at 0 sits on the first
    expect(css).toMatch(
      /linear-gradient\(90deg, var\(--blyrics-lyric-active-color\) calc\(var\(--nuvo-fill, 0\) \* 100%\), var\(--blyrics-lyric-inactive-color\) 0\)/,
    );
  });

  it("the layout reads the measured lyric column: 32 px lines, white at 30 % inactive, full white active", () => {
    const wide = layoutFor(1200).lyrics;
    expect(wide).toMatchObject({ x: 624, width: 520, fontSize: 32 });
    expect(wide.inactiveColor).toContain("0.3");
    expect(wide.activeColor).toBe("rgb(255, 255, 255)");
    expect(wide.scrollRatio).toBeGreaterThan(0);
    expect(wide.scrollRatio).toBeLessThan(1);
    expect(layoutFor(1100).lyrics.x).toBe(574);
    expect(layoutFor(1200).cover).toMatchObject({ w: 340, h: 340 });
  });

  it("shows the plain message for every non-ready status", () => {
    for (const status of ["loading", "none", "instrumental", "error", "idle"] as const) {
      state = { status, lines: [], plainText: null, synced: false };
      const host = document.createElement("div");
      const root = createRoot(host);
      act(() => root.render(<LyricsPane onSeek={() => undefined} />));
      expect(host.textContent).toContain(`status ${status}`);
      act(() => root.unmount());
    }
  });

  it("plain lyrics show as static text", () => {
    state = { status: "ready", lines: [], plainText: "first\nsecond", synced: false };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<LyricsPane onSeek={() => undefined} />));
    expect([...host.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["first", "second"]);
    act(() => root.unmount());
  });
});
