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
vi.mock("@/engine/compat", () => ({ playerEngine: { startRadioStation: mocks.radio } }));
vi.mock("./recs", () => ({ recs: {}, recsChanged: mocks.changed, seedFavorites: mocks.seed }));

import { startFromPicks } from "./starters";

const emit = (view: { context: string | null; entries: unknown[] }) => {
  mocks.view = view;
  for (const listener of mocks.listeners) listener(view);
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
});

const artist = [{ kind: "artist" as const, id: "a1", title: "A" }];

describe("startFromPicks", () => {
  it("starts the station from the first seed, a picked song as well as an artist's top song", async () => {
    mocks.seed.mockResolvedValue([{ id: "s9" }, { id: "s1" }]);
    const picks = [
      { kind: "song" as const, id: "s9", title: "Teardrop" },
      { kind: "artist" as const, id: "a1", title: "A" },
    ];
    expect(await startFromPicks(picks)).toBe(true);
    expect(mocks.seed).toHaveBeenCalledWith(picks);
    expect(mocks.radio).toHaveBeenCalledWith({ id: "s9" });
  });

  it("says no and starts nothing when the seeds could not be saved", async () => {
    mocks.seed.mockRejectedValue(new Error("down"));
    expect(await startFromPicks(artist)).toBe(false);
    expect(mocks.radio).not.toHaveBeenCalled();
  });

  it("tells Home to ask again once the new station's first refill landed, then stops listening", async () => {
    mocks.seed.mockResolvedValue([{ id: "s1" }]);
    mocks.view = { context: "mix:old", entries: [1, 2, 3] };
    mocks.radio.mockImplementation(() => {
      mocks.view = { context: "radio:s1", entries: [1] };
    });
    const changed = vi.fn();
    mocks.changed.addEventListener("change", changed);

    expect(await startFromPicks(artist)).toBe(true);
    await Promise.resolve();
    emit({ context: "radio:s1", entries: [1] });
    expect(changed).not.toHaveBeenCalled();
    emit({ context: "radio:s1", entries: [1, 2, 3] });
    expect(changed).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);
    mocks.changed.removeEventListener("change", changed);
  });

  it("does not wait on a station that never started", async () => {
    mocks.seed.mockResolvedValue([{ id: "s1" }]);
    mocks.view = { context: "mix:old", entries: [1, 2, 3] };
    mocks.radio.mockImplementation(() => undefined);
    expect(await startFromPicks(artist)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.listeners.size).toBe(0);
  });
});
