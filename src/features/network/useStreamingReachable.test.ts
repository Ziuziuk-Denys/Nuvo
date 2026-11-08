// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useStreamingReachable } from "./useStreamingReachable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const probe = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("./probe", () => ({ probeStreamingHosts: probe }));

describe("useStreamingReachable", () => {
  it("follows the probe and checks again when the system goes online", async () => {
    probe.mockResolvedValue(false);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useStreamingReachable());
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false);

    probe.mockResolvedValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(seen.at(-1)).toBe(true);
    act(() => root.unmount());
  });
});
