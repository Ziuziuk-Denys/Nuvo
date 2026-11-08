import type { TargetId } from "./chapters";
import type { Box } from "./placement";

const tour = (id: string) => document.querySelector(`[data-tour="${id}"]`);

/* The Sound popover: the one non-modal dialog with tabs */
const soundPanel = () => [...document.querySelectorAll('[role="dialog"]:not([aria-modal])')].find((dialog) => dialog.querySelector('[role="tab"]')) ?? null;

const soundTab = (index: number) => soundPanel()?.querySelectorAll('[role="tab"]')[index] ?? null;

/** Where each target lives in the live window. Most carry a data-tour hook; a few have a stable selector of their own */
const TARGETS: Record<TargetId, () => Element | null> = {
  island: () => document.querySelector("[data-island]"),
  "rail-search": () => document.querySelector('[data-nav="search"]'),
  "search-field": () => tour("search-field"),
  "rail-recognize": () => document.querySelector('[data-nav="recognize"]'),
  "recognize-sources": () => tour("recognize-sources"),
  scrubber: () => document.querySelector('[data-island] [role="slider"]'),
  like: () => tour("like"),
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

/** The element a target means, or null while it is not on screen: no size, or less than half of it inside the window */
export function targetElement(target: TargetId): HTMLElement | null {
  const element = TARGETS[target]();
  if (!(element instanceof HTMLElement)) return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const seenWidth = Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
  const seenHeight = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
  // a panel that opens past the window edge (the speed panel in a short window) is passed over, not outlined as a sliver
  return Math.max(0, seenWidth) * Math.max(0, seenHeight) >= (box.width * box.height) / 2 ? element : null;
}

export function boxOf(element: Element): Box & { radius: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height, radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0 };
}

/** The dialog a target sits in (the Sound popover, Settings), so a side callout can clear it */
export function panelOf(element: Element): Box | null {
  const panel = element.closest('[role="dialog"]');
  return panel ? boxOf(panel) : null;
}

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
