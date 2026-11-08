import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { usePageBackdrop, usePageBackdropStore } from "./backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Screen({ cover }: { cover: string }) {
  usePageBackdrop(cover, { blur: 56, dim: 0.22 });
  return null;
}

describe("page backdrop", () => {
  it("sets the cover while mounted and clears it on unmount", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Screen cover="a.jpg" />));
    expect(usePageBackdropStore.getState()).toMatchObject({ coverUrl: "a.jpg", options: { blur: 56, dim: 0.22 } });
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
});
