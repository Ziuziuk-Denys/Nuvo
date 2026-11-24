import { useEffect, useState } from "react";

const WAKE_MS = 90;
const LEAVE_MS = 350;
const IDLE_MS = 2600;

// Linux and Windows send no mouse events over a drag region, so a pointer that vanishes inside the window counts as resting there.
export function useAwake(margin: number): boolean {
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    let shown = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const set = (next: boolean) => {
      shown = next;
      setAwake(next);
      if (timer) clearTimeout(timer);
      timer = next ? setTimeout(idle, IDLE_MS) : null;
    };
    const idle = () => {
      const onControl = document.querySelector("button:hover, [role=slider]:hover, button:focus-visible");
      set(Boolean(onControl));
    };
    const within = (event: MouseEvent) =>
      event.clientX > margin && event.clientY > margin && event.clientX < root.clientWidth - margin && event.clientY < root.clientHeight - margin;

    const onMove = (event: PointerEvent) => {
      if (!within(event)) return;
      if (shown) set(true);
      else timer ??= setTimeout(() => set(true), WAKE_MS);
    };
    const onLeave = (event: MouseEvent) => {
      if (within(event)) return;
      if (timer) clearTimeout(timer);
      timer = shown ? setTimeout(() => set(false), LEAVE_MS) : null;
    };
    const onKey = () => set(true);

    root.addEventListener("pointermove", onMove);
    root.addEventListener("mouseleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      if (timer) clearTimeout(timer);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
  }, [margin]);

  return awake;
}
