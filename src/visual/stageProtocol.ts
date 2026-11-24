import type { Line } from "@/lyrics";
import type { LoadedCover } from "./cover";
import type { Aspect, Template } from "./template/schema";

export type ToStage =
  | { type: "init"; canvas: OffscreenCanvas; reduced: boolean }
  | { type: "mirror"; canvas: OffscreenCanvas }
  | { type: "template"; template: Template; aspect: Aspect }
  | { type: "cover"; cover: LoadedCover | null }
  | { type: "lyrics"; lines: Line[] }
  | { type: "await-image" }
  | { type: "image"; source: ImageBitmap | VideoFrame | null; width: number; height: number }
  | { type: "song"; pcm: Float32Array | null; sampleRate: number }
  | { type: "tap"; wave: Float32Array; sampleRate: number }
  | { type: "clock"; atMs: number; playing: boolean; stamp: number }
  | { type: "size"; width: number; height: number }
  | { type: "motion"; reduced: boolean }
  | { type: "quality"; light: boolean }
  | { type: "dispose" };

export type FromStage = { type: "foot"; rgb: [number, number, number] } | { type: "tone"; light: boolean } | { type: "luma"; cells: Uint8Array };

// each thread's performance.now starts at its own origin
export const sharedNow = (): number => performance.timeOrigin + performance.now();
