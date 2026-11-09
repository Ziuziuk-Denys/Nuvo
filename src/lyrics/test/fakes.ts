import type { Line } from "../types";

export const line = (fromMs: number, extra: Partial<Line> = {}): Line => ({
  fromMs,
  toMs: fromMs + 1000,
  text: `at ${fromMs}`,
  companion: false,
  instrumental: false,
  ...extra,
});

export function fakeAudio(positionMs = 0, playing = false) {
  const listeners = new Set<() => void>();
  const audio = {
    state: { positionMs, playing },
    positionMs: () => audio.state.positionMs,
    playing: () => audio.state.playing,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
  return audio;
}

export function fakeFrames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    requestFrame: (callback: () => void) => {
      queue.set(next, callback);
      return next++;
    },
    cancelFrame: (id: number) => {
      queue.delete(id);
    },
    pending: () => queue.size,
    run: () => {
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback();
    },
  };
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}
