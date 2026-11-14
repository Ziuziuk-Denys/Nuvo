import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { Icon } from "../../icons/Icon";
import { openExternal } from "../../ports/system";
import { DONATE_URL } from "./donate";
import styles from "./sections.module.css";

export function DonateLink({ url = DONATE_URL }: { url?: string }): JSX.Element | null {
  const { t } = useTranslation();
  if (!url) return null;
  return (
    <button type="button" className={styles.action} onClick={() => openExternal(url)}>
      {t("ui.settings.support")}
      <Icon name="external" size={16} className={styles.actionIcon} />
    </button>
  );
}
