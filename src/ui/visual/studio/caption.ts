import type { Line } from "../../ports/lyrics";

export type CaptionStyle = "song" | "line" | "short";
export const CAPTION_STYLES: CaptionStyle[] = ["song", "line", "short"];

const SITE = "nuvo.quest";

export function hashtag(name: string): string {
  const joined = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join("")
    .toLowerCase();
  return joined ? `#${joined}` : "";
}

interface CaptionInput {
  title: string;
  artists: string;
  lines: Line[];
  fromMs: number;
  toMs: number;
  credit: string;
  style: CaptionStyle;
}

export function captionFor({ title, artists, lines, fromMs, toMs, credit, style }: CaptionInput): string {
  const song = `${artists} - ${title}`;
  const tags = [hashtag(artists), hashtag(title)].filter(Boolean);
  const signed = `${credit} · ${SITE}`;
  if (style === "short") return [title, tags.join(" "), SITE].join("\n");
  const sung = lines.find((line) => line.toMs > fromMs && line.fromMs < toMs && line.text.trim())?.text.trim();
  if (style === "line" && sung) return [sung, "", song, [...tags, "#lyrics"].join(" "), signed].join("\n");
  return [song, "", [...tags, "#lyrics", "#lyricvideo"].join(" "), signed].join("\n");
}
