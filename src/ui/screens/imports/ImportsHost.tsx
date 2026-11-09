import { useMemo, useState, useSyncExternalStore, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import type { ImportSummary } from "../../ports/imports";
import { getImports, watchPendingTrack } from "../../ports/importsRuntime";
import { ImportReport, type ReportPorts } from "./ImportReport";
import { ImportSheet } from "./ImportSheet";
import { useImportsUi } from "./importsUi";
import { useFinishedNotice } from "./finishedNotice";

export function ImportsHost(): JSX.Element {
  const { t } = useTranslation();
  const runtime = getImports();
  const { sheet, reportId, openReport, close } = useImportsUi();
  const summaries = useSyncExternalStore(runtime.session.subscribe, runtime.session.getSnapshot);
  const report = reportId ? summaries.find((s) => s.id === reportId) : undefined;
  useFinishedNotice(summaries, t);
  const [note, setNote] = useState<string | null>(null);

  const reportPorts = useMemo<ReportPorts>(() => {
    const { daemon, session, saveReport, searchSongs } = runtime;
    return {
      rows: (id, filter, cursor) => daemon.rows(id, filter, cursor),
      decide: (id, rowId, decision, track) => daemon.decide(id, rowId, decision, track),
      bulk: (id, action) => daemon.bulk(id, action),
      search: searchSongs,
      refresh: (id) => session.refresh(id),
      dismiss: (id) => session.dismiss(id),
      ...(saveReport && report ? { saveCsv: () => saveReport(report) } : {}),
    };
  }, [runtime, report]);

  const onStarted = (started: ImportSummary[]) => {
    setNote(null);
    const track = sheet?.pendingTrack;
    if (!track) return;
    const pending = watchPendingTrack(
      track,
      {
        addToPlaylist: (playlistId, song) => runtime.daemon.addToPlaylist(playlistId, song),
        added: (title) => setNote(t("ui.imports.pending_added", { title })),
        failed: () => setNote(t("ui.imports.pending_failed")),
      },
      { store: runtime.pendingStore },
    );
    // the daemon creates the new playlist with the import, so the first summary names it
    if (started[0]) pending.summary(started[0]);
    else pending.dropped();
  };

  return (
    <>
      <ImportSheet
        key={sheet ? (sheet.initialLink ?? "sheet") : "closed"}
        open={sheet !== null}
        onClose={close}
        actions={runtime.actions}
        initialLink={sheet?.initialLink}
        initialMode={sheet?.mode}
        target={sheet?.pendingTrack ? { kind: "new" } : sheet?.target}
        onStarted={onStarted}
        note={note}
        onOpenReport={openReport}
      />
      {report ? <ImportReport key={report.id} open onClose={close} summary={report} ports={reportPorts} /> : null}
    </>
  );
}
