import type { ImportSummary, ReportRow, RowsFilter } from "./types";

export interface Message {
  key: string;
  vars?: Record<string, string | number>;
}

export type RowAction = "use" | "keep" | "remove" | "pick";

export const REPORT_CHIPS: RowsFilter[] = ["review", "matched", "all"];

const DIFF_WORTH_MS = 3_000;

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function reasonMessage(row: ReportRow): Message | null {
  if (!row.label) return null;
  if (row.decision === "remove") return { key: "ui.imports.decision.removed" };
  if (row.decision === "use" || row.decision === "pick") return { key: "ui.imports.decision.added" };
  if (row.decision === "keep") return { key: "ui.imports.decision.kept" };
  if (row.label === "exact") return { key: "ui.imports.reason.exact" };
  if (row.label === "already") return { key: "ui.imports.reason.already" };
  const diff = row.durationDiffMs !== undefined ? Math.abs(row.durationDiffMs) : undefined;
  if (row.reason === "duration_mismatch" || (diff !== undefined && diff >= DIFF_WORTH_MS && row.label !== "likely")) {
    if (diff !== undefined)
      return {
        key: "ui.imports.reason.length_differs",
        vars: { seconds: Math.round(diff / 1000) },
      };
    if (!row.source.durationMs) return { key: "ui.imports.reason.length_unknown" };
    return { key: "ui.imports.reason.length_differs_plain" };
  }
  switch (row.reason) {
    case "low_confidence_match":
      return { key: "ui.imports.reason.low_confidence" };
    case "ambiguous_match":
      return { key: "ui.imports.reason.ambiguous" };
    case "no_catalog_candidates":
      return { key: "ui.imports.reason.not_found" };
    case "catalog_lookup_failed":
      return { key: "ui.imports.reason.search_failed" };
    default:
      return {
        key: row.label === "check" ? "ui.imports.reason.check" : "ui.imports.reason.matched",
      };
  }
}

export function rowActions(row: ReportRow): RowAction[] {
  if (!row.label || row.label === "already") return [];
  const others = row.candidates.some((c) => c.id !== row.track?.id);
  const pick: RowAction[] = others ? ["pick"] : [];
  if (row.decision === "remove") return pick;
  if (row.label === "missing" && !row.decision) return [...(row.track ? (["use"] as RowAction[]) : []), ...pick];
  if (row.label === "check" && !row.decision) return ["keep", "remove", ...pick];
  return ["remove", ...pick];
}

export function pickChoices(row: ReportRow) {
  return row.candidates.filter((c) => c.id !== row.track?.id);
}

export function addedCount(summary: ImportSummary): number {
  const { exact, likely, check } = summary.counts;
  return exact + likely + check;
}

export function summaryMessage(summary: ImportSummary): Message {
  if (summary.status === "running")
    return {
      key: "ui.imports.summary.running",
      vars: { done: summary.done, total: summary.total },
    };
  if (summary.needsReview > 0)
    return {
      key: "ui.imports.summary.review",
      vars: { count: summary.needsReview },
    };
  return {
    key: "ui.imports.summary.done",
    vars: { added: addedCount(summary), total: summary.total, count: summary.total },
  };
}

export function progressByPlaylist(summaries: readonly ImportSummary[]): Map<string, { done: number; total: number }> {
  const progress = new Map<string, { done: number; total: number }>();
  for (const summary of summaries) {
    if (summary.status !== "running" || !summary.targetId) continue;
    const seen = progress.get(summary.targetId) ?? { done: 0, total: 0 };
    progress.set(summary.targetId, {
      done: seen.done + summary.done,
      total: seen.total + summary.total,
    });
  }
  return progress;
}

export function importsPercent(summaries: readonly ImportSummary[]): number | null {
  const running = summaries.filter((summary) => summary.status === "running");
  if (running.length === 0) return null;
  const total = running.reduce((sum, summary) => sum + summary.total, 0);
  const done = running.reduce((sum, summary) => sum + summary.done, 0);
  return total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0;
}
