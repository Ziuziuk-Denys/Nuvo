import { useEffect, type RefObject } from "react";

const REST_AFTER_MS = 3_000;
const FIRST_VIEW_MS = 6_000;
const HELD_CHECK_MS = 500;
const HOLDS = "[data-hold]:hover, [data-hold]:active, :focus-visible, [aria-expanded='true']";

let seen = false;

export function useRest(root: RefObject<HTMLElement | null>, awake: boolean): void {
  useEffect(() => {
    const view = root.current;
    if (!view || awake) return;
    let last = performance.now() + (seen ? 0 : FIRST_VIEW_MS - REST_AFTER_MS);
    let timer = 0;
    let pointer = "";
    seen = true;

    const check = () => {
      const left = last + REST_AFTER_MS - performance.now();
      if (left > 0) timer = window.setTimeout(check, left);
      else if (view.querySelector(HOLDS)) timer = window.setTimeout(check, HELD_CHECK_MS);
      else view.dataset.rest = "";
    };
    const wake = () => {
      last = Math.max(last, performance.now());
      if (!("rest" in view.dataset)) return;
      delete view.dataset.rest;
      timer = window.setTimeout(check, REST_AFTER_MS);
    };
    const onMove = (event: PointerEvent) => {
      const at = `${event.screenX},${event.screenY}`;
      if (at === pointer) return;
      pointer = at;
      wake();
    };

    check();
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerdown", wake);
    view.addEventListener("wheel", wake, { passive: true });
    view.addEventListener("focusin", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      delete view.dataset.rest;
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerdown", wake);
      view.removeEventListener("wheel", wake);
      view.removeEventListener("focusin", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [root, awake]);
}
