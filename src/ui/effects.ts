import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

export type FrameCap = 15 | 30 | 60;
export const FRAME_CAPS: readonly FrameCap[] = [60, 30, 15];

const KEY = "nuvo.effects";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export type Look = "auto" | "visuals" | "performance";
export const LOOKS: readonly Look[] = ["auto", "visuals", "performance"];

interface Stored {
  reduce: boolean;
  fps: FrameCap;
  look: Look;
  lookAsked: boolean;
}

interface EffectsState extends Stored {
  setReduce(reduce: boolean): void;
  setFps(fps: FrameCap): void;
  setLook(look: Look): void;
  previewLook(look: Look): void;
  skipLook(): void;
}

function stored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Stored, unknown>>;
    return {
      reduce: raw.reduce === true,
      fps: FRAME_CAPS.includes(raw.fps as FrameCap) ? (raw.fps as FrameCap) : 15,
      look: LOOKS.includes(raw.look as Look) ? (raw.look as Look) : "auto",
      lookAsked: raw.lookAsked === true,
    };
  } catch {
    return { reduce: false, fps: 15, look: "auto", lookAsked: false };
  }
}

function keep(state: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export const useEffectsStore = create<EffectsState>((set, get) => {
  const save = (change: Partial<Stored>) => {
    set(change);
    const { reduce, fps, look, lookAsked } = get();
    keep({ reduce, fps, look, lookAsked });
  };
  return {
    ...stored(),
    setReduce: (reduce) => save({ reduce }),
    setFps: (fps) => save({ fps }),
    setLook: (look) => save({ look, lookAsked: true }),
    previewLook: (look) => set({ look }),
    skipLook: () => save({ lookAsked: true }),
  };
});

let strong: boolean | null = null;

// a GPU that runs WebGL only in software fails the caveat check, so it counts as weak whatever the core count
export function strongHardware(): boolean {
  strong ??=
    (navigator.hardwareConcurrency ?? 0) >= 8 &&
    typeof document !== "undefined" &&
    document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true }) !== null;
  return strong;
}

export function useVisualQuality(): "visuals" | "performance" {
  const look = useEffectsStore((state) => state.look);
  if (look !== "auto") return look;
  return strongHardware() ? "visuals" : "performance";
}

function watchSystem(listener: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const systemReduced = () => typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;

export function useReducedEffects(): boolean {
  const system = useSyncExternalStore(watchSystem, systemReduced, () => false);
  return useEffectsStore((state) => state.reduce) || system;
}

export function reducedEffectsNow(): boolean {
  return useEffectsStore.getState().reduce || systemReduced();
}

export function useEffectsMark(): boolean {
  const reduced = useEffectsStore((state) => state.reduce);
  const performance = useVisualQuality() === "performance";
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-effects", reduced);
  }, [reduced]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-performance", performance);
  }, [performance]);
  return useReducedEffects();
}
