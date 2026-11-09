import type { JSX } from "react";
import { Button } from "../components/Button";
import pop from "../components/Popover.module.css";
import { useTranslation } from "../ports/i18n";
import styles from "./tour.module.css";

interface SkipPromptProps {
  onChapter: () => void;
  onLater: () => void;
  onAll: () => void;
  onStay: () => void;
}

export function SkipPrompt({ onChapter, onLater, onAll, onStay }: SkipPromptProps): JSX.Element {
  const { t } = useTranslation();
  const choices = [
    { id: "chapter", run: onChapter },
    { id: "later", run: onLater },
    { id: "all", run: onAll },
  ];
  return (
    <div role="dialog" aria-labelledby="tour-prompt-title" data-prompt="" className={`${styles.card} ${styles.prompt} ${pop.pop}`} data-state="in">
      <h2 id="tour-prompt-title" className={styles.promptTitle}>
        {t("ui.tour.prompt.title")}
      </h2>
      <div className={styles.choices}>
        {choices.map((choice) => (
          <button key={choice.id} type="button" className={styles.choice} onClick={choice.run}>
            <b>{t(`ui.tour.prompt.${choice.id}`)}</b>
            <span>{t(`ui.tour.prompt.${choice.id}_line`)}</span>
          </button>
        ))}
      </div>
      <div className={styles.promptFoot}>
        <Button variant="primary" onClick={onStay}>
          {t("ui.tour.prompt.stay")}
        </Button>
      </div>
    </div>
  );
}
