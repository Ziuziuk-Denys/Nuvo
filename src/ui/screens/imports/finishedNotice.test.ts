import { describe, expect, it } from "vitest";
import type { ImportSummary } from "../../ports/imports";
import { finishedText, newlyFinished } from "./finishedNotice";

const summary = (id: string, status: ImportSummary["status"], needsReview = 0): ImportSummary => ({
  id,
  sourceKind: "spotify",
  label: "Road trip",
  targetKind: "playlist",
  createdAt: "",
  status,
  total: 20,
  done: 20,
  needsReview,
  counts: { exact: 15, likely: 2, check: needsReview, missing: 3 - needsReview, already: 0 },
});
const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);

describe("finished import notice", () => {
  it("names only imports that were running at the last look and are done now", () => {
    expect(newlyFinished(null, [summary("a", "done")])).toEqual([]);
    const seen = new Map<string, ImportSummary["status"]>([
      ["a", "running"],
      ["b", "done"],
      ["c", "running"],
    ]);
    expect(newlyFinished(seen, [summary("a", "done"), summary("b", "done"), summary("c", "running"), summary("d", "done")]).map((s) => s.id)).toEqual(["a"]);
  });

  it("says what was added and what needs a look", () => {
    expect(finishedText(summary("a", "done"), t).body).toMatch(/^Road trip: ui\.imports\.summary\.done\(\d+,20\)$/);
    expect(finishedText(summary("a", "done", 2), t)).toEqual({
      title: "ui.imports.finished",
      body: expect.stringContaining("· ui.imports.summary.review(2)"),
    });
  });
});
