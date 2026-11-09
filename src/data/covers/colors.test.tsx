// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createCoverColors, DEFAULT_COVER_COLORS, pickCoverColors, type CoverColors } from "./colors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pixels(...runs: Array<[count: number, rgba: [number, number, number, number]]>): Uint8ClampedArray {
  return new Uint8ClampedArray(runs.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat()));
}

afterEach(() => vi.useRealTimers());

describe("pickCoverColors", () => {
  it("gives a single hue and a darker copy of it", () => {
    expect(pickCoverColors(pixels([4, [255, 0, 0, 255]]))).toEqual({ color2: "rgb(255, 0, 0)", color1: "rgb(115, 0, 0)" });
  });

  it("takes the strongest hue first and a distant second one, darkened", () => {
    expect(pickCoverColors(pixels([3, [0, 0, 255, 255]], [1, [255, 128, 0, 255]]))).toEqual({ color2: "rgb(0, 0, 255)", color1: "rgb(153, 77, 0)" });
  });

  it("ignores a second hue with almost no presence", () => {
    expect(pickCoverColors(pixels([10, [0, 0, 255, 255]], [1, [255, 128, 0, 255]]))).toEqual({ color2: "rgb(0, 0, 255)", color1: "rgb(0, 0, 115)" });
  });

  it("uses the average for a grey cover and gives null for a transparent one", () => {
    expect(pickCoverColors(pixels([4, [128, 128, 128, 255]]))).toEqual({ color2: "rgb(128, 128, 128)", color1: "rgb(64, 64, 64)" });
    expect(pickCoverColors(pixels([4, [255, 0, 0, 0]]))).toBeNull();
  });
});

describe("createCoverColors", () => {
  it("reads one cover once even when asked twice at the same time", async () => {
    const read = vi.fn(async () => pixels([4, [255, 0, 0, 255]]));
    const { colorsFor } = createCoverColors(read);
    const [a, b] = await Promise.all([colorsFor("u1"), colorsFor("u1")]);
    expect(a).toEqual(b);
    expect(read).toHaveBeenCalledTimes(1);
    await colorsFor("u1");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries once after 250 ms, and forgets a failure so the next request reads again (covers 3.6)", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<(url: string) => Promise<Uint8ClampedArray>>()
      .mockRejectedValueOnce(new Error("tainted"))
      .mockResolvedValueOnce(pixels([4, [0, 0, 255, 255]]));
    const { colorsFor } = createCoverColors(read);
    const first = colorsFor("u2");
    await vi.advanceTimersByTimeAsync(250);
    expect((await first).color2).toBe("rgb(0, 0, 255)");
    expect(read).toHaveBeenCalledTimes(2);

    read.mockRejectedValue(new Error("offline"));
    const failed = colorsFor("u3");
    await vi.advanceTimersByTimeAsync(250);
    expect(await failed).toEqual(DEFAULT_COVER_COLORS);
    read.mockResolvedValue(pixels([4, [255, 0, 0, 255]]));
    expect((await colorsFor("u3")).color2).toBe("rgb(255, 0, 0)");
  });

  it("gives up on a stuck cover after 3 s so the request is not pinned, and reads again next time", async () => {
    vi.useFakeTimers();
    const read = vi.fn<(url: string) => Promise<Uint8ClampedArray>>().mockReturnValueOnce(new Promise(() => {}));
    const { colorsFor } = createCoverColors(read);
    const stuck = colorsFor("u5");
    const again = colorsFor("u5");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await stuck).toEqual(DEFAULT_COVER_COLORS);
    expect(await again).toEqual(DEFAULT_COVER_COLORS);
    read.mockResolvedValue(pixels([4, [255, 0, 0, 255]]));
    expect((await colorsFor("u5")).color2).toBe("rgb(255, 0, 0)");
  });

  it("evicts the least recently used cover, not the oldest one", async () => {
    const read = vi.fn(async () => pixels([4, [255, 0, 0, 255]]));
    const { colorsFor } = createCoverColors(read);
    for (let i = 0; i < 100; i += 1) await colorsFor(`c${i}`);
    await colorsFor("c0");
    await colorsFor("c100");
    expect(read).toHaveBeenCalledTimes(101);
    await colorsFor("c0");
    expect(read).toHaveBeenCalledTimes(101);
    await colorsFor("c1");
    expect(read).toHaveBeenCalledTimes(102);
  });

  it("shows the defaults until the colours are read", async () => {
    let finish!: (value: Uint8ClampedArray) => void;
    const { useCoverColors } = createCoverColors(() => new Promise<Uint8ClampedArray>((resolve) => (finish = resolve)));
    const seen: { colors: CoverColors | null } = { colors: null };
    function Probe({ url }: { url?: string }) {
      seen.colors = useCoverColors(url);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe url="u4" />));
    expect(seen.colors).toEqual(DEFAULT_COVER_COLORS);
    await act(async () => finish(pixels([4, [255, 0, 0, 255]])));
    expect(seen.colors?.color2).toBe("rgb(255, 0, 0)");
    act(() => root.render(<Probe />));
    expect(seen.colors).toEqual(DEFAULT_COVER_COLORS);
    act(() => root.unmount());
  });
});
