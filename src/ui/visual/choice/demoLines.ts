import type { Line } from "../../ports/lyrics";

export const DEMO_LINE_MS = 2_600;
const SPOKEN = 0.6;

export function demoLines(texts: string[]): Line[] {
  return texts.map((text, index) => {
    const fromMs = index * DEMO_LINE_MS;
    const parts = text.split(" ");
    const step = (DEMO_LINE_MS * SPOKEN) / parts.length;
    const words = parts.map((part, at) => ({
      fromMs: Math.round(fromMs + at * step),
      toMs: Math.round(fromMs + (at + 1) * step),
      text: at < parts.length - 1 ? `${part} ` : part,
      background: false,
    }));
    return { fromMs, toMs: fromMs + DEMO_LINE_MS, text, words, companion: false, instrumental: false };
  });
}

export function demoClock(lineCount: number, startMs = performance.now()): () => { atMs: number; playing: boolean } {
  const loopMs = lineCount * DEMO_LINE_MS;
  return () => ({ atMs: (performance.now() - startMs) % loopMs, playing: true });
}
