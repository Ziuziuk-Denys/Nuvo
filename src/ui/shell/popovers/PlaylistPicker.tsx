import { useState, type JSX } from "react";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { usePlaylistsList } from "../../ports/library";
import styles from "./popovers.module.css";

/** Your other playlists, most recently changed first, with the Add to playlist list's search and rows; a pick hands its id back. */
export function PlaylistPicker({ exclude, onPick }: { exclude: string; onPick(id: string, title: string): void }): JSX.Element {
  const { t } = useTranslation();
  const { data } = usePlaylistsList();
  const [query, setQuery] = useState("");
  const all = data.playlists.filter((playlist) => playlist.id !== exclude).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const needle = query.trim().toLowerCase();
  const playlists = needle ? all.filter((playlist) => playlist.title.toLowerCase().includes(needle)) : all;
  return (
    <div className={styles.addBody}>
      {all.length > 0 ? (
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input autoFocus value={query} placeholder={t("ui.add.filter")} aria-label={t("ui.add.filter")} onChange={(event) => setQuery(event.target.value)} />
        </label>
      ) : null}
      {playlists.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Icon name="playlist" size={16} />
          </span>
          <p>{all.length === 0 ? t("ui.add.empty") : t("ui.add.no_match")}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {playlists.map((playlist) => (
            <button key={playlist.id} type="button" data-row="" className={styles.pick} onClick={() => onPick(playlist.id, playlist.title)}>
              <Cover src={playlist.coverUrl} size={44} radius={8} />
              <span className={styles.pickText}>
                <span className={styles.pickTitle}>{playlist.title}</span>
                <span className={styles.pickMeta}>{String(playlist.trackCount)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
