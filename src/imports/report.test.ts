import { describe, expect, it } from "vitest";
import { reportRow, summary } from "./fixtures/fakeDaemon";
import { formatDuration, importsPercent, pickChoices, progressByPlaylist, reasonMessage, rowActions, summaryMessage } from "./report";
import type { CatalogTrack } from "./types";

const track = (id: string): CatalogTrack => ({
  id,
  title: "Paper Moons",
  artists: [{ id: "UC1", name: "Mira Holt" }],
  durationMs: 201_000,
});

describe("reasonMessage", () => {
  it("is null while a row is still being matched", () => {
    expect(reasonMessage(reportRow(1))).toBeNull();
  });

  it("names the reason in plain words", () => {
    expect(reasonMessage(reportRow(1, { label: "exact", reason: "exact" }))).toEqual({ key: "ui.imports.reason.exact" });
    expect(reasonMessage(reportRow(1, { label: "already", reason: "already_there" }))).toEqual({ key: "ui.imports.reason.already" });
    expect(
      reasonMessage(
        reportRow(1, {
          label: "likely",
          reason: "matched",
          durationDiffMs: 1_000,
        }),
      ),
    ).toEqual({ key: "ui.imports.reason.matched" });
    expect(reasonMessage(reportRow(1, { label: "check", reason: "matched" }))).toEqual({ key: "ui.imports.reason.check" });
    expect(reasonMessage(reportRow(1, { label: "missing", reason: "ambiguous_match" }))).toEqual({ key: "ui.imports.reason.ambiguous" });
    expect(reasonMessage(reportRow(1, { label: "missing", reason: "low_confidence_match" }))).toEqual({ key: "ui.imports.reason.low_confidence" });
    expect(reasonMessage(reportRow(1, { label: "missing", reason: "no_catalog_candidates" }))).toEqual({ key: "ui.imports.reason.not_found" });
    expect(reasonMessage(reportRow(1, { label: "missing", reason: "catalog_lookup_failed" }))).toEqual({ key: "ui.imports.reason.search_failed" });
  });

  it("says how much the length differs, or that the file had no length", () => {
    expect(
      reasonMessage(
        reportRow(1, {
          label: "missing",
          reason: "duration_mismatch",
          durationDiffMs: -21_400,
        }),
      ),
    ).toEqual({
      key: "ui.imports.reason.length_differs",
      vars: { seconds: 21 },
    });
    expect(
      reasonMessage(
        reportRow(1, {
          label: "check",
          reason: "matched",
          durationDiffMs: 9_000,
        }),
      ),
    ).toEqual({
      key: "ui.imports.reason.length_differs",
      vars: { seconds: 9 },
    });
    expect(reasonMessage(reportRow(1, { label: "missing", reason: "duration_mismatch" }))).toEqual({ key: "ui.imports.reason.length_unknown" });
  });

  it("shows a decision over the label", () => {
    expect(reasonMessage(reportRow(1, { label: "check", decision: "keep" }))).toEqual({ key: "ui.imports.decision.kept" });
    expect(reasonMessage(reportRow(1, { label: "likely", decision: "remove" }))).toEqual({ key: "ui.imports.decision.removed" });
    expect(reasonMessage(reportRow(1, { label: "missing", decision: "use" }))).toEqual({ key: "ui.imports.decision.added" });
  });
});

describe("rowActions", () => {
  it("offers Use only for a Missing row with a proposal", () => {
    expect(
      rowActions(
        reportRow(1, {
          label: "missing",
          track: track("a"),
          candidates: [track("a")],
        }),
      ),
    ).toEqual(["use"]);
    expect(rowActions(reportRow(1, { label: "missing", candidates: [] }))).toEqual([]);
    expect(rowActions(reportRow(1, { label: "missing", candidates: [track("b")] }))).toEqual(["pick"]);
  });

  it("offers Keep and Remove on an undecided Check row", () => {
    expect(
      rowActions(
        reportRow(1, {
          label: "check",
          track: track("a"),
          candidates: [track("a"), track("b")],
        }),
      ),
    ).toEqual(["keep", "remove", "pick"]);
    expect(
      rowActions(
        reportRow(1, {
          label: "check",
          decision: "keep",
          track: track("a"),
          candidates: [track("a")],
        }),
      ),
    ).toEqual(["remove"]);
  });

  it("lets a removed row be picked again and offers nothing on Already rows", () => {
    expect(
      rowActions(
        reportRow(1, {
          label: "likely",
          decision: "remove",
          track: track("a"),
          candidates: [track("a"), track("b")],
        }),
      ),
    ).toEqual(["pick"]);
    expect(
      rowActions(
        reportRow(1, {
          label: "already",
          track: track("a"),
          candidates: [track("b")],
        }),
      ),
    ).toEqual([]);
    expect(rowActions(reportRow(1, { label: "exact", track: track("a"), candidates: [] }))).toEqual(["remove"]);
  });

  it("never offers the current match as another pick", () => {
    expect(
      pickChoices(
        reportRow(1, {
          label: "likely",
          track: track("a"),
          candidates: [track("a"), track("b")],
        }),
      ).map((c) => c.id),
    ).toEqual(["b"]);
  });
});

describe("summaryMessage", () => {
  it("reads running, review and done", () => {
    expect(summaryMessage(summary("i", { total: 3700, done: 340 }))).toEqual({
      key: "ui.imports.summary.running",
      vars: { done: 340, total: 3700 },
    });
    expect(summaryMessage(summary("i", { status: "done", needsReview: 4 }))).toEqual({ key: "ui.imports.summary.review", vars: { count: 4 } });
    expect(
      summaryMessage(
        summary("i", {
          status: "done",
          total: 10,
          counts: { exact: 2, likely: 5, check: 1, missing: 1, already: 1 },
        }),
      ),
    ).toEqual({
      key: "ui.imports.summary.done",
      vars: { added: 8, total: 10, count: 10 },
    });
  });

  it("formats durations", () => {
    expect(formatDuration(201_000)).toBe("3:21");
    expect(formatDuration(59_600)).toBe("1:00");
  });
});

describe("progressByPlaylist", () => {
  it("adds up running imports per target playlist and skips finished ones", () => {
    const progress = progressByPlaylist([
      summary("a", { targetId: "p1", done: 10, total: 100 }),
      summary("b", { targetId: "p1", done: 5, total: 20 }),
      summary("c", { targetId: "p2", status: "done", done: 3, total: 3 }),
      summary("d", { targetKind: "liked", targetId: undefined }),
    ]);
    expect([...progress]).toEqual([["p1", { done: 15, total: 120 }]]);
  });
});

describe("importsPercent", () => {
  it("is null with nothing running and adds up every running import, Liked songs included", () => {
    expect(importsPercent([summary("a", { status: "done", done: 3, total: 3 })])).toBeNull();
    expect(importsPercent([summary("a", { targetId: "p1", done: 10, total: 100 }), summary("b", { targetKind: "liked", done: 5, total: 20 })])).toBe(12);
    expect(importsPercent([summary("a", { done: 0, total: 0 })])).toBe(0);
  });
});
