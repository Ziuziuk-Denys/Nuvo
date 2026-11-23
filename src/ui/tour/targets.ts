import type { TargetId } from "./chapters";
import type { Box } from "./placement";

const tour = (id: string) => document.querySelector(`[data-tour="${id}"]`);

const soundPanel = () => [...document.querySelectorAll('[role="dialog"]:not([aria-modal])')].find((dialog) => dialog.querySelector('[role="tab"]')) ?? null;

const soundTab = (index: number) => soundPanel()?.querySelectorAll('[role="tab"]')[index] ?? null;

const TARGETS: Record<TargetId, () => Element | null> = {
  island: () => document.querySelector("[data-island]"),
  "search-bar": () => document.querySelector('[data-nav="search"]') ?? document.querySelector("header [role=combobox]")?.parentElement ?? null,
  palette: () => document.querySelector('[role="dialog"]:has(> [role="listbox"])'),
  "nav-recognize": () => document.querySelector('[data-nav="recognize"]'),
  "recognize-sources": () => tour("recognize-sources"),
  scrubber: () => document.querySelector('[data-island] [role="slider"]'),
  rate: () => document.querySelector("[data-island] span:has([data-like]):has([data-dislike])"),
  lyrics: () => tour("lyrics"),
  queue: () => tour("queue"),
  "sound-button": () => tour("sound"),
  "sound-panel": soundPanel,
  "sound-eq": () => soundTab(0),
  "sound-speed": () => soundTab(1),
  "sound-sleep": () => soundTab(2),
  "add-button": () => tour("add"),
  "new-playlist": () => tour("new-playlist"),
  "library-tabs": () => tour("library-tabs"),
  "library-import": () => tour("library-import"),
  mixes: () => tour("mixes"),
  "home-start": () => tour("home-start"),
  presets: () => tour("presets"),
  modes: () => tour("modes"),
};

export function targetElement(target: TargetId): HTMLElement | null {
  const element = TARGETS[target]();
  if (!(element instanceof HTMLElement)) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? element : null;
}

// What the window and every scrolling or clipping ancestor leave of the element
function clipOf(element: Element): Box {
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = parent.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function seenBox(element: Element): Box | null {
  const box = element.getBoundingClientRect();
  const clip = clipOf(element);
  const left = Math.max(box.left, clip.x);
  const top = Math.max(box.top, clip.y);
  const right = Math.min(box.right, clip.x + clip.width);
  const bottom = Math.min(box.bottom, clip.y + clip.height);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

// All of it shows, or as much as its clip can hold
export function fullyShown(element: Element): boolean {
  const seen = seenBox(element);
  if (!seen) return false;
  const box = element.getBoundingClientRect();
  const clip = clipOf(element);
  return seen.width >= Math.min(box.width, clip.width) - 1 && seen.height >= Math.min(box.height, clip.height) - 1;
}

export function scrollerOf(element: Element): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

export function radiusOf(element: Element): number {
  return parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
}

export function panelOf(element: Element): Box | null {
  const panel = element.closest('[role="dialog"]');
  if (!panel) return null;
  const box = panel.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
