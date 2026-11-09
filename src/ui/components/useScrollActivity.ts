import { useEffect, type RefObject } from "react";
import { SCROLLBAR_FADE_MS } from "../motion";

export function useScrollActivity(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: number | undefined;
    const onScroll = () => {
      if (!element.hasAttribute("data-scrolling")) element.setAttribute("data-scrolling", "");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => element.removeAttribute("data-scrolling"), SCROLLBAR_FADE_MS);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [ref]);
}
