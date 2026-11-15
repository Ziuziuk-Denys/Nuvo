import path from "node:path";
import type { SurfaceState } from "../../src/engine/types";

export type ThumbarCommand = "previous" | "toggle" | "next" | "like";
export type ThumbarIcon = "previous" | "play" | "pause" | "next" | "like" | "liked";

export interface ThumbarButton {
  command: ThumbarCommand;
  icon: ThumbarIcon;
  tooltip: string;
}

export interface ThumbarLabels {
  previous: string;
  play: string;
  pause: string;
  next: string;
  like: string;
  unlike: string;
}

export const THUMBAR_LABELS_EN: ThumbarLabels = {
  previous: "Previous",
  play: "Play",
  pause: "Pause",
  next: "Next",
  like: "Like",
  unlike: "Remove from liked songs",
};

const LABEL_KEYS = Object.keys(THUMBAR_LABELS_EN) as Array<keyof ThumbarLabels>;
const MAX_LABEL = 64;
export const THUMBAR_ICON_SIZES = [16, 20, 24, 28, 32];

export function thumbarButtons(state: SurfaceState, labels: ThumbarLabels): ThumbarButton[] {
  if (!state.trackId) return [];
  const playing = state.status === "playing" || state.status === "loading";
  return [
    { command: "previous", icon: "previous", tooltip: labels.previous },
    { command: "toggle", icon: playing ? "pause" : "play", tooltip: playing ? labels.pause : labels.play },
    { command: "next", icon: "next", tooltip: labels.next },
    { command: "like", icon: state.liked ? "liked" : "like", tooltip: state.liked ? labels.unlike : labels.like },
  ];
}

export function thumbarIconSize(scaleFactor: number): number {
  return THUMBAR_ICON_SIZES.find((size) => size >= Math.round(16 * scaleFactor)) ?? THUMBAR_ICON_SIZES[THUMBAR_ICON_SIZES.length - 1];
}

export function thumbarIconFile(appPath: string, icon: ThumbarIcon, size: number): string {
  return path.join(appPath, "build", "icons", "thumbar", `${icon}-${size}.png`);
}

export function validateThumbarLabels(value: unknown): ThumbarLabels | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const labels = {} as ThumbarLabels;
  for (const key of LABEL_KEYS) {
    const text = record[key];
    if (typeof text !== "string" || text.length > MAX_LABEL) return null;
    labels[key] = text;
  }
  return labels;
}

export class Thumbar {
  private state: SurfaceState | null = null;
  private labels = THUMBAR_LABELS_EN;
  private applied: string | null = null;

  constructor(private readonly apply: (buttons: ThumbarButton[]) => boolean) {}

  update(state: SurfaceState): void {
    this.state = state;
    this.sync();
  }

  setLabels(labels: ThumbarLabels): void {
    this.labels = labels;
    this.sync();
  }

  private sync(): void {
    if (!this.state) return;
    const buttons = thumbarButtons(this.state, this.labels);
    const key = JSON.stringify(buttons);
    if (key === this.applied) return;
    this.applied = this.apply(buttons) ? key : null;
  }
}
