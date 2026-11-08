import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DRAG_SLOP_PX, MAX_SCROLL_STEP_PX, dropIndexAt, edgeScrollStep, useListReorder, type ListReorder } from "./useListReorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("reorder geometry", () => {
  it("the drop row follows the lifted row's centre, clamped to the list", () => {
    expect(dropIndexAt(100 + 10, 100, 10, 40, 5)).toBe(0);
    expect(dropIndexAt(100 + 10 + 85, 100, 10, 40, 5)).toBe(2);
    expect(dropIndexAt(-500, 100, 10, 40, 5)).toBe(0);
    expect(dropIndexAt(5000, 100, 10, 40, 5)).toBe(4);
  });

  it("scrolls only inside the edge band, faster nearer the edge", () => {
    expect(edgeScrollStep(300, 0, 600)).toBe(0);
    expect(edgeScrollStep(24, 0, 600)).toBeLessThan(0);
    expect(edgeScrollStep(0, 0, 600)).toBe(-MAX_SCROLL_STEP_PX);
    expect(edgeScrollStep(599, 0, 600)).toBeGreaterThan(edgeScrollStep(560, 0, 600));
  });
});

describe("useListReorder", () => {
  function setup(onReorder: (from: number, to: number) => void) {
    let api: ListReorder<string> | null = null;
    function Probe() {
      const scroller = useRef<HTMLDivElement>(null);
      const list = useRef<HTMLDivElement>(null);
      api = useListReorder({ items: ["a", "b", "c", "d"], scrollContainerRef: scroller, listContainerRef: list, itemHeight: 40, onReorder });
      return (
        <div ref={scroller}>
          <div ref={list} />
        </div>
      );
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) });
    const grab = (y: number) =>
      act(() => api!.handleCardGrab(0, "a", { button: 0, clientX: 10, clientY: y, currentTarget: row } as unknown as React.PointerEvent));
    const move = (y: number) => act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: y })));
    return { api: () => api!, grab, move, root };
  }

  it("lifts after the slop, reorders on release, once", () => {
    const onReorder = vi.fn();
    const view = setup(onReorder);
    view.grab(20);
    view.move(20 + DRAG_SLOP_PX - 1);
    expect(view.api().isDragging).toBe(false);
    view.move(20 + 90);
    expect(view.api()).toMatchObject({ isDragging: true, dragIndex: 0, dropIndex: 2 });
    act(() => window.dispatchEvent(new PointerEvent("pointerup")));
    expect(onReorder).toHaveBeenCalledWith(0, 2);
    expect(view.api().isDragging).toBe(false);
    act(() => view.root.unmount());
  });

  it("Escape cancels without a reorder", () => {
    const onReorder = vi.fn();
    const view = setup(onReorder);
    view.grab(20);
    view.move(120);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => window.dispatchEvent(new PointerEvent("pointerup")));
    expect(onReorder).not.toHaveBeenCalled();
    act(() => view.root.unmount());
  });
});
