import type { KaraokeLayout } from "./layout";

/**
 * Nuvo's stylesheet for @braccato/core: measured size and inactive colour, the system font, the follow position.
 * What is being sung is a flat change of colour: nowMark.ts marks it from the audio clock, the module's own
 * sweep, glow, wobble and scale are off and its highlight copies of the words are not drawn. The mark lights at
 * once, so nothing delays it behind the voice, and lets go with a short plain fade. The fill is two flat colours
 * with a hard edge between them, as a filled word is no other colour than a lit one and a dim one.
 */
export function lyricsTheme(lyrics: KaraokeLayout["lyrics"]): string {
  return [
    `/* blyrics-target-scroll-pos-ratio = ${lyrics.scrollRatio}; */`,
    // words over 16 characters may wrap, or they would run out of the column
    "/* blyrics-long-word-wrap-threshold = 8; */",
    ".blyrics-container {",
    // Settings > Look writes the lyrics size and font on :root (applyFontSettings)
    `  --blyrics-font-size: calc(${lyrics.fontSize}px * var(--n-lyrics-scale, 1));`,
    '  --blyrics-font-family: var(--n-font-lyrics, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable", system-ui, sans-serif);',
    "  --blyrics-font-weight: 600;",
    "  --blyrics-line-height: 1.4;",
    `  --blyrics-lyric-active-color: ${lyrics.activeColor};`,
    `  --blyrics-lyric-inactive-color: ${lyrics.inactiveColor};`,
    "  --blyrics-scale: 1;",
    "  --blyrics-animate-line-scale: 0;",
    "  --blyrics-animate-word-wobble: 0;",
    "  --blyrics-animate-highlight-swipe: 0;",
    "  --blyrics-animate-highlight-glow: 0;",
    "  --blyrics-animate-highlight-fade: 0;",
    "  --blyrics-animate-instrumental: 0;",
    "  --blyrics-richsync-timing-offset: 0s;",
    // measured: 40 px between lines, words start at the column edge
    "  --blyrics-padding: 20px;",
    "}",
    ".blyrics-container > div {",
    "  padding-inline: 0 !important;",
    "}",
    ".blyrics-highlight-run {",
    "  display: none;",
    "}",
    ".blyrics--word {",
    "  transition: color 140ms linear;",
    "}",
    ".blyrics--word[data-nuvo-now],",
    "[data-nuvo-now] .blyrics--word {",
    "  color: var(--blyrics-lyric-active-color);",
    "  transition: none;",
    "}",
    ".blyrics--word[data-nuvo-fill] {",
    "  color: transparent;",
    "  background-image: linear-gradient(90deg, var(--blyrics-lyric-active-color) calc(var(--nuvo-fill, 0) * 100%), var(--blyrics-lyric-inactive-color) 0);",
    "  background-clip: text;",
    "  transition: none;",
    "}",
    ".blyrics--word.blyrics-rtl[data-nuvo-fill] {",
    "  background-image: linear-gradient(270deg, var(--blyrics-lyric-active-color) calc(var(--nuvo-fill, 0) * 100%), var(--blyrics-lyric-inactive-color) 0);",
    "}",
    "@media (prefers-reduced-motion: reduce) {",
    "  .blyrics--word {",
    "    transition: none;",
    "  }",
    "}",
  ].join("\n");
}
