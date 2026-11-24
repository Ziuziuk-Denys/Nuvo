import type { JSX } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../icons/Icon";
import { MixArt } from "../../icons/MixArt";
import { useTranslation } from "../../ports/i18n";
import type { HomeMix } from "../../ports/recs";
import styles from "./MixCard.module.css";

export interface MixCardProps {
  mix: HomeMix;
  cover: string;
  number: number;
  title: string;
  subtitle: string;
  lead?: boolean;
  names?: string;
  onOpen(): void;
  onPlay(): void;
}

const LEAD_SIZE = 240;
const DAILY_SIZE = 175;

export function MixCard({ mix, cover, number, title, subtitle, lead = false, names, onOpen, onPlay }: MixCardProps): JSX.Element {
  const size = lead ? LEAD_SIZE : DAILY_SIZE;
  const { t } = useTranslation();

  return (
    <div
      className={lead ? `${styles.card} ${styles.lead}` : styles.card}
      data-mix={mix.id}
      role="link"
      tabIndex={0}
      onClick={(event) => {
        // the second click of a double click plays instead of opening twice
        if (event.detail < 2) onOpen();
      }}
      onDoubleClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
      }}
    >
      <div className={styles.cover} style={{ width: size, height: size }}>
        <MixArt covers={[cover]} number={number} size={size} />
      </div>
      {lead ? (
        <div className={styles.leadCaption}>
          <h2 className={styles.leadTitle} data-tour="mixes">
            {title}
          </h2>
          <p className={styles.leadLine}>{subtitle}</p>
          {names ? <p className={styles.leadLine}>{names}</p> : null}
          <Button
            variant="primary"
            className={styles.play}
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
          >
            <Icon name="play" size={16} />
            {t("ui.entity.play")}
          </Button>
        </div>
      ) : (
        <div className={styles.caption}>
          <span className={styles.title}>{title}</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </div>
      )}
    </div>
  );
}
