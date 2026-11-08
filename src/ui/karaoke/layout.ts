import look from "./look.json";

/** Karaoke geometry from the measured view, scaled to the window width. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextStyle extends Box {
  fontSize: number;
  fontWeight: string;
  color: string;
  letterSpacing: string;
  lineHeight: string;
}
interface Measured {
  viewport: [number, number];
  texts: Array<TextStyle & { text: string }>;
  images: Array<Box & { radius: string }>;
}
export interface KaraokeLayout {
  scale: number;
  cover: Box & { radius: string };
  title: TextStyle;
  artist: TextStyle;
  lyrics: { x: number; width: number; fontSize: number; activeColor: string; inactiveColor: string; scrollRatio: number };
}

const SIZES = look.sizes as unknown as Record<"1200" | "1100", Measured>;
/** The measured runs never showed an active line, so its colour is Nuvo's full ink. */
const ACTIVE_COLOR = "rgb(255, 255, 255)";
/** Where the active line rests in the column, as a share of its height: upper third, a choice of ours. */
const SCROLL_RATIO = 0.38;
/** The lyric column keeps this margin to the window's right edge. */
const RIGHT_MARGIN = 56;

export function layoutFor(width: number): KaraokeLayout {
  const measured = SIZES[width >= 1150 ? "1200" : "1100"];
  const [baseWidth] = measured.viewport;
  const cover = measured.images[0];
  // the left column reads cover, title, artist from the top
  const under = measured.texts.filter((t) => t.y >= cover.y + cover.h && t.x < cover.x + cover.w).sort((a, b) => a.y - b.y);
  const lyricTexts = measured.texts.filter((t) => t.x > cover.x + cover.w + 24 && t.fontSize >= 24);
  const x = Math.min(...lyricTexts.map((t) => t.x));
  return {
    scale: width / baseWidth,
    cover,
    title: under[0],
    artist: under[1] ?? under[0],
    lyrics: {
      x,
      width: baseWidth - RIGHT_MARGIN - x,
      fontSize: lyricTexts[0].fontSize,
      activeColor: ACTIVE_COLOR,
      inactiveColor: lyricTexts[0].color,
      scrollRatio: SCROLL_RATIO,
    },
  };
}
