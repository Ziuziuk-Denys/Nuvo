import type { TargetId } from "./chapters";
import type { Box } from "./placement";

const tour = (id: string) => document.querySelector(`[data-tour="${id}"]`);

const soundPanel = () => [...document.querySelectorAll('[role="dialog"]:not([aria-modal])')].find((dialog) => dialog.querySelector('[role="tab"]')) ?? null;

const soundTab = (index: number) => soundPanel()?.querySelectorAll('[role="tab"]')[index] ?? null;

const TARGETS: Record<TargetId, () => Element | null> = {
  island: () => document.querySelector("[data-island]"),
  "search-bar": () => document.querySelector("header [role=combobox]")?.parentElement ?? null,
  palette: () => document.querySelector('[role="dialog"]:has(> [role="listbox"])'),
  "nav-recognize": () => document.querySelector('[data-nav="recognize"]'),
  "recognize-sources": () => tour("recognize-sources"),
  scrubber: () => document.querySelector('[data-island] [role="slider"]'),
  rate: () => document.querySelector("[data-island] span:has([data-like]):has([data-dislike])"),
  lyrics: () => document.querySelector("[data-island] button:has([data-island-title])"),
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
  if (box.width <= 0 || box.height <= 0) return null;
  const seenWidth = Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
  const seenHeight = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
  return Math.max(0, seenWidth) * Math.max(0, seenHeight) >= (box.width * box.height) / 2 ? element : null;
}

export function boxOf(element: Element): Box & { radius: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height, radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0 };
}

export function panelOf(element: Element): Box | null {
  const panel = element.closest('[role="dialog"]');
  return panel ? boxOf(panel) : null;
}

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
