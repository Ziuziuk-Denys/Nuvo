const STEPS = [1, 0.75, 0.5];
const WINDOW = 60;
const SLOW_MS = 25;
const HITCH_MS = 250;
const SLOW_LIMIT = 12;
const CLEAN_TO_CLIMB = 600;

export function createGovernor() {
  let step = 0;
  let seen = 0;
  let slow = 0;
  let clean = 0;
  return {
    get scale() {
      return STEPS[step];
    },
    frame(deltaMs: number): number | null {
      // a long gap is a hidden tab or a blocked thread, not the scene being too heavy
      if (deltaMs >= HITCH_MS) return null;
      seen++;
      if (deltaMs > SLOW_MS) {
        slow++;
        clean = 0;
      } else clean++;
      if (step > 0 && clean >= CLEAN_TO_CLIMB) {
        step--;
        clean = seen = slow = 0;
        return STEPS[step];
      }
      if (seen < WINDOW) return null;
      const heavy = slow >= SLOW_LIMIT && step < STEPS.length - 1;
      seen = slow = 0;
      if (!heavy) return null;
      step++;
      clean = 0;
      return STEPS[step];
    },
  };
}
