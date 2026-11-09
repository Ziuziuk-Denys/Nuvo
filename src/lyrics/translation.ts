import type { RawLyrics } from "./types";

/** At most what the daemon accepts in one request. */
export const MAX_TRANSLATED_LINES = 400;

// One pass can leave a new tag behind (<<b>b>), so repeat until nothing changes
function stripAll(text: string, pattern: RegExp): string {
  let current = text;
  let next = current.replace(pattern, "");
  while (next !== current) {
    current = next;
    next = current.replace(pattern, "");
  }
  return current;
}

export function textLines(raw: RawLyrics): string[] {
  return raw.content
    .split("\n")
    .map((line) =>
      stripAll(stripAll(line, /\[[^\]]*\]/g), /<[^>]*>/g)
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "")
    .slice(0, MAX_TRANSLATED_LINES);
}

export function targetLanguage(lines: string[]): "English" | "Russian" {
  const text = lines.join(" ");
  const cyrillic = text.match(/[Ѐ-ӿ]/g)?.length ?? 0;
  const latin = text.match(/[a-z]/gi)?.length ?? 0;
  return cyrillic > latin ? "English" : "Russian";
}
