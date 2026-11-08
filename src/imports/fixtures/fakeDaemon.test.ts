import { describe, expect, it } from "vitest";
import { CoreError } from "../core";
import type { CatalogTrack } from "../types";
import { FakeDaemon } from "./fakeDaemon";

const track = (id: string): CatalogTrack => ({
  id,
  title: "Paper Moons",
  artists: [],
  durationMs: 1,
});
const rejects = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CoreError);
  expect((error as CoreError).status).toBe(status);
};
const body = (patch: object = {}) => ({
  source: "deezer" as const,
  label: "Northbound",
  rows: [{ title: "a", artists: [] }],
  ...patch,
});

describe("FakeDaemon is as strict as the daemon", () => {
  it("validates what start receives", async () => {
    const daemon = new FakeDaemon();
    await rejects(daemon.start(body({ label: "  " })), 400);
    await rejects(daemon.start(body({ source: "napster" as never })), 400);
    await rejects(
      daemon.start(
        body({
          rows: Array.from({ length: 20_001 }, () => ({
            title: "a",
            artists: [],
          })),
        }),
      ),
      400,
    );
    await rejects(daemon.start(body({ target: { kind: "playlist" } })), 400);
    await daemon.start(body());
    await daemon.start({ file: { name: "likes.csv", data: "YSxi" } });
  });

  it("checks the step and the candidates of a posted answer", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [
      {
        rowId: 1,
        search: { query: "q", filter: "songs", source: "youtube", step: 0 },
      },
    ]);
    await rejects(daemon.postCandidates("i1", 9, { step: 0, candidates: [] }), 404);
    await daemon.next("i1");
    await rejects(daemon.postCandidates("i1", 1, { step: 1, candidates: [] }), 409);
    await rejects(
      daemon.postCandidates("i1", 1, {
        step: 0,
        candidates: Array.from({ length: 101 }, (_, i) => track(`t${i}`)),
      }),
      400,
    );
    await rejects(daemon.postCandidates("i1", 1, { step: 0, candidates: [track("")] }), 400);
    await daemon.postCandidates("i1", 1, { step: 0, candidates: [track("a")] });
    await rejects(daemon.postCandidates("i1", 1, { step: 0, candidates: [] }), 409);
  });

  it("validates decisions and bulk actions", async () => {
    const daemon = new FakeDaemon();
    await rejects(daemon.decide("i1", 1, "maybe" as never), 400);
    await rejects(daemon.decide("i1", 1, "pick"), 400);
    await rejects(daemon.decide("i1", 1, "pick", track("")), 400);
    await rejects(daemon.bulk("i1", "everything" as never), 400);
    await daemon.decide("i1", 1, "pick", track("a"));
    await daemon.decide("i1", 1, "keep");
    await daemon.bulk("i1", "accept-check");
    expect(daemon.decisions).toHaveLength(2);
    expect(daemon.bulks).toHaveLength(1);
  });
});
