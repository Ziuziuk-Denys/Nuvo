import { useState, type JSX, type ReactNode } from "react";
import { Menu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import look from "../look.module.css";
import styles from "./EntityHead.module.css";

export interface EntityHeadProps {
  cover: ReactNode;
  shape?: "square" | "circle";
  title: string;
  subtitle?: ReactNode;
  description?: ReactNode;
  chips?: ReactNode;
  onPlay?: () => void;
  onShuffle?: () => void;
  actions?: ReactNode;
  saved?: boolean;
  onSave?: () => void;
  onQueue?: () => void;
  menu?: MenuItem[];
  search?: ReactNode;
  sort?: ReactNode;
  idle?: boolean;
}

export interface EntityButtonsProps {
  playLabel: string;
  shuffleLabel?: string;
  onPlay?: () => void;
  onShuffle?: () => void;
  saved?: boolean;
  onSave?: () => void;
  menu?: MenuItem[];
  idle?: boolean;
}

export function EntityButtons({ playLabel, shuffleLabel, onPlay, onShuffle, saved, onSave, menu = [], idle }: EntityButtonsProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.buttons}>
      <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} data-primary="" onClick={onPlay} disabled={idle}>
        <Icon name="play" size={16} />
        {playLabel}
      </button>
      <button
        type="button"
        className={shuffleLabel ? `${look.pill} ${look.glass}` : `${look.pill} ${look.glass} ${look.square}`}
        aria-label={shuffleLabel ? undefined : t("ui.entity.shuffle")}
        onClick={onShuffle}
        disabled={idle}
      >
        <Icon name="shuffle" size={16} />
        {shuffleLabel}
      </button>
      {onSave ? (
        <button
          type="button"
          className={`${look.pill} ${look.glass} ${look.square}`}
          aria-label={t(saved ? "ui.entity.saved" : "ui.entity.save")}
          aria-pressed={saved}
          onClick={onSave}
        >
          <Icon name={saved ? "check" : "add"} size={16} />
        </button>
      ) : null}
      <MoreButton menu={menu} />
    </div>
  );
}

function MoreButton({ menu }: { menu: MenuItem[] }): JSX.Element | null {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (menu.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className={look.icon}
        aria-label={t("ui.entity.more")}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Icon name="more" size={20} />
      </button>
      <Menu open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={menu} />
    </>
  );
}

export function EntityHead({
  cover,
  shape = "square",
  title,
  subtitle,
  description,
  chips,
  onPlay,
  onShuffle,
  actions,
  saved,
  onSave,
  onQueue,
  menu = [],
  search,
  sort,
  idle,
}: EntityHeadProps): JSX.Element {
  const { t } = useTranslation();
  const trailing = search || sort || onQueue;

  return (
    <header className={styles.head} data-shape={shape}>
      <div className={styles.cover} data-hero-cover="">
        {cover}
      </div>
      <div className={styles.column}>
        <div className={styles.titleLine}>
          <h1 className={`${look.pageTitle} ${styles.title}`}>{title}</h1>
        </div>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {description ? <div className={styles.description}>{description}</div> : null}
        {chips ? <div className={styles.chips}>{chips}</div> : null}
        <div className={styles.actions}>
          {actions ? (
            <div className={styles.buttons}>{actions}</div>
          ) : (
            <EntityButtons
              playLabel={t(shape === "circle" ? "ui.entity.play" : "common.play_all")}
              onPlay={onPlay}
              onShuffle={onShuffle}
              saved={saved}
              onSave={onSave}
              menu={trailing ? [] : menu}
              idle={idle}
            />
          )}
          {trailing ? (
            <div className={styles.tools}>
              {search}
              {onQueue ? (
                <button type="button" className={`${look.pill} ${look.glass}`} onClick={onQueue} disabled={idle}>
                  <Icon name="add" size={16} />
                  {t("ui.entity.add_to_queue")}
                </button>
              ) : null}
              {sort}
              <MoreButton menu={menu} />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function Facts({ year, count, length, updated }: { year?: string; count: string; length?: string; updated?: string }): JSX.Element {
  return (
    <>
      {year ? <span>{year}</span> : null}
      <span>{count}</span>
      {length ? <span>{length}</span> : null}
      {updated ? <span>{updated}</span> : null}
    </>
  );
}
