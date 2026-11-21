import type { Line } from "@/lyrics";
import type { LyricStyle } from "../../template/schema";
import type { Box } from "../layout";
import type { Ctx } from "./kit";

export interface Pulse {
  cuts: number;
  cutAgeMs: number;
  drive: number;
  onset: number;
  level: number;
}

export interface LyricInput {
  ctx: Ctx;
  lines: Line[];
  nowMs: number;
  width: number;
  height: number;
  box: Box;
  style?: LyricStyle;
  scale?: number;
  pulse: Pulse;
}

export interface Signals {
  flash: number;
  strobe: number;
  blackout: number;
}

export const QUIET: Signals = { flash: 0, strobe: 0, blackout: 0 };

export interface LyricAnimation {
  id: string;
  weight: 1 | 2 | 3;
  zone: "full" | "centre" | "upper" | "lower";
  // the text is drawn this much ahead, so a word is readable the moment it is sung
  leadMs: number;
  draw(input: LyricInput): Signals;
}
