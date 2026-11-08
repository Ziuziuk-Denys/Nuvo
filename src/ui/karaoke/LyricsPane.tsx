import { useEffect, useMemo, useRef, type JSX, type Ref } from "react";
import "@braccato/core/element";
import "@braccato/core/styles/variables.css";
import "@braccato/core/styles/lyrics.css";
import "@braccato/core/styles/instrumental.css";
import type { BraccatoLyricsElement, LineClickDetail } from "@braccato/core/element";
import type { Lyric, LyricPart } from "@braccato/core";
import { FRAME_MS, lyricsCommands, lyricsErrorText, useLyrics, type Line } from "../ports/lyrics";
import { useTranslation } from "../ports/i18n";
import { useRomanization } from "./romanization";
import { reducedEffectsNow } from "../effects";
import { lyricsTheme } from "./lyricsTheme";
import type { KaraokeLayout } from "./layout";
import type { HighlightMode } from "./highlightMode";
import { NowMark } from "./nowMark";
import styles from "./LyricsPane.module.css";

/** The module only scrolls here: it needs no tick per frame, only the mark on the sung word does. */
const TICK_MS = 250;

/** Engine lines as @braccato/core lyrics: in word mode words become parts; a companion line joins the line before as background. */
export function toBraccatoLines(lines: Line[], wordMode: boolean, romanize?: ((text: string) => string) | null): Lyric[] {
  const out: Lyric[] = [];
  for (const line of lines) {
    if (line.companion && out.length > 0) {
      const host = out[out.length - 1];
      host.parts = [...(host.parts ?? []), { startTimeMs: line.fromMs, durationMs: line.toMs - line.fromMs, words: line.text, isBackground: true }];
      continue;
    }
    const words = wordMode ? line.words : undefined;
    const parts: LyricPart[] | undefined = words?.map((word) => ({
      startTimeMs: word.fromMs,
      durationMs: word.toMs - word.fromMs,
      words: word.text,
      ...(word.background ? { isBackground: true } : {}),
    }));
    out.push({ startTimeMs: line.fromMs, durationMs: line.toMs - line.fromMs, words: line.text, ...(parts ? { parts } : {}) });
  }
  return romanize ? out.map((lyric) => withRomanization(lyric, romanize)) : out;
}

/** The romanized text rides under the line as a quiet background part; the line keeps its own words. */
function withRomanization(lyric: Lyric, romanize: (text: string) => string): Lyric {
  const romanized = romanize(lyric.words);
  if (romanized === lyric.words || !romanized.trim()) return lyric;
  const main: LyricPart[] = lyric.parts ?? [{ startTimeMs: lyric.startTimeMs, durationMs: lyric.durationMs, words: lyric.words }];
  return { ...lyric, parts: [...main, { startTimeMs: lyric.startTimeMs, durationMs: lyric.durationMs, words: romanized, isBackground: true }] };
}

export function LyricsPane({
  onSeek,
  layout,
  mode = "line",
}: {
  onSeek(ms: number): void;
  layout?: KaraokeLayout["lyrics"];
  mode?: HighlightMode;
}): JSX.Element {
  const { t } = useTranslation();
  const status = useLyrics((s) => s.status);
  const lines = useLyrics((s) => s.lines);
  const plainText = useLyrics((s) => s.plainText);
  const synced = useLyrics((s) => s.synced);
  const ref = useRef<BraccatoLyricsElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { romanize } = useRomanization();
  const words = mode !== "line";
  const lyrics = useMemo(() => toBraccatoLines(lines, words, romanize), [lines, words, romanize]);
  const message = lyricsErrorText({ status }, t);
  const showSynced = status === "ready" && synced && lyrics.length > 0;

  useEffect(() => {
    const element = ref.current;
    if (!element || !showSynced) return;
    element.host = { getScrollElement: () => scroller.current };
    if (layout) element.theme = lyricsTheme(layout);
    element.lyrics = lyrics;
    const onLine = (event: Event) => onSeek(Math.round((event as CustomEvent<LineClickDetail>).detail.timeS * 1000));
    element.addEventListener("braccato:line-click", onLine);
    const mark = new NowMark(element.renderer?.lines ?? [], mode, reducedEffectsNow);
    let tickedAtMs = Number.NEGATIVE_INFINITY;
    const stopFrames = lyricsCommands.onFrame(() => {
      const { atMs, playing } = lyricsCommands.clock();
      // measured against the output: the change is on screen about 25 ms after this write, so half a tick ahead still lands after the voice
      mark.update(playing ? atMs + FRAME_MS / 2 : atMs);
      if (playing === element.playing && Math.abs(atMs - tickedAtMs) < TICK_MS) return;
      tickedAtMs = atMs;
      element.playing = playing;
      element.currentTime = atMs / 1000;
    });
    return () => {
      stopFrames();
      element.removeEventListener("braccato:line-click", onLine);
      element.lyrics = [];
    };
  }, [showSynced, lyrics, layout, onSeek, mode]);

  if (message) return <div className={styles.message}>{message}</div>;
  if (!showSynced) {
    return (
      <div className={styles.plain} ref={scroller}>
        {(plainText ?? lines.map((line) => line.text).join("\n")).split("\n").map((text, index) => (
          <p key={index}>
            {text}
            {romanize && romanize(text) !== text ? <small className={styles.romanized}>{romanize(text)}</small> : null}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.scroller} ref={scroller}>
      <braccato-lyrics ref={ref as Ref<HTMLElement>} className={styles.lines} />
    </div>
  );
}
