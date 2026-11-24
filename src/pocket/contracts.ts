import type { NotchAction, NotchLyrics, NotchState, NotchTrack } from "@/notch/contracts";

export const POCKET_MIN = 220;
export const POCKET_MAX = 420;
export const POCKET_SIZES = { small: 220, medium: 300, large: 420 } as const;
export type PocketSize = keyof typeof POCKET_SIZES;

export const POCKET_QUEUE_MAX = 20;

export type PocketFace = "cover" | "lyrics" | "queue";

export interface PocketFeed {
  trackId: string | null;
  coverUrl: string | null;
  upNext: NotchTrack[];
  look: PocketLook;
}

export interface PocketLook {
  light: boolean;
  field: string;
  ink: string;
}

export type PocketTop = "app" | "window-menu" | "none";

export interface PocketHello {
  state: NotchState | null;
  lyrics: NotchLyrics | null;
  feed: PocketFeed | null;
  margin: number;
  top: PocketTop;
  onTop: boolean;
}

export interface PocketStatus {
  open: boolean;
  session: string;
  top: PocketTop;
  remembersPlace: boolean;
}

export type PocketAction = Extract<NotchAction, { type: "togglePlay" | "next" | "prev" | "seek" | "like" | "volumeDelta" | "playUpNext" | "focusApp" }>;

export const POCKET_MENU_KEYS = ["cover", "lyrics", "queue", "onTop", "onTopHint", "size", "small", "medium", "large", "openApp", "close"] as const;
export type PocketMenuLabels = Record<(typeof POCKET_MENU_KEYS)[number], string>;

export interface PocketMenuRequest {
  labels: PocketMenuLabels;
  face: PocketFace;
  faces: PocketFace[];
}
