import { describe, expect, it, vi } from "vitest";
import { createListeners } from "./listeners";

describe("createListeners", () => {
  it("calls every subscriber with the arguments until it unsubscribes", () => {
    const bus = createListeners<[number]>();
    const first = vi.fn();
    const second = vi.fn();
    const off = bus.subscribe(first);
    bus.subscribe(second);
    bus.emit(1);
    off();
    bus.emit(2);
    expect(first.mock.calls).toEqual([[1]]);
    expect(second.mock.calls).toEqual([[1], [2]]);
  });

  it("lets a subscriber leave while the emit is running", () => {
    const bus = createListeners();
    const later = vi.fn();
    const off = bus.subscribe(() => off());
    bus.subscribe(later);
    bus.emit();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
