import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { ApiError, useAddPlaylistTracks, useModalStore, usePlaylistsList } from "../../ports/library";
import { snapshotOf } from "../../ports/imports";
import type { Track } from "../../ports/player";
import { useImportsUi } from "../../screens/imports/importsUi";
import styles from "./popovers.module.css";

const ADDED_HOLD_MS = 1200;

type Outcome = { playlistId: string; kind: "added" | "already" | "failed" };

/** Up and Down walk from the search field through the rows and back, so a pick never needs the pointer. */
function walkRows(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>("input, button[data-row]")];
  const index = stops.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  stops[Math.min(stops.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))].focus();
}

/**
 * The track being added, a search field, the playlists most recently changed first, and New playlist.
 * A pick adds the track, says "Added" on that row for 1.2 s and then closes;
 * a playlist that already holds it says so and stays open for another pick.
 */
export function AddToPlaylistPopover({
  track,
  tracks,
  onDone,
}: {
  track: Track;
  /** A selection: every one is added; `track` is the one shown on the card. */ tracks?: readonly Track[];
  onDone(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading } = usePlaylistsList();
  const addTrack = useAddPlaylistTracks();
  const openCreatePlaylist = useModalStore((state) => state.openCreatePlaylist);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const busy = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const all = [...data.playlists].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const needle = query.trim().toLowerCase();
  const playlists = needle ? all.filter((playlist) => playlist.title.toLowerCase().includes(needle)) : all;

  const add = async (playlistId: string) => {
    // one add at a time, and none after the "Added" hold has started
    if (busy.current) return;
    busy.current = true;
    setPending(playlistId);
    try {
      const batch = tracks ?? [track];
      let added = 0;
      let failure: unknown = null;
      for (const item of batch) {
        try {
          await addTrack.mutateAsync({ playlistId, track: item });
          added += 1;
        } catch (error) {
          failure = error;
          // a track the playlist already holds is not a failure of the rest
          if (!(error instanceof ApiError && error.status === 409)) break;
        }
      }
      if (added === 0 && failure) throw failure;
      setOutcome({ playlistId, kind: "added" });
      closeTimer.current = window.setTimeout(onDone, ADDED_HOLD_MS);
      return;
    } catch (error) {
      // the core answers 409 when the playlist already holds the track
      setOutcome({ playlistId, kind: error instanceof ApiError && error.status === 409 ? "already" : "failed" });
    } finally {
      setPending(null);
    }
    busy.current = false;
  };

  const newPlaylist = () => {
    onDone();
    openCreatePlaylist(undefined, track);
  };

  // the song joins the playlist the link import creates
  const fromLink = () => {
    onDone();
    useImportsUi.getState().openImport({ pendingTrack: snapshotOf(track) });
  };

  const metaFor = (playlistId: string, count: number) => {
    if (outcome?.playlistId !== playlistId) return String(count);
    if (outcome.kind === "added") return t("ui.add.added");
    if (outcome.kind === "already") return t("ui.add.already");
    return t("ui.add.failed");
  };

  const loading = isLoading && all.length === 0;

  return (
    <div className={styles.addBody} onKeyDown={walkRows}>
      <div className={styles.trackCard}>
        <Cover src={track.coverUrl ?? ""} size={40} radius={6} />
        <span className={styles.trackText}>
          <span className={styles.trackTitle}>{track.title}</span>
          <span className={styles.trackArtist}>{tracks && tracks.length > 1 ? t("ui.bulk.selected", { count: tracks.length }) : track.artists}</span>
        </span>
      </div>
      {all.length > 0 ? (
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input autoFocus value={query} placeholder={t("ui.add.filter")} aria-label={t("ui.add.filter")} onChange={(event) => setQuery(event.target.value)} />
          {query ? (
            <button type="button" className={styles.clear} aria-label={t("ui.clear")} onClick={() => setQuery("")}>
              <Icon name="clear-circle" size={16} />
            </button>
          ) : null}
        </label>
      ) : null}
      {loading ? (
        <div className={styles.list} aria-hidden="true">
          {[0, 1, 2].map((slot) => (
            <span key={slot} className={styles.ghostRow} />
          ))}
        </div>
      ) : all.length === 0 || playlists.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Icon name="playlist" size={16} />
          </span>
          <p>{all.length === 0 ? t("ui.add.empty") : t("ui.add.no_match")}</p>
        </div>
      ) : (
        <div className={styles.list} data-busy={pending !== null ? "" : undefined} aria-busy={pending !== null}>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              data-row=""
              className={styles.pick}
              data-done={outcome?.playlistId === playlist.id && outcome.kind === "added" ? "" : undefined}
              onClick={() => void add(playlist.id)}
            >
              <Cover src={playlist.coverUrl} size={44} radius={8} />
              <span className={styles.pickText}>
                <span className={styles.pickTitle}>{playlist.title}</span>
                <span className={styles.pickMeta}>{metaFor(playlist.id, playlist.trackCount)}</span>
              </span>
              {pending === playlist.id ? (
                <span className={styles.spinner} aria-hidden="true" />
              ) : (
                <span className={styles.plus} aria-hidden="true">
                  <Icon name={outcome?.playlistId === playlist.id && outcome.kind === "added" ? "check" : "add"} size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={styles.newButton} onClick={newPlaylist}>
        <Icon name="add" size={16} />
        {t("ui.add.new")}
      </button>
      <button type="button" className={styles.newButton} onClick={fromLink}>
        <Icon name="link" size={16} />
        {t("ui.add.from_link")}
      </button>
    </div>
  );
}
