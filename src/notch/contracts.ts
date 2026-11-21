export type NotchStatus = "idle" | "loading" | "playing" | "paused";

export interface NotchTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  durationMs: number;
}

export interface NotchState {
  track: NotchTrack | null;
  status: NotchStatus;
  positionMs: number;
  sampledAt: number;
  liked: boolean;
  upNext: NotchTrack[];
}

export interface NotchLyrics {
  trackId: string;
  lines: Array<{ timeMs: number; text: string }>;
}

export type NotchExpandOn = "hover" | "click";

export type NotchPosition = "center" | "left" | "right";
export type NotchEdge = "auto" | "screen" | "bar";

export interface NotchSettings {
  mode: "auto" | "on" | "off";
  expandOn: NotchExpandOn;
  showLyrics: boolean;
  pulseOnTrackChange: boolean;
  display: "follow" | "primary" | `${number}`;
  position: NotchPosition;
  edge: NotchEdge;
  offset: number;
  stacking: "above" | "normal";
}

export const DEFAULT_NOTCH_SETTINGS: NotchSettings = {
  mode: "auto",
  expandOn: "hover",
  showLyrics: true,
  pulseOnTrackChange: true,
  display: "follow",
  position: "center",
  edge: "auto",
  offset: 0,
  stacking: "above",
};

export type NotchAction =
  | { type: "togglePlay" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "seek"; positionMs: number }
  | { type: "like" }
  | { type: "volumeDelta"; delta: number }
  | { type: "playUpNext"; trackId: string }
  | { type: "focusApp" };

// The camera housing of a MacBook display, in points
export interface Cutout {
  width: number;
  height: number;
}

export type NotchPresence = "in" | "out";

export interface NotchHello {
  state: NotchState | null;
  lyrics: NotchLyrics | null;
  settings: NotchSettings;
  cutout: Cutout | null;
  presence: NotchPresence;
}

export interface ShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
