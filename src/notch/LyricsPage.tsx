import type { CSSProperties } from "react";
import type { LyricLine } from "./lib/playback";

const REACH = 3;
const LONG_LINE = 30;
const VERY_LONG_LINE = 38;

export function LyricsPage({ lines, index }: { lines: LyricLine[]; index: number }) {
  const start = Math.max(0, index - REACH);
  return (
    <ol className="lyrics">
      {lines.slice(start, index + REACH + 1).map((line, i) => {
        const at = start + i;
        return (
          <li
            key={at}
            className="lyrics-line"
            data-current={at === index}
            data-long={line.text.length > VERY_LONG_LINE ? "very" : line.text.length > LONG_LINE ? "" : undefined}
            style={{ "--at": at - Math.max(0, index) } as CSSProperties}
          >
            <span>{line.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
