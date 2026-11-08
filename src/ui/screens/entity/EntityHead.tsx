import { useState, type JSX, type ReactNode } from "react";
import { Menu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import look from "../look.module.css";
import styles from "./EntityHead.module.css";

export interface EntityHeadProps {
  /** The artwork, drawn to fill the 168 px box (144 px and round for an artist). */
  cover: ReactNode;
  shape?: "square" | "circle";
  title: string;
  /** Beside the title, such as a verified mark. */
  badge?: ReactNode;
  subtitle?: ReactNode;
  /** The small line under the title: a playlist's description. */
  description?: ReactNode;
  /** Fact chips under the title: a year, the count and the length. */
  chips?: ReactNode;
  onPlay?: () => void;
  onShuffle?: () => void;
  /** Replaces Play and Shuffle: an entity with nothing to list but one way to start. */
  actions?: ReactNode;
  /** The Save toggle, for what you do not own. */
  saved?: boolean;
  onSave?: () => void;
  onQueue?: () => void;
  /** The entity menu; no more button when it is empty. */
  menu?: MenuItem[];
  /** Right of the action row: the in-page search before Add to queue, the sort after it. */
  search?: ReactNode;
  sort?: ReactNode;
  /** No tracks to play yet. */
  idle?: boolean;
}

/** The entity head: the cover, and beside it the title, a line, fact chips and one row of pill actions. */
export function EntityHead({
  cover,
  shape = "square",
  title,
  badge,
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const glass = `${look.pill} ${look.glass}`;

  const more =
    menu.length > 0 ? (
      <button
        type="button"
        className={`${glass} ${look.square}`}
        aria-label={t("ui.entity.more")}
        aria-haspopup="menu"
        aria-expanded={menuAnchor !== null}
        onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
      >
        <Icon name="more" size={20} />
      </button>
    ) : null;
  const trailing = search || sort || onQueue;

  return (
    <header className={styles.head} data-shape={shape}>
      <div className={styles.cover}>{cover}</div>
      <div className={styles.column}>
        <div className={styles.titleLine}>
          <h1 className={styles.title}>{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {description ? <div className={styles.description}>{description}</div> : null}
        {chips ? <div className={styles.chips}>{chips}</div> : null}
        <div className={styles.actions}>
          <div className={styles.buttons}>
            {actions ?? (
              <>
                <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} data-primary="" onClick={onPlay} disabled={idle}>
                  <Icon name="play" size={16} />
                  {t(shape === "circle" ? "ui.entity.play" : "common.play_all")}
                </button>
                <button type="button" className={`${glass} ${look.square}`} aria-label={t("ui.entity.shuffle")} onClick={onShuffle} disabled={idle}>
                  <Icon name="shuffle" size={16} />
                </button>
                {onSave ? (
                  <button
                    type="button"
                    className={`${glass} ${look.square}`}
                    aria-label={t(saved ? "ui.entity.saved" : "ui.entity.save")}
                    aria-pressed={saved}
                    onClick={onSave}
                  >
                    <Icon name={saved ? "check" : "folder-add"} size={16} />
                  </button>
                ) : null}
                {trailing ? null : more}
              </>
            )}
          </div>
          {trailing ? (
            <div className={styles.tools}>
              {search}
              {onQueue ? (
                <button type="button" className={`${glass} ${look.wide}`} onClick={onQueue} disabled={idle}>
                  <Icon name="add" size={16} />
                  {t("ui.entity.add_to_queue")}
                </button>
              ) : null}
              {sort}
              {more}
            </div>
          ) : null}
        </div>
      </div>
      <Menu open={menuAnchor !== null} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} items={menu} />
    </header>
  );
}

/** The head's fact chips: an optional year, then the count and the total length in one chip. */
export function Facts({ year, count, length, updated }: { year?: string; count: string; length?: string; updated?: string }): JSX.Element {
  return (
    <>
      {year ? <span className={look.chip}>{year}</span> : null}
      <span className={look.chip}>
        <Icon name="track" size={16} />
        <span>{count}</span>
        {length ? <span className={look.dot} aria-hidden="true" /> : null}
        {length ? <span>{length}</span> : null}
      </span>
      {updated ? (
        <span className={look.chip}>
          <Icon name="clock" size={16} />
          <span>{updated}</span>
        </span>
      ) : null}
    </>
  );
}
