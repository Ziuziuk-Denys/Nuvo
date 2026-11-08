export interface AbLoop {
  a: number | null;
  b: number | null;
}

export const MIN_LOOP_MS = 500;

/** Setting A clears a B that would come before it; setting B before A swaps them. */
export function setPoint(loop: AbLoop, point: "a" | "b", ms: number): AbLoop {
  if (point === "a") return { a: ms, b: loop.b !== null && loop.b >= ms + MIN_LOOP_MS ? loop.b : null };
  if (loop.a === null) return { a: null, b: ms };
  return ms > loop.a ? { a: loop.a, b: Math.max(ms, loop.a + MIN_LOOP_MS) } : { a: ms, b: Math.max(loop.a, ms + MIN_LOOP_MS) };
}

/** Where playback should jump, or null to keep playing. */
export function loopJump(loop: AbLoop, positionMs: number): number | null {
  if (loop.a === null || loop.b === null) return null;
  return positionMs >= loop.b ? loop.a : null;
}
