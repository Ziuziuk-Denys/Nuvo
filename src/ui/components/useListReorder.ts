import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export const DRAG_SLOP_PX = 4;
export const EDGE_PX = 48;
export const MAX_SCROLL_STEP_PX = 18;

export interface Point {
  x: number;
  y: number;
}

export interface ListReorderOptions<T> {
  items: readonly T[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  listContainerRef: RefObject<HTMLElement | null>;
  itemHeight: number;
  onReorder(from: number, to: number): void;
}

export interface ListReorder<T> {
  isDragging: boolean;
  dragIndex: number | null;
  dropIndex: number | null;
  pointerPos: Point;
  grabOffset: Point;
  handleCardGrab(index: number, item: T, event: ReactPointerEvent): void;
}

interface Drag {
  dragIndex: number;
  dropIndex: number;
  pointerPos: Point;
  grabOffset: Point;
}

const ORIGIN: Point = { x: 0, y: 0 };

export function dropIndexAt(pointerY: number, listTop: number, grabOffsetY: number, itemHeight: number, count: number): number {
  const centre = pointerY - listTop - grabOffsetY + itemHeight / 2;
  return Math.max(0, Math.min(count - 1, Math.floor(centre / itemHeight)));
}

export function edgeScrollStep(pointerY: number, top: number, bottom: number): number {
  if (pointerY < top + EDGE_PX) return -Math.ceil(MAX_SCROLL_STEP_PX * Math.min(1, (top + EDGE_PX - pointerY) / EDGE_PX));
  if (pointerY > bottom - EDGE_PX) return Math.ceil(MAX_SCROLL_STEP_PX * Math.min(1, (pointerY - (bottom - EDGE_PX)) / EDGE_PX));
  return 0;
}

export function useListReorder<T>({ items, scrollContainerRef, listContainerRef, itemHeight, onReorder }: ListReorderOptions<T>): ListReorder<T> {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ index: number; start: Point; grabOffset: Point } | null>(null);
  const pointerY = useRef(0);
  const latest = useRef({ count: items.length, itemHeight, onReorder });
  latest.current = { count: items.length, itemHeight, onReorder };

  const update = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const handleCardGrab = useCallback((index: number, _item: T, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    pending.current = { index, start: { x: event.clientX, y: event.clientY }, grabOffset: { x: event.clientX - row.left, y: event.clientY - row.top } };
  }, []);

  useEffect(() => {
    const listTop = () => listContainerRef.current?.getBoundingClientRect().top ?? 0;
    const swallowClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      pointerY.current = event.clientY;
      const started = dragRef.current;
      const start = pending.current;
      if (!started && (!start || Math.hypot(event.clientX - start.start.x, event.clientY - start.start.y) < DRAG_SLOP_PX)) return;
      const dragIndex = started ? started.dragIndex : start!.index;
      const grabOffset = started ? started.grabOffset : start!.grabOffset;
      const { count, itemHeight: height } = latest.current;
      update({
        dragIndex,
        grabOffset,
        pointerPos: { x: event.clientX, y: event.clientY },
        dropIndex: dropIndexAt(event.clientY, listTop(), grabOffset.y, height, count),
      });
    };
    const finish = (commit: boolean) => {
      const done = dragRef.current;
      pending.current = null;
      if (!done) return;
      update(null);
      // the release over a row must not also click it
      window.addEventListener("click", swallowClick, true);
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
      if (commit && done.dropIndex !== done.dragIndex) latest.current.onReorder(done.dragIndex, done.dropIndex);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [listContainerRef, update]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const scroller = scrollContainerRef.current;
      const active = dragRef.current;
      if (scroller && active) {
        const box = scroller.getBoundingClientRect();
        const step = edgeScrollStep(pointerY.current, box.top, box.bottom);
        if (step !== 0) {
          scroller.scrollTop += step;
          const top = listContainerRef.current?.getBoundingClientRect().top ?? 0;
          const dropIndex = dropIndexAt(pointerY.current, top, active.grabOffset.y, latest.current.itemHeight, latest.current.count);
          if (dropIndex !== active.dropIndex) update({ ...active, dropIndex });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, scrollContainerRef, listContainerRef, update]);

  return {
    isDragging: dragging,
    dragIndex: drag?.dragIndex ?? null,
    dropIndex: drag?.dropIndex ?? null,
    pointerPos: drag?.pointerPos ?? ORIGIN,
    grabOffset: drag?.grabOffset ?? ORIGIN,
    handleCardGrab,
  };
}
