import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import type { ImportSummary, ReportRow } from "../../ports/imports";
import { getImports } from "../../ports/importsRuntime";
import { MediaRow } from "../MediaRow";
import styles from "./ImportPending.module.css";

export function ImportPending({ running }: { running: ImportSummary }): JSX.Element | null {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const { id: importId, done } = running;

  useEffect(() => {
    const controller = new AbortController();
    getImports()
      .daemon.rows(importId, "pending", undefined, controller.signal)
      .then((page) => setRows(page.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [importId, done]);

  if (rows.length === 0) return null;
  const left = running.total - running.done;
  return (
    <section className={styles.pending} aria-label={t("ui.imports.pending", { count: left })}>
      <p className={styles.caption} role="status">
        {t("ui.imports.pending", { count: left })}
      </p>
      {rows.map((row, index) => (
        <MediaRow
          key={row.id}
          className={styles.row}
          style={{ "--wave": index % 6 } as CSSProperties}
          leading={<span className={styles.tile} />}
          title={row.source.title}
          subtitle={row.source.artists.join(", ")}
          meta={t("ui.imports.matching")}
        />
      ))}
    </section>
  );
}
