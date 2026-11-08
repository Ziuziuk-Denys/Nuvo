import type { JSX } from "react";
import { Cover } from "../components/Cover";
import { useTranslation } from "../ports/i18n";
import { usePlaylistsList } from "../ports/library";
import { setPlaylistExcluded, useExcludedPlaylists } from "../ports/recs";
import { SettingGroup, SettingRow } from "../screens/settings/controls";
import styles from "./HiddenList.module.css";

/** Settings > Hidden: the playlists left out of recommendations, each with Use again. */
export function ExcludedPlaylists(): JSX.Element | null {
  const { t } = useTranslation();
  const ids = useExcludedPlaylists();
  const playlists = usePlaylistsList().data.playlists;
  if (ids === null) return null;
  // a deleted playlist's row stays in the daemon but has nothing to show
  const shown = playlists.filter((playlist) => ids.includes(playlist.id));
  return (
    <SettingGroup label={t("ui.recs.excluded.title")}>
      {shown.length === 0 ? <p className={styles.line}>{t("ui.recs.excluded.empty")}</p> : null}
      {shown.map((playlist) => (
        <SettingRow
          key={playlist.id}
          icon={<Cover src={playlist.coverUrls[0] ?? playlist.coverUrl} size={32} radius={6} />}
          title={playlist.title}
          control={
            <button type="button" className={styles.undo} onClick={() => void setPlaylistExcluded(playlist.id, false).catch(() => undefined)}>
              {t("ui.recs.excluded.undo")}
            </button>
          }
        />
      ))}
    </SettingGroup>
  );
}
