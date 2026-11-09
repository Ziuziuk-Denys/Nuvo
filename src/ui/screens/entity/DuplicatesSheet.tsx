import type { JSX } from "react";
import { Sheet } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import type { Track } from "../../ports/player";
import { extraItemIds } from "./duplicates";
import styles from "./Tidy.module.css";

export interface DuplicatesSheetProps {
  open: boolean;
  groups: Track[][];
  onClose(): void;
  onRemove(itemIds: string[]): void;
}

export function DuplicatesSheet({ open, groups, onClose, onRemove }: DuplicatesSheetProps): JSX.Element | null {
  const { t } = useTranslation();
  const extra = extraItemIds(groups);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("ui.library.duplicates_title")}
      actions={[
        { label: t("ui.library.cancel"), onClick: onClose },
        { label: t("ui.library.remove_duplicates", { value: extra.length }), primary: true, disabled: extra.length === 0, onClick: () => onRemove(extra) },
      ]}
    >
      {groups.length === 0 ? (
        <p className={styles.groups}>{t("ui.library.no_duplicates")}</p>
      ) : (
        <ul className={styles.groups}>
          {groups.map((group) => (
            <li key={group[0].playlistItemId ?? group[0].id}>{`${group[0].title} · ${group[0].artists} · ×${group.length}`}</li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
