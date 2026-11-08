/** Measured sizes of the Nuvo shell in CSS pixels. e2e asserts the rendered boxes against these. */

export const WINDOW = { width: 1200, height: 780, minWidth: 1100, minHeight: 705 } as const;

/** The window's top band: 6 px frame plus the 50 px header row. Pages scroll under it. */
export const TOP_BAR = {
  height: 56,
  gutter: 12,
  wideGutter: 12,
  wideFrom: 1500,
  controlsInset: 12,
} as const;

/** The window frame: every surface sits 6 px from the window edge and 6 px from its neighbour. */
export const FRAME = 6;

/** The bottom player: a 64 px glass bar right of the rail, 6 px off the window's right and bottom edges. */
export const ISLAND = {
  height: 64,
  left: 70,
  sideMargin: 6,
  bottom: 6,
  radius: 12,
  cover: 38,
  coverRadius: 8,
  coverInset: 18,
  button: 30,
  glyph: 18,
  play: 34,
  playGlyph: 16,
  stateGlyph: 16,
} as const;

/** The navigation rail: 58 px of glass on the left, from under the top row down to the window frame.
    Glyph-only 46 px cells; settings alone at the foot. */
export const RAIL = {
  inset: FRAME,
  top: 62,
  width: 58,
  radius: 12,
  padding: 6,
  item: 46,
  glyph: 26,
  bottom: FRAME,
} as const;

/** The top row shared by the mark, the back chip and the window pill: 38 px tall, 12 px under the window's top edge. */
export const TOP_ROW = { y: 12, height: 38, pillWidth: 102, pillRadius: 10, windowButton: 30 } as const;

export const CONTENT = {
  maxWidth: 1120,
  /** Player height + its bottom inset + the frame gap, so the last row never sits under the player. */
  bottomPadding: ISLAND.height + ISLAND.bottom + FRAME,
} as const;

export const QUEUE_PANEL = { width: 360, radius: 16 } as const;

export const POPOVER = {
  narrow: 320,
  /** Speed, sleep and moments: the four Sound tabs fit one row, in Russian too. */
  sound: 440,
  wide: 560,
  wideHeight: 360,
  radius: 14,
  padding: 16,
  header: 20,
  gap: 8,
  islandGap: 10,
} as const;

export const SHEET = { maxWidth: 480, radius: 16 } as const;

export const CONTROL = { chip: 28, toggleWidth: 40, toggleHeight: 22, sliderTrack: 4, sliderKnob: 14, row: 36 } as const;

/** Media rows: 64 px with a 48 px cover for lists and tracks, 44 px for an album's numbered rows. */
export const ROW = { list: 64, track: 64, numbered: 44, cover: 48, pinnedMax: 8 } as const;

/** Entity head covers (168 square, 144 circle) and the least width of a library grid tile. */
export const COVER = { hero: 168, heroCircle: 144, gridMin: 165, mix: 160 } as const;

/** The entity head sits this far right of and below the shell's page origin. */
export const ENTITY_OFFSET = { x: 4, y: 8 } as const;

export function islandWidth(windowWidth: number): number {
  return windowWidth - ISLAND.left - ISLAND.sideMargin;
}

export function contentGutter(windowWidth: number): number {
  return windowWidth >= TOP_BAR.wideFrom ? TOP_BAR.wideGutter : TOP_BAR.gutter;
}

/** Where the content column's first line starts: right of the rail and its gap, then the gutter. */
export function contentLeft(windowWidth: number): number {
  return RAIL.inset + RAIL.width + FRAME + contentGutter(windowWidth);
}

/** Cover corner radius: 6 px at every size on pages. */
export function coverRadius(_size: number): number {
  return 6;
}
