import type { JSX } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { useToastStore } from "../../feedback/toastStore";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { restoreDeleted, useRecentlyDeleted } from "../../ports/library";
import { MediaRow } from "../MediaRow";
import styles from "./NewPlaylistSheet.module.css";

export function RecentlyDeletedSheet({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const items = useRecentlyDeleted((state) => state.items);

  const restore = (id: string) =>
    void restoreDeleted(id).catch(() => useToastStore.getState().show({ message: t("ui.library.restore_failed"), variant: "error" }));

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.library.recently_deleted")} actions={[{ label: t("common.close"), onClick: onClose }]}>
      {items.length === 0 ? <p className={styles.lead}>{t("ui.library.recently_deleted_empty")}</p> : null}
      {items.map((item) => (
        <MediaRow
          key={item.id}
          data-deleted-row=""
          leading={<Icon name="playlist" size={24} />}
          title={item.title}
          subtitle={t("common.tracks", { count: item.trackCount })}
          extra={
            <Button size="s" onClick={() => restore(item.id)}>
              {t("ui.library.restore")}
            </Button>
          }
        />
      ))}
    </Sheet>
  );
}
