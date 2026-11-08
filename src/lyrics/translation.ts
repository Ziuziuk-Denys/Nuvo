/** What goes to the local translator: the words of each line, and which language to ask for. Pure. */
import type { RawLyrics } from "./types";

/** At most what the daemon accepts in one request. */
export const MAX_TRANSLATED_LINES = 400;

export function textLines(raw: RawLyrics): string[] {
  return raw.content
    .split("\n")
    .map((line) =>
      line
        .replace(/\[[^\]]*\]/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "")
    .slice(0, MAX_TRANSLATED_LINES);
}

/** Russian lyrics into English, everything else into Russian. */
export function targetLanguage(lines: string[]): "English" | "Russian" {
  const text = lines.join(" ");
  const cyrillic = text.match(/[Ѐ-ӿ]/g)?.length ?? 0;
  const latin = text.match(/[a-z]/gi)?.length ?? 0;
  return cyrillic > latin ? "English" : "Russian";
}
