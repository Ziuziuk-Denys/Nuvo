import type { Palette, Rgb } from "../render/palette";

export type TextInk = "auto" | "cover" | Rgb;

export interface TextLook {
  size: number;
  ink: TextInk;
}

export const TEXT_SIZE = { min: 0.7, max: 1.5 };

const unit = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function inkFrom(value: unknown): TextInk {
  if (value === "auto" || value === "cover") return value;
  if (Array.isArray(value) && value.length === 3 && value.every(unit)) return value.map((channel: number) => clamp(channel, 0, 1)) as Rgb;
  return "auto";
}

export function textLookOf(value: unknown): TextLook | undefined {
  if (!value || typeof value !== "object") return undefined;
  const look = value as { size?: unknown; ink?: unknown };
  return { size: unit(look.size) ? clamp(look.size as number, TEXT_SIZE.min, TEXT_SIZE.max) : 1, ink: inkFrom(look.ink) };
}

export function inkOf(look: TextLook | undefined, palette: Pick<Palette, "key">): Rgb | null {
  if (!look || look.ink === "auto") return null;
  if (look.ink !== "cover") return look.ink;
  const peak = Math.max(...palette.key, 0.001);
  return palette.key.map((channel) => channel / peak) as Rgb;
}
