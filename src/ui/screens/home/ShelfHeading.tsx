import type { JSX } from "react";
import { IconButton } from "../../components/IconButton";
import { useTranslation } from "../../ports/i18n";
import styles from "./SavedShelf.module.css";

export function ShelfHeading({ title, busy = false, onRefresh }: { title: string; busy?: boolean; onRefresh?: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.heading}>
      <h2 className={styles.title}>{title}</h2>
      {onRefresh ? (
        <IconButton
          icon="refresh"
          size="s"
          tone="solo"
          label={t("ui.home.refresh")}
          className={styles.refresh}
          data-refresh
          data-busy={busy ? "" : undefined}
          aria-busy={busy}
          onClick={onRefresh}
        />
      ) : null}
    </div>
  );
}
