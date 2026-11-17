import { useContext, type JSX } from "react";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { openExternal } from "../../ports/system";
import { SearchQuery, SettingGroup } from "./controls";
import { matchesQuery } from "./sections";
import styles from "./sections.module.css";

const LINKS = [
  { key: "ui.settings.community.channel", icon: "telegram", url: "https://t.me/getnuvo" },
  { key: "ui.settings.community.chat", icon: "telegram", url: "https://t.me/getnuvo_chat" },
  { key: "ui.settings.community.discord", icon: "discord", url: "https://discord.gg/rHz3dg9S9T" },
] as const;

export function CommunityLinks(): JSX.Element | null {
  const { t } = useTranslation();
  const query = useContext(SearchQuery);
  const shown = LINKS.filter((link) => matchesQuery(query, ["ui.settings.community.title", link.key]));
  if (shown.length === 0) return null;
  return (
    <SettingGroup label={t("ui.settings.community.title")}>
      {shown.map((link) => (
        <button key={link.key} type="button" className={styles.action} onClick={() => openExternal(link.url)}>
          <span className={styles.actionLead}>
            <Icon name={link.icon} size={18} className={styles.actionMark} />
            {t(link.key)}
          </span>
          <Icon name="external" size={16} className={styles.actionIcon} />
        </button>
      ))}
    </SettingGroup>
  );
}
