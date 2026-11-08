import { useEffect } from "react";
import { create } from "zustand";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { loopJump, setPoint, type AbLoop } from "./lib/abLoop";

interface AbLoopState extends AbLoop {
  setPoint: (point: "a" | "b", ms: number) => void;
  clear: () => void;
}

export const useAbLoopStore = create<AbLoopState>((set) => ({
  a: null,
  b: null,
  setPoint: (point, ms) => set((state) => setPoint(state, point, ms)),
  clear: () => set({ a: null, b: null }),
}));

/** Sets A or B at the current playback position (the keyboard path). */
export function setLoopPointHere(point: "a" | "b"): void {
  const { currentTrack, positionMs } = usePlayerStore.getState();
  if (currentTrack) useAbLoopStore.getState().setPoint(point, positionMs);
}

const POLL_MS = 20;
// The jump starts this early (wall time) so the seek dip has ramped down when B is reached
const LEAD_MS = 8;
// The long timer wakes this far ahead of B, then polling takes over
const WAKE_EARLY_MS = 60;

/**
 * Mount once (SoundSync): clears the loop on track change and jumps back to A at B.
 * timeupdate is too coarse (about 250 ms), so while a complete loop plays a timer aims at B
 * from the live element position and the playback rate.
 */
export function useAbLoop(): void {
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const a = useAbLoopStore((state) => state.a);
  const b = useAbLoopStore((state) => state.b);
  const playing = usePlayerStore((state) => state.status === "playing");

  useEffect(() => {
    useAbLoopStore.getState().clear();
  }, [trackId]);

  useEffect(() => {
    if (a === null || b === null || !playing) return;
    let timer = 0;
    let jumping = false;
    const check = () => {
      // Until the seek is issued the element still reads past B
      if (jumping) return;
      window.clearTimeout(timer);
      const rate = usePlayerStore.getState().playbackRate || 1;
      const nowMs = soundActions.livePositionMs();
      const target = loopJump({ a, b }, nowMs + LEAD_MS * rate);
      if (target !== null) {
        jumping = true;
        soundActions.seekMasked(target);
        timer = window.setTimeout(() => {
          jumping = false;
          check();
        }, LEAD_MS + POLL_MS);
        return;
      }
      const wait = (b - nowMs) / rate - LEAD_MS;
      timer = window.setTimeout(check, wait > WAKE_EARLY_MS + POLL_MS ? wait - WAKE_EARLY_MS : Math.min(POLL_MS, wait));
    };
    check();
    // A seek or a speed change moves B in wall time, so re-aim on every position or rate update
    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      if (state.positionMs !== prev.positionMs || state.playbackRate !== prev.playbackRate) check();
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [a, b, playing]);
}
