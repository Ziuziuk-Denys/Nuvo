import { useEffect, type RefObject } from "react";
import { subscribeSpectrum } from "../ports/sound";
import type { LightView } from "./view";

const FOLLOW = 0.06;
const SETTLE = 0.004;

// the light swells only where a passage is louder than the song so far, so a steady song keeps a steady lamp
export function useBreath(on: boolean, view: RefObject<LightView | null>): void {
  useEffect(() => {
    if (!on) return;
    let near = 0;
    let usual = 0;
    const stop = subscribeSpectrum(({ wave }) => {
      let sum = 0;
      for (const sample of wave) sum += sample * sample;
      const loud = Math.sqrt(sum / wave.length);
      near += (loud - near) * FOLLOW;
      usual += (loud - usual) * (usual === 0 ? 1 : SETTLE);
      view.current?.level(usual > 0 ? Math.min(1, Math.max(0.001, near / usual / 2)) : 0);
    });
    const held = view.current;
    return () => {
      stop();
      held?.level(0);
    };
  }, [on, view]);
}
