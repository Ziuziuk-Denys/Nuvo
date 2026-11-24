import type { CSSProperties, JSX } from "react";
import { Button } from "../../components/Button";
import { useFirstVisit } from "../../components/Enter";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { openImportSheet } from "../../ports/importSources";
import { useModalStore } from "../../ports/navigation";
import { useWarmup, warmHome } from "../../ports/recs";
import { ServiceMark } from "../../tour/ServiceMark";
import { useAddMusic } from "../local/addMusic";
import { EmptyRoom } from "./discover/EmptyRoom";
import styles from "./ColdStart.module.css";

const IMPORT_LINKS = ["spotify", "apple", "youtube"] as const;

function BringMusic(): JSX.Element {
  const { t } = useTranslation();
  const addMusic = useAddMusic();
  const first = useFirstVisit("home-bring");
  const rise = (className: string, index: number) =>
    first ? { className: `${className} n-enter`, style: { "--n-i": index } as CSSProperties } : { className };
  return (
    <div data-bring="" data-tour="home-start">
      <EmptyRoom title={t("ui.home.bring.title")}>
        <p {...rise(styles.line, 0)}>
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
        <p {...rise(styles.line, 1)}>
          <span>{t("ui.home.bring.or")}</span>
          <button type="button" className={`${styles.chip} ${styles.files}`} onClick={() => void addMusic()}>
            <Icon name="folder-add" size={16} />
            {t("ui.home.bring.files")}
          </button>
        </p>
        <p {...rise(styles.hint, 2)}>{t("ui.home.bring.drop")}</p>
      </EmptyRoom>
    </div>
  );
}

export function ColdStart(): JSX.Element {
  const { t } = useTranslation();
  const warmup = useWarmup((state) => state.phase);
  if (warmup === "building") {
    return (
      <div role="status" data-building="">
        <EmptyRoom title={t("ui.recs.home.building")} />
      </div>
    );
  }
  if (warmup === "failed") {
    return (
      <EmptyRoom title={t("ui.recs.home.offline_title")} message={t("ui.recs.home.offline_message")}>
        <p className={styles.line}>
          <Button variant="primary" onClick={() => void warmHome(useWarmup.getState().seeds)}>
            {t("ui.recs.home.retry")}
          </Button>
          <Button onClick={() => useModalStore.getState().openSearch()}>{t("ui.recs.home.search")}</Button>
        </p>
      </EmptyRoom>
    );
  }
  return <BringMusic />;
}
