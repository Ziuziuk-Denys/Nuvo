import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { usePageBackdrop, usePageBackdropStore } from "./backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Screen({ cover }: { cover?: string }) {
  usePageBackdrop(cover, { scene: "wall" });
  return null;
}

describe("page backdrop", () => {
  it("sets the cover while mounted and clears it on unmount", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Screen cover="a.jpg" />));
    expect(usePageBackdropStore.getState()).toMatchObject({ coverUrl: "a.jpg", options: { scene: "wall" } });
    act(() => root.unmount());
    expect(usePageBackdropStore.getState().coverUrl).toBeNull();
  });

  it("an older screen unmounting does not clear a newer screen's cover", () => {
    const first = createRoot(document.createElement("div"));
    const second = createRoot(document.createElement("div"));
    act(() => first.render(<Screen cover="old.jpg" />));
    act(() => second.render(<Screen cover="new.jpg" />));
    act(() => first.unmount());
    expect(usePageBackdropStore.getState().coverUrl).toBe("new.jpg");
    act(() => second.unmount());
  });

  it("a screen without a cover leaves the backdrop to one that has it", () => {
    const parent = createRoot(document.createElement("div"));
    const child = createRoot(document.createElement("div"));
    act(() => child.render(<Screen cover="ring.jpg" />));
    act(() => parent.render(<Screen />));
    expect(usePageBackdropStore.getState().coverUrl).toBe("ring.jpg");
    act(() => parent.unmount());
    act(() => child.unmount());
  });
});
