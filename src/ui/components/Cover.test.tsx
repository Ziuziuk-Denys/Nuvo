import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Cover } from "./Cover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function draw(element: React.ReactElement): HTMLSpanElement {
  const host = document.createElement("div");
  act(() => createRoot(host).render(element));
  return host.firstElementChild as HTMLSpanElement;
}

describe("Cover", () => {
  it("is one plain tint box: rounded by its size, round only when asked", () => {
    const square = draw(<Cover src="https://example.com/a.jpg" size={48} />);
    expect(square.classList).toHaveLength(1);
    expect(square.style.borderRadius).not.toBe("50%");
    expect(square.hasAttribute("data-spinning")).toBe(false);
    expect(draw(<Cover src="https://example.com/a.jpg" size={48} shape="circle" />).style.borderRadius).toBe("50%");
  });
});
