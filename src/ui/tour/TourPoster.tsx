import type { JSX } from "react";
import { Button } from "../components/Button";
import pop from "../components/Popover.module.css";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import type { ChapterId } from "./chapters";
import type { PosterKind } from "./tourStore";
import styles from "./tour.module.css";

interface TourPosterProps {
  kind: Exclude<PosterKind, "start">;
  /** The chapter a resumed tour picks up at, or the ones a later offer shows */
  chapters: ChapterId[];
  onWatch: () => void;
  /** Skip the tour on a resume, Not now on a later offer */
  onSkip: () => void;
}

/** The card before the chapters on a later launch: the offer to resume, or to show what was left out */
export function TourPoster({ kind, chapters, onWatch, onSkip }: TourPosterProps): JSX.Element {
  const { t } = useTranslation();
  const names = chapters.map((id) => t(`ui.tour.chapters.${id}`)).join(", ");
  const resume = kind === "resume";
  const title = resume ? t("ui.tour.poster.resume_title") : t("ui.tour.poster.more_title");
  const text = resume ? t("ui.tour.poster.resume_text", { chapter: names }) : t("ui.tour.poster.more_text", { chapters: names });
  const skip = resume ? t("ui.tour.poster.finish") : t("ui.tour.poster.later");
  const watch = resume ? t("ui.tour.poster.resume") : t("ui.tour.poster.watch");

  return (
    <div
      role="dialog"
      aria-labelledby="tour-poster-title"
      aria-describedby="tour-poster-text"
      className={`${styles.card} ${styles.poster} ${pop.pop}`}
      data-state="in"
    >
      <span className={styles.mark} aria-hidden="true">
        <Icon name="nuvo-mark" size={26} />
      </span>
      <h2 id="tour-poster-title" className={styles.posterTitle}>
        {title}
      </h2>
      <p id="tour-poster-text" className={styles.posterText}>
        {text}
      </p>
      <div className={styles.actions}>
        <Button variant="text" onClick={onSkip}>
          {skip}
        </Button>
        <Button variant="primary" data-primary="" onClick={onWatch}>
          {watch}
        </Button>
      </div>
    </div>
  );
}
