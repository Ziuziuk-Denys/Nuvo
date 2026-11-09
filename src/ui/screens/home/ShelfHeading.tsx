import type { JSX } from "react";
import { IconButton } from "../../components/IconButton";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { useTranslation } from "../../ports/i18n";
import styles from "./SavedShelf.module.css";

export function ShelfHeading({ icon, title, busy = false, onRefresh }: { icon: IconName; title: string; busy?: boolean; onRefresh?: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.heading}>
      <Icon name={icon} size={24} />
      <h2 className={styles.title}>{title}</h2>
      {onRefresh ? (
        <IconButton
          icon="refresh"
          size="s"
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
