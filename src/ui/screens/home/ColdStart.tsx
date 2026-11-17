import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { EmptyState } from "../../components/EmptyState";
import { useTranslation } from "../../ports/i18n";
import { IMPORT_SOURCES, openImportSheet } from "../../ports/importSources";
import { useModalStore } from "../../ports/navigation";
import { useStreamingReachable } from "../../ports/network";
import { recsChanged, useWarmup, warmHome } from "../../ports/recs";
import { coldStartNeeded, startFromPicks } from "../../ports/starters";
import { TastePicker } from "../../recs/TastePicker";
import { ServiceMark } from "../../tour/ServiceMark";
import { useTour } from "../../tour/tourStore";
import styles from "./ColdStart.module.css";

const COLD_ROWS = 5;
const OUTLINE_CARDS = 4;

function Building(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.building} role="status" data-building="">
      <div className={styles.outline} aria-hidden="true">
        {Array.from({ length: OUTLINE_CARDS }, (_, index) => (
          <span key={index} className={styles.card} data-lead={index === 0 ? "" : undefined} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>
      <p className={styles.note}>{t("ui.recs.home.building")}</p>
    </div>
  );
}

export function ColdStart({ onImport }: { onImport?: () => void } = {}): JSX.Element | null {
  const { t } = useTranslation();
  const online = useStreamingReachable();
  const tourOff = useTour((state) => state.phase === "off");
  const [cold, setCold] = useState<boolean | null>(null);
  const warmup = useWarmup((state) => state.phase);

  useEffect(() => {
    let live = true;
    const check = () =>
      void coldStartNeeded().then((needed) => {
        if (live) setCold(needed);
      });
    check();
    // favourites sent from the tour's start card answer the ask before it shows
    recsChanged.addEventListener("change", check);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", check);
    };
  }, []);

  if (warmup === "building") return <Building />;
  if (warmup === "failed") {
    return (
      <EmptyState
        title={t("ui.recs.home.offline_title")}
        message={t("ui.recs.home.offline_message")}
        actions={[
          { label: t("ui.recs.home.retry"), primary: true, onClick: () => void warmHome(useWarmup.getState().seeds) },
          { label: t("ui.recs.home.search"), onClick: () => useModalStore.getState().openSearch() },
        ]}
      />
    );
  }
  if (cold === null) return null;
  if (cold && online && tourOff) {
    return (
      <div className={styles.ask} data-cold-ask="">
        <section className={styles.taste} aria-labelledby="cold-taste-title">
          <h2 id="cold-taste-title" className={styles.title}>
            {t("ui.recs.start.title")}
          </h2>
          <p className={styles.message}>{t("ui.recs.start.message")}</p>
          <TastePicker className={styles.picker} action={t("ui.recs.start.go")} rows={COLD_ROWS} start={startFromPicks} />
        </section>
        {onImport ? (
          <section className={styles.import} aria-labelledby="cold-import-title">
            <h3 id="cold-import-title" className={styles.importTitle}>
              {t("ui.recs.home.import_from")}
            </h3>
            <ul className={styles.sources}>
              {IMPORT_SOURCES.map((source) => (
                <li key={source}>
                  <button type="button" className={styles.source} data-source={source} onClick={() => void openImportSheet(source)}>
                    <ServiceMark source={source} size={18} />
                    {t(`ui.tour.start.sources.${source}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }
  return (
    <EmptyState
      title={t("ui.recs.home.empty_title")}
      message={t("ui.recs.home.empty_message")}
      tour="home-start"
      actions={[
        { label: t("ui.recs.home.search"), primary: true, onClick: () => useModalStore.getState().openSearch() },
        ...(onImport ? [{ label: t("ui.library.import"), onClick: onImport }] : []),
      ]}
    />
  );
}
