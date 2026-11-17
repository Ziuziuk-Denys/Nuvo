// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PercentField } from "./PercentField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const onCommit = vi.fn();

function type(text: string) {
  const input = host.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

beforeEach(() => {
  onCommit.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<PercentField value={0.5} min={0} max={2} label="Pulse" onCommit={onCommit} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("percent field", () => {
  it("shows the value as a share of the control's range", () => {
    expect(host.querySelector("input")!.value).toBe("25");
  });

  it("maps a typed percent back into the range on Enter and clamps it", () => {
    const input = type("150");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith(2);
    type("40");
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onCommit).toHaveBeenLastCalledWith(0.8);
  });

  it("drops letters and leaves the value alone on Escape", () => {
    const input = type("4a");
    expect(input.value).toBe("4");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("25");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
