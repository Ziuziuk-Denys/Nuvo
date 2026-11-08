// @vitest-environment node
import { describe, expect, it } from "vitest";
import en from "../../../i18n/locales/en.json";
import ru from "../../../i18n/locales/ru.json";
import { errorMessage, noticeMessage } from "../../../imports/messages";
import { reasonMessage, summaryMessage } from "../../../imports/report";
import { ImportError, type ImportErrorCode, type ImportSummary, type ReportRow } from "../../../imports/types";

const CODES: ImportErrorCode[] = [
  "not_a_link",
  "unsupported_host",
  "bad_link",
  "spotify_file_only",
  "yandex_lists",
  "login_required",
  "missing_name",
  "bad_file",
  "empty",
  "gone",
  "source_changed",
  "network",
  "locked",
  "daemon",
];

const track = { id: "a", title: "T", artists: [], durationMs: 1000 };
const REASONS = [undefined, "duration_mismatch", "low_confidence_match", "ambiguous_match", "no_catalog_candidates", "catalog_lookup_failed", "matched"];

function rows(): ReportRow[] {
  const out: ReportRow[] = [];
  for (const label of ["exact", "likely", "check", "missing", "already"] as const)
    for (const reason of REASONS)
      for (const decision of [undefined, "use", "pick", "keep", "remove"] as const)
        for (const diff of [undefined, 30_000])
          for (const sourceMs of [undefined, 200_000])
            out.push({
              id: 1,
              position: 0,
              source: { title: "S", artists: [], durationMs: sourceMs },
              label,
              reason,
              decision,
              durationDiffMs: diff,
              track,
              candidates: [track],
            } as ReportRow);
  return out;
}

function summaries(): ImportSummary[] {
  const base = {
    id: "i",
    sourceKind: "spotify-csv",
    label: "L",
    targetKind: "playlist",
    createdAt: "2026-10-31T10:00:00Z",
    total: 3,
    done: 3,
    counts: { exact: 1, likely: 0, check: 0, missing: 0, already: 0 },
  };
  return [
    { ...base, status: "running", needsReview: 0 },
    { ...base, status: "done", needsReview: 2 },
    { ...base, status: "done", needsReview: 0 },
  ] as ImportSummary[];
}

/** A key as the translator resolves it: plain, or with a plural form. */
function resolves(dict: unknown, key: string, plural: string[]): boolean {
  const find = (k: string) => {
    let node: unknown = dict;
    for (const part of k.split(".")) {
      if (typeof node !== "object" || node === null || !(part in node)) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : undefined;
  };
  return find(key) !== undefined || plural.every((f) => find(key + f));
}

describe("keys the import modules emit", () => {
  it("exist in English and Russian", () => {
    const keys = new Set<string>();
    for (const code of CODES) keys.add(errorMessage(new ImportError(code, "h")).key);
    keys.add(errorMessage(new Error("x")).key);
    keys.add(noticeMessage({ kind: "partial", shown: 1, total: 2 }, "apple-music").key);
    keys.add(noticeMessage({ kind: "partial", shown: 1 }, "spotify").key);
    keys.add(noticeMessage({ kind: "capped", kept: 1 }, "deezer").key);
    for (const row of rows()) {
      const m = reasonMessage(row);
      if (m) keys.add(m.key);
    }
    for (const s of summaries()) keys.add(summaryMessage(s).key);
    expect(keys.size).toBeGreaterThan(20);
    const missing = [...keys].flatMap((key) => [
      ...(resolves(en, key, ["_one", "_other"]) ? [] : [`en ${key}`]),
      ...(resolves(ru, key, ["_one", "_few", "_many", "_other"]) ? [] : [`ru ${key}`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("read calmly: no exclamation marks, and the honesty line promises nothing", () => {
    const texts: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === "string") texts.push(node);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(en.ui.imports);
    walk(ru.ui.imports);
    expect(texts.filter((s) => s.includes("!"))).toEqual([]);
    expect(en.ui.imports.honesty).toContain("Nothing is guaranteed");
  });
});
