/** Reduce effects (no glow, blur or motion beyond what explains a change) and the frame rate of moving backgrounds, per device. */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

export type FrameCap = 15 | 30 | 60;
export const FRAME_CAPS: readonly FrameCap[] = [60, 30, 15];

const KEY = "nuvo.effects";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

interface EffectsState {
  reduce: boolean;
  fps: FrameCap;
  setReduce(reduce: boolean): void;
  setFps(fps: FrameCap): void;
}

function stored(): { reduce: boolean; fps: FrameCap } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { reduce?: unknown; fps?: unknown };
    return { reduce: raw.reduce === true, fps: FRAME_CAPS.includes(raw.fps as FrameCap) ? (raw.fps as FrameCap) : 15 };
  } catch {
    return { reduce: false, fps: 15 };
  }
}

function keep(state: { reduce: boolean; fps: FrameCap }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // the choice still holds for this run
  }
}

export const useEffectsStore = create<EffectsState>((set, get) => ({
  ...stored(),
  setReduce(reduce) {
    set({ reduce });
    keep({ reduce, fps: get().fps });
  },
  setFps(fps) {
    set({ fps });
    keep({ reduce: get().reduce, fps });
  },
}));

function watchSystem(listener: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const systemReduced = () => typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;

/** True while the switch is on or the system asks for less motion. */
export function useReducedEffects(): boolean {
  const system = useSyncExternalStore(watchSystem, systemReduced, () => false);
  return useEffectsStore((state) => state.reduce) || system;
}

/** For loops that read it each frame. */
export function reducedEffectsNow(): boolean {
  return useEffectsStore.getState().reduce || systemReduced();
}

/** Marks the document while effects are reduced; motion.css turns glass, blur and motion down under the mark. */
export function useEffectsMark(): boolean {
  const reduced = useEffectsStore((state) => state.reduce);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-effects", reduced);
  }, [reduced]);
  return useReducedEffects();
}
