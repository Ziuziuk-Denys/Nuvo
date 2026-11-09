import { useLayoutEffect, useState, type RefObject } from "react";

export function useScrollMargin(ref: RefObject<HTMLElement | null>): number {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setMargin(node.offsetTop);
    measure();
    if (typeof ResizeObserver === "undefined" || !node.offsetParent) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node.offsetParent);
    return () => observer.disconnect();
  }, [ref]);
  return margin;
}
