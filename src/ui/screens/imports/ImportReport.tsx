import { useEffect, useEffectEvent, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Sheet, type SheetAction } from "../../components/Sheet";
import { TextField } from "../../components/TextField";
import { useTranslation } from "../../ports/i18n";
import {
  REPORT_CHIPS,
  formatDuration,
  pickChoices,
  reasonMessage,
  rowActions,
  summaryMessage,
  type CatalogTrack,
  type Decision,
  type ImportSummary,
  type ImportsDaemon,
  type Message,
  type ReportRow,
  type RowsFilter,
} from "../../ports/imports";
import styles from "./ImportReport.module.css";

export interface ReportPorts extends Pick<ImportsDaemon, "rows" | "decide" | "bulk"> {
  search?(query: string): Promise<CatalogTrack[]>;
  refresh(importId: string): Promise<void>;
  dismiss(importId: string): Promise<void>;
  saveCsv?(importId: string): Promise<void>;
}

export interface ImportReportProps {
  open: boolean;
  onClose(): void;
  summary: ImportSummary;
  ports: ReportPorts;
}

interface Page {
  rows: ReportRow[];
  next?: string;
  loading: boolean;
  failed: boolean;
}

export const MAX_RENDERED_ROWS = 400;

const names = (artists: { name: string }[] | string[]) => artists.map((a) => (typeof a === "string" ? a : a.name)).join(", ");

const trackLabel = (track: CatalogTrack) => `${track.title} · ${names(track.artists)}${track.durationMs ? ` · ${formatDuration(track.durationMs)}` : ""}`;

function RowSearch({ search, onPick }: { search: (query: string) => Promise<CatalogTrack[]>; onPick: (track: CatalogTrack) => void }): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "none" } | { kind: "failed" } | { kind: "found"; tracks: CatalogTrack[] }>({
    kind: "idle",
  });

  const run = () => {
    const text = query.trim();
    if (!text) return;
    setState({ kind: "busy" });
    search(text).then(
      (tracks) => setState(tracks.length ? { kind: "found", tracks } : { kind: "none" }),
      () => setState({ kind: "failed" }),
    );
  };

  return (
    <>
      <li>
        <TextField
          value={query}
          onChange={setQuery}
          onSubmit={run}
          label={t("ui.imports.search.label")}
          placeholder={t("ui.imports.search.label")}
          maxLength={200}
        />
      </li>
      {state.kind === "none" || state.kind === "failed" ? <li className={styles.caption}>{t(`ui.imports.search.${state.kind}`)}</li> : null}
      {state.kind === "found"
        ? state.tracks.map((track) => (
            <li key={track.id}>
              <Button variant="text" size="s" onClick={() => onPick(track)}>
                {trackLabel(track)}
              </Button>
            </li>
          ))
        : null}
    </>
  );
}

