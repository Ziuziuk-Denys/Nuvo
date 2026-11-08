// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { pushLayer } from "./layers";

const guard = vi.hoisted(() => ({ held: false }));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => guard.held }));

const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("pushLayer", () => {
  it("sends Escape to the top layer only, then to the one below once it is removed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = pushLayer(first);
    const removeSecond = pushLayer(second);

    escape();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    removeSecond();
    escape();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    removeFirst();
    escape();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onEscape = vi.fn();
    const remove = pushLayer(onEscape);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onEscape).not.toHaveBeenCalled();
    remove();
  });

  it("calls nothing while an escape guard is held", () => {
    const onEscape = vi.fn();
    const remove = pushLayer(onEscape);
    guard.held = true;
    escape();
    expect(onEscape).not.toHaveBeenCalled();
    guard.held = false;
    escape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    remove();
  });
});
