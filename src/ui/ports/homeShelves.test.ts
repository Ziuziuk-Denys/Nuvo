import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  found: [
    { id: "a", title: "Ultimate Pop Hits Volume 22", artists: "Various", durationMs: 200_000 },
    { id: "b", title: "Easy On Me", artists: "Adele", durationMs: 224_000 },
    { id: "c", title: "Русские Хиты 2026", artists: "ZEHN MEE", durationMs: 180_000 },
    { id: "d", title: "Summer Mix", artists: "DJ", durationMs: 200_000 },
    { id: "e", title: "Rush", artists: "Ayra Starr", durationMs: 185_000 },
    { id: "f", title: "Live Set", artists: "Band", durationMs: 3_600_000 },
  ],
  cached: new Set(["c1", "c2", "c3", "s2"]), local: [{ id: `local:${"a".repeat(32)}`, title: "Mine" }] }));
vi.mock("@/engine", () => ({ catalog: () => ({ searchFiltered: async () => mocks.found }), player: () => ({}) }));
vi.mock("@/engine/adapters", () => ({ createContinuation: vi.fn() }));
vi.mock("@/engine/boot", () => ({ CORE_BASE_URL: "http://core" }));
vi.mock("@/data/core/request", () => ({ coreRequest: vi.fn() }));
vi.mock("@/data/library/client", () => ({ libraryClient: { playlists: async () => [] } }));
vi.mock("@/data/library/library", () => ({ library: () => ({ liked: { allTracks: async () => [{ id: "s1" }, { id: "s2" }] } }) }));
vi.mock("./catalog", () => ({ cachedTrackIds: async (ids: string[]) => new Set(ids.filter((id) => mocks.cached.has(id))) }));
vi.mock("./localFiles", () => ({ playableLocalTracks: async () => mocks.local }));

import { genreSongs, offlineMixes, offlineSongs } from "./homeShelves";

const mix = (id: string, ids: string[]) => ({ id, title: id, description: "", tracks: ids.map((trackId) => ({ id: trackId })) });

describe("offline Home material", () => {
  it("keeps cached and local songs of each mix and drops a mix with too few left", async () => {
    const local = mocks.local[0].id;
    const kept = await offlineMixes([mix("a", ["c1", "x1", "c2", local, "c3"]), mix("b", ["c1", "x2", "x3"])] as never);
    expect(kept.map((entry) => [entry.id, entry.tracks.map((track) => track.id)])).toEqual([["a", ["c1", "c2", local, "c3"]]]);
  });

  it("offers local files and the saved songs that are cached", async () => {
    expect((await offlineSongs()).map((track) => track.id)).toEqual([mocks.local[0].id, "s2"]);
  });

  it("leaves compilations and long mixes off a genre shelf", async () => {
    expect((await genreSongs("pop hits")).map((track) => track.id)).toEqual(["b", "e"]);
  });
});
