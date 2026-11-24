import { useEffect, useState } from "react";

const LEAVE_MS = 250;
const IDLE_MS = 4000;

// Linux and Windows send no mouse events over a drag region, so a pointer that vanishes inside the window counts as resting there.
export function useAwake(margin: number): boolean {
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    let shown = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";

    const set = (next: boolean) => {
      clearTimeout(timer);
      shown = next;
      setAwake(next);
      if (next) timer = setTimeout(() => set(Boolean(document.querySelector("button:hover, [role=slider]:hover, button:focus-visible"))), IDLE_MS);
    };
    const within = (event: MouseEvent) =>
      event.clientX > margin && event.clientY > margin && event.clientX < root.clientWidth - margin && event.clientY < root.clientHeight - margin;

    const onMove = (event: PointerEvent) => {
      // Chromium repeats the last move when the layout under a still pointer changes
      const at = `${event.screenX},${event.screenY}`;
      if (at === last || !within(event)) return;
      last = at;
      set(true);
    };
    const onLeave = (event: MouseEvent) => {
      last = "";
      if (!shown || within(event)) return;
      clearTimeout(timer);
      timer = setTimeout(() => set(false), LEAVE_MS);
    };
    const onKey = () => set(true);

    root.addEventListener("pointermove", onMove);
    root.addEventListener("mouseleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
  }, [margin]);

  return awake;
}
