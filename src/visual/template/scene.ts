import { balance, compose, WEIGHT_BUDGET, type Issue, type Part, type Selection, type Slot } from "./compose";
import { PARTS } from "./parts";
import type { Aspect, Frame, Template } from "./schema";

export { WEIGHT_BUDGET };

export const CENTRED: Frame = { focus: [0.5, 0.48], scale: 1, lyricBox: [0.08, 0.38, 0.84, 0.24] };
export const LOWER: Frame = { focus: [0.5, 0.45], scale: 1, lyricBox: [0.08, 0.74, 0.84, 0.14] };

export function framesFor(frame: Frame): Record<Aspect, Frame> {
  return { tall: frame, wide: { ...frame, scale: 0.85 }, square: { ...frame, scale: 0.9 } };
}

export interface Scene {
  template: Template;
  selection: Selection;
  issues: Issue[];
  weight: number;
}

export function partsFor(slot: Slot): Part[] {
  return PARTS.filter((part) => part.slot === slot);
}

export function sceneOf(selection: Selection, id = "own"): Scene {
  const { fixed, issues } = balance(selection, PARTS);
  const weightOf = (partId: string | null) => PARTS.find((part) => part.id === partId)?.weight ?? 0;
  const weight =
    weightOf(fixed.background) + fixed.atmosphere.reduce((sum, partId) => sum + weightOf(partId), 0) + weightOf(fixed.centrepiece) + weightOf(fixed.lyrics);
  const lyrics = PARTS.find((part) => part.id === fixed.lyrics);
  const frame = lyrics?.zone === "lower" ? LOWER : CENTRED;
  return { template: compose(id, fixed, PARTS, framesFor(frame)), selection: fixed, issues, weight };
}
