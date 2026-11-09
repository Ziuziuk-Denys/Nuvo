import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { DURATION_MS } from "../motion";
import { isEscapeGuarded } from "../ports/escape";

const stack: { onEscape: () => void }[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || isEscapeGuarded()) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  top.onEscape();
}

export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

export function pushLayer(onEscape: () => void): () => void {
  const layer = { onEscape };
  if (stack.length === 0) window.addEventListener("keydown", onKeyDown);
  stack.push(layer);
  return () => {
    const index = stack.indexOf(layer);
    if (index === -1) return;
    stack.splice(index, 1);
    if (stack.length === 0) window.removeEventListener("keydown", onKeyDown);
  };
}

export const LAYER_ATTRIBUTE = "data-layer";

export const EDGE_PX = 12;

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

export function trapTab(event: ReactKeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function usePresence(open: boolean): "in" | "out" | null {
  const [phase, setPhase] = useState<"in" | "out" | null>(open ? "in" : null);
  if (open && phase !== "in") setPhase("in");
  if (!open && phase === "in") setPhase("out");

  useEffect(() => {
    if (phase !== "out") return;
    // the exit is --n-t-quick in both motion modes
    const timer = window.setTimeout(() => setPhase(null), DURATION_MS.quick);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return phase;
}

export function useLayer(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  options: { onEscape: () => void; returnTo?: HTMLElement | null; onOutside?: () => void },
): void {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  // taken while rendering: a field inside the layer may autofocus at commit, before any effect runs
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }

  useEffect(() => {
    if (!open) return;
    return pushLayer(() => latest.current.onEscape());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = opener;
    const node = root.current;
    if (node) (focusables(node)[0] ?? node).focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      // a press elsewhere already moved focus where the user wanted it
      if (active && active !== document.body && !node?.contains(active)) return;
      (latest.current.returnTo ?? previous)?.focus({ preventScroll: true });
    };
  }, [open, root, opener]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const outside = latest.current.onOutside;
      const target = event.target;
      if (!outside || !(target instanceof Node)) return;
      if (root.current?.contains(target) || latest.current.returnTo?.contains(target)) return;
      if (target instanceof Element && target.closest(`[${LAYER_ATTRIBUTE}]`)) return;
      outside();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, root]);
}
