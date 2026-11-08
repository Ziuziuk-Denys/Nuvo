import { describe, expect, it, vi } from "vitest";
import { CoreError } from "./core";
import { FakeDaemon } from "./fixtures/fakeDaemon";

vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog: {} }) }));

describe("reportFileName", () => {
  it("keeps the label readable and safe for a save dialog", async () => {
    const { reportFileName } = await import("./runtime");
    expect(reportFileName("Late drive")).toBe("Late drive report.csv");
    expect(reportFileName("a/b\\c:d\u0007")).toBe("a b c d report.csv");
    expect(reportFileName("   ")).toBe("import report.csv");
    expect(reportFileName("x".repeat(300))).toHaveLength(80 + " report.csv".length);
  });
});

const song = {
  id: "aaaaaaaaaaa",
  title: "Paper Moons",
  artists: [],
  durationMs: 1,
};

describe("resumeSavedSong", () => {
  it("adds a song saved before a restart and forgets it", async () => {
    const { createPendingStore, resumeSavedSong } = await import("./runtime");
    const daemon = new FakeDaemon();
    daemon.pending = { playlistId: "pl-1", track: song };
    await resumeSavedSong(daemon, createPendingStore(daemon));
    expect(daemon.addedToPlaylist).toEqual([{ playlistId: "pl-1", track: song }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(daemon.pending).toBeNull();
  });

  it("does nothing when no song waits", async () => {
    const { createPendingStore, resumeSavedSong } = await import("./runtime");
    const daemon = new FakeDaemon();
    await resumeSavedSong(daemon, createPendingStore(daemon));
    expect(daemon.addedToPlaylist).toEqual([]);
  });

  it("forgets a song whose playlist is gone instead of retrying at every start", async () => {
    const { createPendingStore, resumeSavedSong } = await import("./runtime");
    const daemon = new FakeDaemon();
    daemon.pending = { playlistId: "pl-gone", track: song };
    daemon.addToPlaylist = async () => {
      throw new CoreError(404, "NOT_FOUND");
    };
    await resumeSavedSong(daemon, createPendingStore(daemon), {
      sleep: async () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(daemon.pending).toBeNull();
  });

  it("keeps the song when the daemon keeps failing", async () => {
    const { createPendingStore, resumeSavedSong } = await import("./runtime");
    const daemon = new FakeDaemon();
    daemon.pending = { playlistId: "pl-1", track: song };
    daemon.addToPlaylist = async () => {
      throw new CoreError(0, "CORE_DOWN");
    };
    await resumeSavedSong(daemon, createPendingStore(daemon), {
      sleep: async () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(daemon.pending).toEqual({ playlistId: "pl-1", track: song });
  });
});

describe("createPendingStore", () => {
  it("keeps saves and clears in order even when the daemon answers slowly", async () => {
    const { createPendingStore } = await import("./runtime");
    const daemon = new FakeDaemon();
    const save = daemon.savePendingTrack.bind(daemon);
    daemon.savePendingTrack = async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await save(job);
    };
    const store = createPendingStore(daemon);
    store.save({ playlistId: "pl-1", track: song });
    store.clear();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(daemon.pending).toBeNull();
  });
});
