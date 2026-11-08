import type { JSX } from "react";
import { Button } from "../../components/Button";
import { useTranslation } from "../../ports/i18n";
import styles from "./TrackBulkBar.module.css";

export interface TrackBulkBarProps {
  count: number;
  onAddToPlaylist(anchor: HTMLElement): void;
  onLike(): void;
  onQueue(): void;
  /** Own playlists only. */
  onRemove?(): void;
  /** Own playlists only: moves the selection to another playlist. */
  onMove?(anchor: HTMLElement): void;
  onClear(): void;
}

/** A quiet bar that appears while rows are selected: add to a playlist, like, queue, move, remove. */
export function TrackBulkBar({ count, onAddToPlaylist, onLike, onQueue, onRemove, onMove, onClear }: TrackBulkBarProps): JSX.Element | null {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className={styles.bar} role="toolbar" aria-label={t("ui.bulk.label")}>
      <span className={styles.count} aria-live="polite">
        {t("ui.bulk.selected", { count })}
      </span>
      <Button size="s" onClick={(event) => onAddToPlaylist(event.currentTarget)}>
        {t("ui.entity.add_to_playlist")}
      </Button>
      <Button size="s" onClick={onLike}>
        {t("ui.bulk.like")}
      </Button>
      <Button size="s" onClick={onQueue}>
        {t("ui.entity.add_to_queue")}
      </Button>
      {onMove ? (
        <Button size="s" onClick={(event) => onMove(event.currentTarget)}>
          {t("ui.library.move_to")}
        </Button>
      ) : null}
      {onRemove ? (
        <Button size="s" onClick={onRemove}>
          {t("ui.bulk.remove")}
        </Button>
      ) : null}
      <Button size="s" variant="text" onClick={onClear}>
        {t("ui.bulk.clear")}
      </Button>
    </div>
  );
}
