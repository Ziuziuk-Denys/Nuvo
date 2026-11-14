import type { JSX } from "react";
import { Button } from "../components/Button";
import pop from "../components/Popover.module.css";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { IMPORT_SOURCES, openImportSheet, type ImportSource } from "../ports/importSources";
import { seedFavorites, type FavoritePick } from "../ports/recs";
import { TastePicker } from "../recs/TastePicker";
import { ServiceMark } from "./ServiceMark";
import { useTour } from "./tourStore";
import styles from "./tour.module.css";

const TOUR_ROWS = 3;

interface StartStepProps {
  onContinue: () => void;
  onSkipTour: () => void;
}

export function StartStep({ onContinue, onSkipTour }: StartStepProps): JSX.Element {
  const { t } = useTranslation();
  const started = useTour((state) => state.started);

  return (
    <div
      role="dialog"
      aria-labelledby="tour-start-title"
      aria-describedby="tour-start-text"
      className={`${styles.card} ${styles.start} ${pop.pop}`}
      data-state="in"
    >
      <div className={styles.startHead}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="nuvo-mark" size={26} />
        </span>
        <h2 id="tour-start-title" className={styles.posterTitle}>
          {t("ui.tour.poster.title")}
        </h2>
        <p id="tour-start-text" className={styles.posterText}>
          {t("ui.tour.start.text")}
        </p>
      </div>
      <div className={styles.startPanels}>
        <ImportPanel />
        <TastePanel />
      </div>
      <div className={styles.actions}>
        <Button variant="text" onClick={onSkipTour}>
          {t("ui.tour.poster.finish")}
        </Button>
        <Button variant={started ? "primary" : "secondary"} data-primary="" onClick={onContinue}>
          {t(started ? "ui.tour.start.continue" : "ui.tour.start.skip_now")}
        </Button>
      </div>
    </div>
  );
}

function ImportPanel(): JSX.Element {
  const { t } = useTranslation();

  const choose = async (source: ImportSource) => {
    const tour = useTour.getState();
    tour.setAway(true);
    try {
      await openImportSheet(source);
    } finally {
      tour.setAway(false);
    }
    tour.markStarted();
  };

  return (
    <section className={styles.panel} aria-labelledby="tour-import-title">
      <h3 id="tour-import-title" className={styles.panelTitle}>
        {t("ui.tour.start.import_title")}
      </h3>
      <p className={styles.panelText}>{t("ui.tour.start.import_text")}</p>
      <ul className={styles.sources}>
        {IMPORT_SOURCES.map((source) => (
          <li key={source}>
            <button type="button" className={styles.source} data-source={source} onClick={() => void choose(source)}>
              <ServiceMark source={source} />
              <span className={styles.sourceText}>
                <b>{t(`ui.tour.start.sources.${source}`)}</b>
                <span>{t(`ui.tour.start.sources.${source}_line`)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TastePanel(): JSX.Element {
  const { t } = useTranslation();

  const start = async (picks: FavoritePick[]) => {
    try {
      await seedFavorites(picks);
    } catch {
      return false;
    }
    useTour.getState().markStarted();
    return true;
  };

  return (
    <section className={styles.panel} aria-labelledby="tour-taste-title">
      <h3 id="tour-taste-title" className={styles.panelTitle}>
        {t("ui.tour.start.taste_title")}
      </h3>
      <p className={styles.panelText}>{t("ui.tour.start.taste_text")}</p>
      <TastePicker className={styles.taste} action={t("ui.tour.start.taste_use")} rows={TOUR_ROWS} start={start} />
    </section>
  );
}
