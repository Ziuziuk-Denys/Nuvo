import { describe, expect, it, vi, afterEach } from "vitest";

const subscribe = vi.fn(() => () => undefined);
vi.mock("@/engine", () => ({ soundBus: () => ({ subscribeSpectrum: subscribe }) }));

import { subscribeSpectrum } from "./sound";

afterEach(() => vi.clearAllMocks());

describe("sound port spectrum", () => {
  it("hands the listener to the sound bus and returns its unsubscribe", () => {
    const off = vi.fn();
    subscribe.mockReturnValueOnce(off);
    const listener = vi.fn();
    const result = subscribeSpectrum(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    result();
    expect(off).toHaveBeenCalledOnce();
  });
});
