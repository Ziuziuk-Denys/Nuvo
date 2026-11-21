import { useCallback, useEffect, useRef, type RefObject } from "react";
import { LUMA_COLS, LUMA_ROWS } from "../ports/visual";

export type Ink = "light" | "dark";

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DARK_ABOVE = 0.52;
const LIGHT_BELOW = 0.4;

const clampCell = (value: number, count: number) => Math.min(count - 1, Math.max(0, value));

export function inkOver(cells: Uint8Array, area: Area, current: Ink | undefined): Ink {
  const left = clampCell(Math.floor(area.x * LUMA_COLS), LUMA_COLS);
  const right = clampCell(Math.ceil((area.x + area.width) * LUMA_COLS) - 1, LUMA_COLS);
  const top = clampCell(Math.floor(area.y * LUMA_ROWS), LUMA_ROWS);
  const bottom = clampCell(Math.ceil((area.y + area.height) * LUMA_ROWS) - 1, LUMA_ROWS);
  let total = 0;
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) total += cells[row * LUMA_COLS + col];
  }
  const mean = total / ((right - left + 1) * (bottom - top + 1)) / 255;
  if (current === "dark") return mean < LIGHT_BELOW ? "light" : "dark";
  if (current === "light") return mean > DARK_ABOVE ? "dark" : "light";
  return mean > (DARK_ABOVE + LIGHT_BELOW) / 2 ? "dark" : "light";
}

function probesOf(column: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.matches("button, [role='slider'], h1, p") || element.children.length <= 1) found.push(element);
    else for (const child of element.children) visit(child);
  };
  for (const child of [...column.children].slice(1)) visit(child);
  return found;
}

// rects are read only after a resize, so a scene frame never forces layout
export function useSceneInk(
  root: RefObject<HTMLElement | null>,
  column: RefObject<HTMLElement | null>,
  active: boolean,
  key: string,
): (cells: Uint8Array) => void {
  const probes = useRef<{ element: HTMLElement; area: Area }[] | null>(null);

  useEffect(() => {
    const element = column.current;
    if (!element || !active) return;
    const forget = () => (probes.current = null);
    const observer = new ResizeObserver(forget);
    observer.observe(element);
    for (const probe of probesOf(element)) observer.observe(probe);
    return () => {
      observer.disconnect();
      probes.current = null;
      for (const marked of element.querySelectorAll("[data-ink]")) marked.removeAttribute("data-ink");
    };
  }, [column, active, key]);

  return useCallback(
    (cells: Uint8Array) => {
      const element = column.current;
      const canvas = root.current?.querySelector(":scope > div > canvas");
      if (!element || !canvas) return;
      if (!probes.current) {
        const frame = canvas.getBoundingClientRect();
        probes.current = probesOf(element).map((probe) => {
          const rect = probe.getBoundingClientRect();
          return {
            element: probe,
            area: {
              x: (rect.left - frame.left) / frame.width,
              y: (rect.top - frame.top) / frame.height,
              width: rect.width / frame.width,
              height: rect.height / frame.height,
            },
          };
        });
      }
      for (const { element: probe, area } of probes.current) {
        const current = probe.dataset.ink as Ink | undefined;
        const next = inkOver(cells, area, current);
        if (next !== current) probe.dataset.ink = next;
      }
    },
    [root, column],
  );
}
