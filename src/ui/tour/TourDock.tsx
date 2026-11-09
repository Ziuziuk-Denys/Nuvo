import type { JSX } from "react";
import { Button } from "../components/Button";
import pop from "../components/Popover.module.css";
import { useTranslation } from "../ports/i18n";
import { stepCount, type ChapterId } from "./chapters";
import { GateButton } from "./GateButton";
import styles from "./tour.module.css";

interface TourDockProps {
  chapterIds: ChapterId[];
  chapter: number;
  step: number;
  last: boolean;
  waiting: boolean;
  ready: boolean;
  onReady: () => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourDock({ chapterIds, chapter, step, last, waiting, ready, onReady, onNext, onBack, onSkip }: TourDockProps): JSX.Element {
  const { t } = useTranslation();
  const id = chapterIds[chapter];
  const share = (step + 1) / stepCount(id);

  return (
    <div className={`${styles.card} ${styles.dock} ${pop.pop}`} data-state="in" data-dock="">
      <div className={styles.segments} aria-hidden="true">
        {chapterIds.map((item, index) => (
          <span key={item} className={styles.segment}>
            <span className={styles.segmentFill} style={{ transform: `scaleX(${index < chapter ? 1 : index === chapter ? share : 0})` }} />
          </span>
        ))}
      </div>
      <div className={styles.dockRow}>
        <div className={styles.dockText}>
          <h2 className={styles.dockTitle}>{t(`ui.tour.chapters.${id}`)}</h2>
          <span className={styles.counter}>{t("ui.tour.counter", { n: chapter + 1, total: chapterIds.length })}</span>
        </div>
        <div className={styles.dockActions}>
          <Button variant="text" data-skip="" onClick={onSkip}>
            {t("ui.tour.skip")}
          </Button>
          {chapter > 0 || step > 0 ? <Button onClick={onBack}>{t("ui.tour.back")}</Button> : null}
          <GateButton seconds={5} waiting={waiting} running={ready} gateKey={id} onReady={onReady} onClick={onNext}>
            {t(last ? "ui.tour.done" : "ui.tour.next")}
          </GateButton>
        </div>
      </div>
    </div>
  );
}
