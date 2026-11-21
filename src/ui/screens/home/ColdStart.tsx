import type { CSSProperties, JSX } from "react";
import { EmptyState } from "../../components/EmptyState";
import { useFirstVisit } from "../../components/Enter";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { openImportSheet } from "../../ports/importSources";
import { useModalStore } from "../../ports/navigation";
import { useWarmup, warmHome } from "../../ports/recs";
import { ServiceMark } from "../../tour/ServiceMark";
import { useAddMusic } from "../local/addMusic";
import styles from "./ColdStart.module.css";

const OUTLINE_CARDS = 4;
const IMPORT_LINKS = ["spotify", "apple", "youtube"] as const;

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

function BringMusic(): JSX.Element {
  const { t } = useTranslation();
  const addMusic = useAddMusic();
  const first = useFirstVisit("home-bring");
  const rise = (className: string, index: number) =>
    first ? { className: `${className} n-enter`, style: { "--n-i": index } as CSSProperties } : { className };
  return (
    <section className={styles.bring} aria-labelledby="bring-title" data-bring="" data-tour="home-start">
      <h2 id="bring-title" {...rise(styles.title, 0)}>
        {t("ui.home.bring.title")}
      </h2>
      <div className={styles.phrase}>
        <p {...rise(styles.line, 1)}>
          <span>{t("ui.home.bring.from")}</span>
          <span className={styles.sources}>
            {IMPORT_LINKS.map((source) => (
              <button key={source} type="button" className={styles.chip} data-source={source} onClick={() => void openImportSheet(source)}>
                <ServiceMark source={source} size={16} />
                {t(`ui.tour.start.sources.${source}`)}
              </button>
            ))}
          </span>
        </p>
        <p {...rise(styles.line, 2)}>
          <span>{t("ui.home.bring.or")}</span>
          <button type="button" className={`${styles.chip} ${styles.files}`} onClick={() => void addMusic()}>
            <Icon name="folder-add" size={16} />
            {t("ui.home.bring.files")}
          </button>
        </p>
      </div>
      <p {...rise(styles.hint, 3)}>
        {t("ui.home.bring.drop")}
      </p>
    </section>
  );
}

export function ColdStart(): JSX.Element {
  const { t } = useTranslation();
  const warmup = useWarmup((state) => state.phase);
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
  return <BringMusic />;
}
