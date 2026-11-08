import { useEffect, useRef, useState, type JSX } from "react";
import { Cover } from "../components/Cover";
import { IconButton } from "../components/IconButton";
import { Menu } from "../components/Menu";
import { useTranslation } from "../ports/i18n";
import { playSuggestions, suggest, type Suggested } from "../ports/recs";
import { formatDuration } from "../screens/entity/entityModel";
import look from "../screens/look.module.css";
import { MediaRow } from "../screens/MediaRow";
import { DislikeButton } from "./DislikeButton";
import { markNotInterested } from "./notInterested";
import { notInterestedItems } from "./notInterestedItems";
import { reasonText } from "./reasonText";
import styles from "./PlaylistSuggestions.module.css";

export interface PlaylistSuggestionsProps {
  playlistId: string;
  /** The playlist's track ids in order; a pick the playlist already has never shows. */
  trackIds: readonly string[];
  /** Adds one pick to the playlist. */
  onAdd(track: Suggested): Promise<void>;
}

/** Ten suggestions under an own playlist, in its own track rows: add, play, Not interested, Refresh. */
export function PlaylistSuggestions({ playlistId, trackIds, onAdd }: PlaylistSuggestionsProps): JSX.Element | null {
  const { t } = useTranslation();
  const [items, setItems] = useState<Suggested[]>([]);
  const [round, setRound] = useState(0);
  const [menu, setMenu] = useState<{ track: Suggested; at: { x: number; y: number } } | null>(null);
  const latest = useRef(trackIds);
  const ready = trackIds.length > 0;

  useEffect(() => {
    latest.current = trackIds;
  }, [trackIds]);

  // an add changes the ids but must not replace the list: only a new playlist, Refresh or the first tracks ask again
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void suggest(playlistId, latest.current).then((found) => {
      if (live) setItems(found);
    });
    return () => {
      live = false;
    };
  }, [playlistId, round, ready]);

  const drop = ({ id }: { id: string }) => setItems((list) => list.filter((item) => item.id !== id));
  const shown = items.filter((item) => !trackIds.includes(item.id));
  if (shown.length === 0) return null;
  return (
    <section className={styles.suggestions} aria-label={t("ui.recs.suggest.title")}>
      <div className={look.sectionHead}>
        <h2 className={look.sectionTitle}>{t("ui.recs.suggest.title")}</h2>
        <button type="button" className={look.sectionLink} onClick={() => setRound((n) => n + 1)}>
          {t("ui.recs.suggest.refresh")}
        </button>
      </div>
      <div className={styles.rows}>
        {shown.map((track, index) => (
          <MediaRow
            key={track.id}
            data-track-row=""
            data-selected={menu?.track.id === track.id ? "" : undefined}
            leading={<Cover src={track.coverUrl} size={48} radius={8} fetchPriority="low" />}
            title={track.title}
            subtitle={[track.artists, reasonText(track.reason ?? null, t)].filter(Boolean).join(" · ")}
            meta={formatDuration(track.durationMs)}
            onActivate={() => playSuggestions(playlistId, shown, index)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ track, at: { x: event.clientX, y: event.clientY } });
            }}
            extra={
              <span className={styles.actions}>
                {/* a failed add toasts from the api layer; the pick stays */}
                <IconButton icon="add" label={t("ui.recs.suggest.add")} onClick={() => void onAdd(track).catch(() => undefined)} />
                <DislikeButton track={track} onDisliked={drop} />
              </span>
            }
          />
        ))}
      </div>
      <Menu
        open={menu !== null}
        anchor={null}
        at={menu?.at}
        onClose={() => setMenu(null)}
        items={
          menu
            ? notInterestedItems(menu.track, t, (picked, scope) => {
                void markNotInterested(picked, scope);
                drop(picked);
              })
            : []
        }
      />
    </section>
  );
}
