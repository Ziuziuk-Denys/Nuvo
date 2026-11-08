import type { Track } from "@/engine/types";
import type { StreamEvent } from "../types";
import { done } from "./events";

/** A scripted step: an event, "hold" until `release(trackId)`, or "fail" to break the stream. */
export type Step = StreamEvent | "hold" | "fail";

const aborted = () => new DOMException("aborted", "AbortError");

export function fakeDaemon(scripts: Record<string, Step[]> = {}) {
  const releases = new Map<string, () => void>();
  const daemon = {
    requests: [] as string[],
    saved: [] as Array<[string, number]>,
    failSaves: false,
    release: (trackId: string) => releases.get(trackId)?.(),
    async *stream(track: Track, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      daemon.requests.push(track.id);
      for (const step of scripts[track.id] ?? [done()]) {
        if (signal.aborted) throw aborted();
        if (step === "fail") throw new Error("stream broke");
        if (step === "hold") {
          await new Promise<void>((resolve, reject) => {
            releases.set(track.id, resolve);
            signal.addEventListener("abort", () => reject(aborted()), { once: true });
          });
          continue;
        }
        yield step;
      }
    },
    saveOffset: async (trackId: string, offsetMs: number) => {
      daemon.saved.push([trackId, offsetMs]);
      if (daemon.failSaves) throw new Error("daemon down");
    },
  };
  return daemon;
}
