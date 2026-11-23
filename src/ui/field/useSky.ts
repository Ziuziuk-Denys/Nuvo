import { useEffect, useState, type RefObject } from "react";
import { moveSky } from "./Sky";

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return focused;
}

function useOnScreen(target: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);
  return shown;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  return parent;
}

export function useSkyMode(target: RefObject<HTMLElement | null>): "live" | "still" {
  const onScreen = useOnScreen(target);
  const focused = useWindowFocused();
  return onScreen && focused ? "live" : "still";
}

export function useSkyFollows(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = target.current!;
    const scroller = scrollParent(root);
    const sync = () => {
      const rect = root.getBoundingClientRect();
      moveSky(rect.bottom, rect.bottom + (scroller?.scrollTop ?? 0));
    };
    sync();
    (scroller ?? window).addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    // the entrance lifts the section, so its edge settles only when the animation ends
    document.addEventListener("animationend", sync, true);
    return () => {
      (scroller ?? window).removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      document.removeEventListener("animationend", sync, true);
    };
  }, [target]);
}