export function ImportReport({ open, onClose, summary, ports }: ImportReportProps): JSX.Element | null {
  const { t } = useTranslation();
  const [chip, setChip] = useState<RowsFilter>("review");
  const [page, setPage] = useState<Page>({
    rows: [],
    loading: true,
    failed: false,
  });
  const [picking, setPicking] = useState<number | null>(null);
  const [problem, setProblem] = useState<Message | null>(null);
  // every fetch takes a ticket; only the newest ticket may change the list
  const ticket = useRef(0);

  const fetchRows = (filter: RowsFilter, cursor?: string) => {
    ticket.current += 1;
    const mine = ticket.current;
    ports.rows(summary.id, filter, cursor).then(
      (answer) => {
        if (mine !== ticket.current) return;
        setPage((current) => ({
          rows: cursor ? [...current.rows, ...answer.items] : answer.items,
          next: answer.nextCursor,
          loading: false,
          failed: false,
        }));
      },
      () => {
        if (mine !== ticket.current) return;
        setPage((current) => ({ ...current, loading: false, failed: true }));
      },
    );
  };

  const load = (filter: RowsFilter, cursor?: string) => {
    setPage((current) => ({ ...current, loading: true, failed: false }));
    fetchRows(filter, cursor);
  };

  const choose = (filter: RowsFilter) => {
    setChip(filter);
    setPage({ rows: [], loading: true, failed: false });
    fetchRows(filter);
  };

  // the host mounts one report per import, so the first page loads once, on mount
  const loadFirst = useEffectEvent(() => fetchRows("review"));
  useEffect(() => {
    loadFirst();
  }, []);

  const replace = (row: ReportRow) =>
    setPage((current) => ({
      ...current,
      rows: current.rows.map((r) => (r.id === row.id ? row : r)),
    }));

  const decide = (row: ReportRow, decision: Decision, track?: CatalogTrack) => {
    setPicking(null);
    setProblem(null);
    // the row only changes once the daemon has taken the choice, so a failure leaves it as it was
    ports.decide(summary.id, row.id, decision, track).then(
      (updated) => {
        replace(updated);
        void ports.refresh(summary.id);
      },
      () =>
        setProblem({
          key: "ui.imports.error.decide",
          vars: { title: row.source.title },
        }),
    );
  };

  const bulk = (action: "accept-check" | "retry-failed") => {
    setProblem(null);
    ports.bulk(summary.id, action).then(
      () => {
        void ports.refresh(summary.id);
        load(chip);
      },
      () => setProblem({ key: "ui.imports.error.bulk" }),
    );
  };

  const done = () => {
    void ports.dismiss(summary.id).then(onClose);
  };

  const state = summaryMessage(summary);
  const failedSearches = page.rows.some((row) => row.reason === "catalog_lookup_failed" && !row.decision);
  const actions: SheetAction[] = [
    ...(ports.saveCsv
      ? [
          {
            label: t("ui.imports.save_csv"),
            onClick: () => void ports.saveCsv?.(summary.id),
          },
        ]
      : []),
    { label: t("ui.imports.close"), onClick: onClose },
    {
      label: t("ui.imports.done"),
      onClick: done,
      primary: true,
      disabled: summary.status === "running",
    },
  ];

  const actionLabel: Record<string, string> = {
    use: t("ui.imports.action.use"),
    keep: t("ui.imports.action.keep"),
    remove: t("ui.imports.action.remove"),
    pick: t("ui.imports.action.pick"),
  };

  return (
    <Sheet open={open} onClose={onClose} title={summary.label || t("ui.imports.report_title")} actions={actions}>
      <div className={styles.body}>
        <p className={styles.line} role="status">
          {t(state.key, state.vars)}
        </p>
        <p className={styles.caption}>{t("ui.imports.honesty")}</p>
        <div className={styles.chips} role="group" aria-label={t("ui.imports.report_title")}>
          {REPORT_CHIPS.map((filter) => (
            <Chip key={filter} active={chip === filter} onClick={() => choose(filter)}>
              {t(`ui.imports.chip.${filter}`)}
            </Chip>
          ))}
        </div>
        {chip === "review" && (summary.needsReview > 0 || failedSearches) ? (
          <div className={styles.bulk}>
            {summary.counts.check > 0 ? (
              <Button variant="text" size="s" onClick={() => bulk("accept-check")}>
                {t("ui.imports.accept_check")}
              </Button>
            ) : null}
            {failedSearches ? (
              <Button variant="text" size="s" onClick={() => bulk("retry-failed")}>
                {t("ui.imports.retry_failed")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {page.failed ? (
          <p className={styles.line} role="alert">
            {t("ui.imports.error.daemon")}
          </p>
        ) : null}
        {problem ? (
          <p className={styles.line} role="alert">
            {t(problem.key, problem.vars)}
          </p>
        ) : null}
        {!page.loading && page.rows.length === 0 && !page.failed ? (
          <p className={styles.line}>{t(`ui.imports.empty.${chip === "review" ? "review" : "other"}`)}</p>
        ) : null}
        <ul className={styles.rows}>
          {page.rows.slice(0, MAX_RENDERED_ROWS).map((row) => {
            const reason = reasonMessage(row);
            const source = row.source;
            const heading =
              (source.artists.length ? `${source.title} · ${names(source.artists)}` : source.title) +
              (source.durationMs ? ` · ${formatDuration(source.durationMs)}` : "");
            const matched =
              row.track && row.decision !== "remove"
                ? t("ui.imports.matched_to", {
                    title: row.track.title,
                    artist: names(row.track.artists),
                  })
                : null;
            const why = `${row.label ? `${t(`ui.imports.label.${row.label}`)} · ` : ""}${reason ? t(reason.key, reason.vars) : t("ui.imports.matching")}`;
            return (
              <li key={row.id} className={styles.row}>
                <span className={styles.title} title={heading}>
                  {heading}
                </span>
                {matched ? (
                  <span className={styles.match} title={matched}>
                    {matched}
                  </span>
                ) : null}
                <span className={styles.match} title={why}>
                  {why}
                </span>
                <div className={styles.actions}>
                  {rowActions(row).map((action) => (
                    <Button
                      key={action}
                      variant="text"
                      size="s"
                      aria-label={t("ui.imports.action_for", {
                        action: actionLabel[action],
                        title: source.title,
                      })}
                      onClick={() => (action === "pick" ? setPicking(picking === row.id ? null : row.id) : decide(row, action))}
                    >
                      {actionLabel[action]}
                    </Button>
                  ))}
                </div>
                {picking === row.id ? (
                  <ul className={styles.choices}>
                    {pickChoices(row).map((track) => (
                      <li key={track.id}>
                        <Button variant="text" size="s" onClick={() => decide(row, "pick", track)}>
                          {trackLabel(track)}
                        </Button>
                      </li>
                    ))}
                    {ports.search ? <RowSearch key={row.id} search={ports.search} onPick={(track) => decide(row, "pick", track)} /> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {page.rows.length > MAX_RENDERED_ROWS || (page.next && page.rows.length >= MAX_RENDERED_ROWS) ? (
          <p className={styles.caption}>{t("ui.imports.rows_capped", { count: MAX_RENDERED_ROWS })}</p>
        ) : page.next ? (
          <Button variant="text" size="s" disabled={page.loading} onClick={() => load(chip, page.next)}>
            {t("ui.imports.show_more")}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
