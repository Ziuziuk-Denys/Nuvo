import type { JSX } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { useCoverFluidColors } from "../../ports/covers";
import type { HomeMix } from "../../ports/recs";
import { mosaicCovers } from "./homeModel";
import styles from "./MixCard.module.css";

export interface MixCardProps {
  mix: HomeMix;
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

export function MixCard({ mix, number, title, subtitle, lead = false, names, onOpen, onPlay }: MixCardProps): JSX.Element {
  const size = lead ? LEAD_SIZE : DAILY_SIZE;
  const covers = mosaicCovers(mix.tracks);
  const cell = covers.length === 4 ? Math.floor(size / 2) : size;
  const { t } = useTranslation();
  const { color1, logoColor } = useCoverFluidColors(covers[0]);

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
        <div className={styles.art} data-mosaic={covers.length === 4 ? "" : undefined}>
          {covers.map((url) => (
            <Cover key={url} src={url} size={cell} radius={0} />
          ))}
        </div>
        <div className={styles.shade} style={{ background: `linear-gradient(45deg, ${color1} 0%, rgb(0 0 0 / 0.2) 100%)` }} />
        <span className={styles.mark} style={{ color: logoColor }}>
          <Icon name="nuvo-mark" size={lead ? 20 : 16} />
        </span>
        <span className={styles.word}>MIX</span>
        <span className={styles.number} data-mix-number>
          {number}
        </span>
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
