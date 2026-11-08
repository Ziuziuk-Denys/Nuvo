import { describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<(view: unknown) => void>();
  return {
    listeners,
    view: { context: null as string | null, entries: [] as unknown[] },
    seed: vi.fn(),
    radio: vi.fn(),
    changed: new EventTarget(),
  };
});
vi.mock("@/engine", () => ({
  player: () => ({
    getView: () => mocks.view,
    subscribe: (listener: (view: unknown) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  }),
}));
vi.mock("@/engine/poolRefresher", () => ({ POOL_KEY: "pool" }));
vi.mock("./catalog", () => ({ startArtistRadio: mocks.radio }));
vi.mock("./recs", () => ({ recs: {}, recsChanged: mocks.changed, seedFavorites: mocks.seed }));

import { startFromArtists } from "./starters";

const emit = (view: { context: string | null; entries: unknown[] }) => {
  mocks.view = view;
  for (const listener of mocks.listeners) listener(view);
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
});

describe("startFromArtists", () => {
  it("tells Home to ask again once the new station's first refill landed, then stops listening", async () => {
    mocks.seed.mockResolvedValue(undefined);
    mocks.view = { context: "mix:old", entries: [1, 2, 3] };
    mocks.radio.mockImplementation(async () => {
      mocks.view = { context: "radio:s1", entries: [1] };
    });
    const changed = vi.fn();
    mocks.changed.addEventListener("change", changed);

    expect(await startFromArtists(["a1"])).toBe(true);
    await Promise.resolve();
    emit({ context: "radio:s1", entries: [1] });
    expect(changed).not.toHaveBeenCalled();
    emit({ context: "radio:s1", entries: [1, 2, 3] });
    expect(changed).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);
    mocks.changed.removeEventListener("change", changed);
  });

  it("does not wait on a station that never started", async () => {
    mocks.seed.mockResolvedValue(undefined);
    mocks.radio.mockRejectedValue(new Error("offline"));
    expect(await startFromArtists(["a1"])).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.listeners.size).toBe(0);
  });
});
