/** "Import finished" as a system notification: the main process shows it only while the window is not focused. */
import { useEffect, useRef } from "react";
import type { TFunction } from "../../ports/i18n";
import { addedCount, type ImportSummary } from "../../ports/imports";

/** The imports that finished since the last look; the first look only remembers, so a restart announces nothing. */
export function newlyFinished(seen: Map<string, ImportSummary["status"]> | null, summaries: readonly ImportSummary[]): ImportSummary[] {
  if (!seen) return [];
  return summaries.filter((summary) => summary.status === "done" && seen.get(summary.id) === "running");
}

export function finishedText(summary: ImportSummary, t: TFunction): { title: string; body: string } {
  const counts = t("ui.imports.summary.done", { added: addedCount(summary), total: summary.total });
  const review = summary.needsReview > 0 ? ` · ${t("ui.imports.summary.review", { count: summary.needsReview })}` : "";
  return { title: t("ui.imports.finished"), body: `${summary.label ? `${summary.label}: ` : ""}${counts}${review}` };
}

export function useFinishedNotice(summaries: readonly ImportSummary[], t: TFunction): void {
  const seen = useRef<Map<string, ImportSummary["status"]> | null>(null);
  useEffect(() => {
    for (const summary of newlyFinished(seen.current, summaries)) {
      const { title, body } = finishedText(summary, t);
      void window.nuvoShell?.notify(title, body).catch(() => false);
    }
    seen.current = new Map(summaries.map((summary) => [summary.id, summary.status]));
  }, [summaries, t]);
}
