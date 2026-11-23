import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { useNavigationType, type Location, type NavigateFunction } from "react-router-dom";

interface HistoryEntries extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

const RESTORE_MS = 2_000;
const TAKEOVER = ["wheel", "pointerdown", "keydown"] as const;

const entries = () => (window as { navigation?: HistoryEntries }).navigation;

const watchEntries = (notify: () => void) => {
  const list = entries();
  list?.addEventListener("currententrychange", notify);
  return () => list?.removeEventListener("currententrychange", notify);
};

export function useHistoryEnds(): { back: boolean; forward: boolean } {
  const back = useSyncExternalStore(watchEntries, () => entries()?.canGoBack ?? window.history.length > 1);
  const forward = useSyncExternalStore(watchEntries, () => entries()?.canGoForward ?? false);
  return { back, forward };
}

export function useHistoryKeys(navigate: NavigateFunction, blocked: () => boolean): void {
  const held = useRef(blocked);
  useEffect(() => {
    held.current = blocked;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const target = event.target;
      if (step === 0 || (target instanceof Element && target.closest("input, textarea, [contenteditable]")) || held.current()) return;
      event.preventDefault();
      if (step === -1 ? (entries()?.canGoBack ?? true) : (entries()?.canGoForward ?? true)) void navigate(step);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}

function scrollBack(box: HTMLElement, top: number, settled: () => void): () => void {
  box.scrollTop = top;
  const page = box.firstElementChild;
  if (box.scrollTop >= top - 1 || !page || typeof ResizeObserver === "undefined") {
    settled();
    return () => undefined;
  }
  const grown = new ResizeObserver(() => {
    box.scrollTop = top;
    if (box.scrollTop >= top - 1) finish();
  });
  const stop = () => {
    grown.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKEOVER) window.removeEventListener(type, finish);
  };
  const finish = () => {
    stop();
    settled();
  };
  const timer = window.setTimeout(finish, RESTORE_MS);
  for (const type of TAKEOVER) window.addEventListener(type, finish, { passive: true });
  grown.observe(page);
  return stop;
}

export function useScrollMemory(scroller: RefObject<HTMLElement | null>, location: Location, innerScrollers: string): void {
  const type = useNavigationType();
  const place = location.pathname + location.search;
  const spot = `${location.key} ${place}`;
  const spots = useRef(new Map<string, number>());
  const restoring = useRef(false);
  const latest = useRef({ spot, type });

  useLayoutEffect(() => {
    latest.current = { spot, type };
  }, [spot, type]);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    // a page still loading clamps the scroll to its short height, which must not replace the remembered place
    const onScroll = () => {
      if (!restoring.current) spots.current.set(latest.current.spot, box.scrollTop);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [scroller]);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    for (const inner of box.querySelectorAll(innerScrollers)) inner.scrollTop = 0;
    restoring.current = true;
    return scrollBack(box, latest.current.type === "POP" ? (spots.current.get(latest.current.spot) ?? 0) : 0, () => {
      restoring.current = false;
    });
  }, [place, scroller, innerScrollers]);
}
