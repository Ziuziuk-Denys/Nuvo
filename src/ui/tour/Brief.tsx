import type { CSSProperties, JSX } from "react";
import { Button } from "../components/Button";
import pop from "../components/Popover.module.css";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { useTranslation } from "../ports/i18n";
import { GateButton } from "./GateButton";
import styles from "./tour.module.css";

const ROWS: { id: string; icon: IconName }[] = [
  { id: "search", icon: "search" },
  { id: "recognize", icon: "recognize" },
  { id: "sound", icon: "equalizer" },
  { id: "library", icon: "library" },
  { id: "look", icon: "palette" },
];

interface BriefProps {
  waiting: boolean;
  onReady: () => void;
  onDone: () => void;
  onWatch: () => void;
}

/** The short version for users who skip: five rows, ten seconds to read on the first run, the tour one press away */
export function Brief({ waiting, onReady, onDone, onWatch }: BriefProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div role="dialog" aria-labelledby="tour-brief-title" className={`${styles.card} ${styles.brief} ${pop.pop}`} data-state="in">
      <h2 id="tour-brief-title" className={styles.posterTitle}>
        {t("ui.tour.brief.title")}
      </h2>
      <p className={styles.posterText}>{t("ui.tour.brief.text")}</p>
      <ul className={styles.rows}>
        {ROWS.map((row, index) => (
          <li key={row.id} className={`${styles.row} n-enter`} style={{ "--n-i": index + 1 } as CSSProperties}>
            <span className={styles.rowIcon} aria-hidden="true">
              <Icon name={row.icon} size={18} />
            </span>
            <span className={styles.rowText}>
              <b>{t(`ui.tour.brief.${row.id}`)}</b>
              <span>{t(`ui.tour.brief.${row.id}_line`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button onClick={onWatch}>{t("ui.tour.brief.watch")}</Button>
        <GateButton seconds={10} waiting={waiting} gateKey="brief" onReady={onReady} onClick={onDone}>
          {t("ui.tour.brief.ok")}
        </GateButton>
      </div>
    </div>
  );
}
