import { useSyncExternalStore } from "react";

export const HIGHLIGHT_MODES = ["line", "word", "fill", "step"] as const;
export type HighlightMode = (typeof HIGHLIGHT_MODES)[number];

const KEY = "nuvo.karaoke.highlight";
// Legacy on/off word toggle key: off migrates to Line
const OLD_KEY = "nuvo.karaoke.words";
const DEFAULT_MODE: HighlightMode = "fill";

function read(): HighlightMode {
  try {
    const value = localStorage.getItem(KEY);
    if (HIGHLIGHT_MODES.includes(value as HighlightMode)) return value as HighlightMode;
    return localStorage.getItem(OLD_KEY) === "0" ? "line" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let mode = read();
const listeners = new Set<() => void>();

export function setHighlightMode(next: HighlightMode): void {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage blocked: the choice lasts this session
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHighlightMode(): HighlightMode {
  return useSyncExternalStore(subscribe, () => mode);
}
