// Measured shell sizes in CSS pixels; e2e asserts the rendered boxes against these

export const WINDOW = { width: 1200, height: 780, minWidth: 1100, minHeight: 705 } as const;

export const TOP_BAR = {
  height: 62,
  gutter: 12,
  wideGutter: 12,
  wideFrom: 1500,
  controlsInset: 12,
} as const;

export const FRAME = 6;

export const ISLAND = {
  height: 64,
  left: 6,
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

export const TOP_ROW = { item: 36, glyph: 24, field: 38, fieldMax: 440, windowButton: 36 } as const;

export const CONTENT = {
  maxWidth: 1120,
  bottomPadding: ISLAND.height + ISLAND.bottom + FRAME,
} as const;

export const QUEUE_PANEL = { width: 360, radius: 16 } as const;

export const POPOVER = {
  narrow: 320,
  // The four Sound tabs fit one row, in Russian too
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

export const ROW = { list: 64, track: 64, numbered: 44, cover: 48, pinnedMax: 8 } as const;

export const COVER = { hero: 168, heroCircle: 144, gridMin: 165, mix: 160 } as const;

export const ENTITY_OFFSET = { x: 4, y: 8 } as const;

export function islandWidth(windowWidth: number): number {
  return windowWidth - ISLAND.left - ISLAND.sideMargin;
}

export function contentGutter(windowWidth: number): number {
  return windowWidth >= TOP_BAR.wideFrom ? TOP_BAR.wideGutter : TOP_BAR.gutter;
}

export function contentLeft(windowWidth: number): number {
  return FRAME + contentGutter(windowWidth);
}

export function coverRadius(_size: number): number {
  return 6;
}
