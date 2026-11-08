/**
 * The Nuvo icon set: closed name list, raw SVG markup and the stroke per optical size.
 * Drawings live in ./svg on a 24 grid with currentColor. Filled glyphs come from MingCute (Apache-2.0) and
 * Solar by 480 Design (CC BY 4.0), line glyphs from Lucide (ISC); filled paths carry stroke="none".
 */
const files = import.meta.glob<string>("./svg/*.svg", { query: "?raw", import: "default", eager: true });

export const ICON_NAMES = [
  // transport
  "play",
  "pause",
  "next",
  "previous",
  "shuffle",
  "repeat",
  "repeat-one",
  "like",
  "liked",
  "queue",
  "lyrics",
  "playlist-add",
  "now-playing",
  // sound
  "equalizer",
  "speed",
  "sleep",
  "loop",
  "moment",
  "volume-high",
  "volume-low",
  "volume-none",
  "volume-mute",
  "output",
  "recognize",
  "radio",
  "reverb",
  // navigation
  "home",
  "library",
  "search",
  "settings",
  "back",
  "forward",
  "chevron-down",
  "chevron-up",
  "history",
  "stats",
  // entity
  "playlist",
  "album",
  "artist",
  "track",
  "folder",
  "folder-add",
  "image",
  "bookmark",
  // action
  "add",
  "remove",
  "close",
  "clear-circle",
  "more",
  "vertical-dots",
  "check",
  "select",
  "sort",
  "sort-lines",
  "filter",
  "edit",
  "trash",
  "copy",
  "link",
  "pin",
  "unpin",
  "download",
  "downloaded",
  "import",
  "export",
  "external",
  "refresh",
  "undo",
  "trim",
  "not-interested",
  "dislike",
  "microphone",
  "grid",
  "list",
  "drag",
  "expand",
  "collapse",
  // status
  "warning",
  "info",
  "offline",
  "lock",
  "clock",
  "verified-badge",
  // settings sections
  "palette",
  "gallery",
  "widget",
  "keyboard",
  "youtube",
  "database",
  "info-circle",
  // window
  "window-minimize",
  "window-maximize",
  "window-restore",
  "window-close",
  // brand
  "nuvo-mark",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export type IconSize = 14 | 16 | 18 | 20 | 24 | 26;

/** Stroke in viewBox units for the line glyphs (Lucide's 2); filled glyphs ignore it. */
export const ICON_STROKE: Record<IconSize, number> = { 14: 2, 16: 2, 18: 2, 20: 2, 24: 2, 26: 2 };

export const ICON_SVG = Object.fromEntries(ICON_NAMES.map((name) => [name, files[`./svg/${name}.svg`]])) as Record<IconName, string>;
