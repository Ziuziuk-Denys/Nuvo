import { describe, expect, it, vi } from "vitest";
import { FakeDaemon, summary } from "./fixtures/fakeDaemon";
import { CoreError } from "./core";
import { createImportsSession, resumeWhenReady } from "./session";
import type { CatalogTrack, ImportNext, ImportSummary } from "./types";

const track: CatalogTrack = {
  id: "aaaaaaaaaaa",
  title: "Paper Moons",
  artists: [],
  durationMs: 1,
};
const search = (rowId: number): ImportNext => ({
  rowId,
  search: { query: "q", filter: "songs", source: "youtube", step: 0 },
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createImportsSession", () => {
  it("shows new imports newest first and runs workers only for running ones", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("old", [search(1)]);
    const session = createImportsSession(daemon, { youtube: async () => [track], soundcloud: async () => [] }, { sleep: async () => {} });
    const listener = vi.fn();
    session.subscribe(listener);
    session.started([summary("old", { createdAt: "2026-10-30T10:00:00Z" }), summary("new", { createdAt: "2026-10-31T10:00:00Z", status: "done" })]);
    expect(session.getSnapshot().map((s) => s.id)).toEqual(["new", "old"]);
    expect(listener).toHaveBeenCalled();
    await flush();
    expect(daemon.posted.map((p) => p.id)).toEqual(["old"]);
  });

  it("resumes running imports after a restart", async () => {
    const daemon = new FakeDaemon();
    daemon.summaries.set("a", summary("a"));
    daemon.summaries.set("b", summary("b", { status: "done" }));
    daemon.script.set("a", [search(7)]);
    const session = createImportsSession(daemon, { youtube: async () => [track], soundcloud: async () => [] }, { sleep: async () => {} });
    await session.resume();
    await flush();
    expect(session.getSnapshot()).toHaveLength(2);
    expect(daemon.posted).toEqual([{ id: "a", rowId: 7, step: 0, candidates: [track] }]);
  });

  it("refreshes a summary at most once a second while rows arrive, and once when workers stop", async () => {
    const daemon = new FakeDaemon();
    daemon.summaries.set("a", summary("a"));
    daemon.script.set("a", [search(1), search(2), search(3)]);
    const summarySpy = vi.spyOn(daemon, "summary");
    const session = createImportsSession(daemon, { youtube: async () => [track], soundcloud: async () => [] }, { sleep: async () => {}, now: () => 5_000 });
    session.started([summary("a")]);
    await flush();
    await flush();
    expect(summarySpy).toHaveBeenCalledTimes(2);
  });

  it("tells the library when an import starts and whenever its rows move, not on an unchanged refresh", async () => {
    const daemon = new FakeDaemon();
    const onLibraryChange = vi.fn();
    const session = createImportsSession(daemon, { youtube: async () => [], soundcloud: async () => [] }, { sleep: async () => {}, onLibraryChange });
    session.started([summary("a", { status: "done", done: 1 })]);
    expect(onLibraryChange).toHaveBeenCalledTimes(1);
    daemon.summaries.set("a", summary("a", { status: "done", done: 1 }));
    await session.refresh("a");
    expect(onLibraryChange).toHaveBeenCalledTimes(1);
    daemon.summaries.set("a", summary("a", { status: "done", done: 2 }));
    await session.refresh("a");
    expect(onLibraryChange).toHaveBeenCalledTimes(2);
  });

  it("dismisses an import: workers stop, the daemon forgets it", async () => {
    const daemon = new FakeDaemon();
    const session = createImportsSession(daemon, { youtube: async () => [], soundcloud: async () => [] }, { sleep: async () => {} });
    session.started([summary("a", { status: "done" })]);
    await session.dismiss("a");
    expect(daemon.removed).toEqual(["a"]);
    expect(session.getSnapshot()).toEqual([]);
  });

  it("ignores a slow refresh that answers after a newer one or after a dismissal", async () => {
    const daemon = new FakeDaemon();
    const answers: ((s: ImportSummary) => void)[] = [];
    daemon.summary = () => new Promise<ImportSummary>((resolve) => answers.push(resolve));
    const session = createImportsSession(daemon, { youtube: async () => [], soundcloud: async () => [] }, { sleep: async () => {} });
    session.started([summary("a", { status: "done" })]);
    const first = session.refresh("a");
    const second = session.refresh("a");
    answers[1](summary("a", { status: "done", done: 3 }));
    await second;
    answers[0](summary("a", { status: "running", done: 1 }));
    await first;
    expect(session.getSnapshot()[0]).toMatchObject({ status: "done", done: 3 });

    const late = session.refresh("a");
    await session.dismiss("a");
    answers[2](summary("a", { status: "done" }));
    await late;
    expect(session.getSnapshot()).toEqual([]);
  });

  it("asks a locked daemon again every 10 s until it answers", async () => {
    const resume = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new CoreError(423, "LOCKED"))
      .mockRejectedValueOnce(new CoreError(503, "CORE_STARTING"))
      .mockResolvedValueOnce(undefined);
    const waits: number[] = [];
    await resumeWhenReady({ resume }, async (ms) => void waits.push(ms), new AbortController().signal);
    expect(resume).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([10_000, 10_000]);
  });
});
