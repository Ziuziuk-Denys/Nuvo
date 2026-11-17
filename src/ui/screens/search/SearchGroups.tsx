import type { JSX, KeyboardEvent, ReactNode } from "react";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { Icon } from "../../icons/Icon";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { isSoundCloudId, usePlayerStore } from "../../ports/player";
import type { SearchResult } from "../../ports/search";
import { formatDuration } from "../entity/entityModel";
import { MediaRow } from "../MediaRow";
import { useUnavailable } from "../entity/EntityTracks";
import { DislikeButton } from "../../recs/DislikeButton";
import { useTrackMenu } from "../entity/useTrackMenu";
import { subtitleOf, type GroupKey, type SearchFilter, type SearchGroups as Groups } from "./searchModel";
import styles from "./Search.module.css";

const GROUP_ORDER: GroupKey[] = ["songs", "albums", "artists", "playlists"];

export interface SearchGroupsProps {
  groups: Groups;
  filter: SearchFilter;
  hasMore: (key: GroupKey) => boolean;
  onShowAll: (key: GroupKey) => void;
  onActivate: (result: SearchResult) => void;
}

function songBadge(result: SearchResult, t: TFunction): ReactNode {
  const track = result.track;
  if (!track) return undefined;
  const fromSoundCloud = isSoundCloudId(track.id);
  if (!track.explicit && !result.preview && !fromSoundCloud) return undefined;
  return (
    <>
      {track.explicit ? <Explicit label={t("ui.entity.explicit")} /> : null}
      {result.preview ? (
        <span className={styles.preview} title={t("ui.search.preview_hint")}>
          {t("ui.search.preview")}
        </span>
      ) : null}
      {fromSoundCloud ? (
        <span role="img" className={styles.source} aria-label={t("ui.search.from_soundcloud")} title={t("ui.search.from_soundcloud")}>
          <Icon name="soundcloud" size={16} />
        </span>
      ) : null}
    </>
  );
}

function SongRows({ songs, onActivate }: { songs: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  const { t } = useTranslation();
  const currentId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const tracks = songs.map((song) => song.track!);
  const unavailable = useUnavailable(tracks);
  const menu = useTrackMenu();

  return (
    <>
      <div className={styles.rows}>
        {songs.map((song) => {
          const track = song.track!;
          const selected = menu.isOpenFor(track);
          return (
            <MediaRow
              key={song.id}
              data-selected={selected ? "" : undefined}
              leading={<Cover src={song.cover} size={48} radius={8} fetchPriority="low" />}
              title={song.title}
              badge={songBadge(song, t)}
              subtitle={song.subtitle}
              meta={formatDuration(track.durationMs)}
              extra={<DislikeButton track={track} />}
              active={track.id === currentId}
              unavailableReason={unavailable(track) ?? undefined}
              onActivate={() => onActivate(song)}
              onContextMenu={menu.onContextMenu(track)}
              menuLabel={t("ui.entity.more")}
              onMenu={(anchor) => menu.open(track, anchor)}
            />
          );
        })}
      </div>
      {menu.element}
    </>
  );
}

function EntityCover({ result }: { result: SearchResult }) {
  return <Cover src={result.cover} size={48} radius={8} shape={result.kind === "artist" ? "circle" : "square"} fetchPriority="low" />;
}

// albums, artists and playlists spread into columns like Home's songs; songs keep one column for their times
function EntityRows({ results, onActivate }: { results: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  return (
    <div className={styles.columns}>
      {results.map((result) => (
        <MediaRow
          key={`${result.kind}:${result.id}`}
          leading={<EntityCover result={result} />}
          title={result.title}
          subtitle={result.subtitle || undefined}
          onActivate={() => onActivate(result)}
        />
      ))}
    </div>
  );
}

function TopCard({ top, onActivate }: { top: SearchResult; onActivate: (result: SearchResult) => void }) {
  const { t } = useTranslation();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (!event.repeat) onActivate(top);
  };
  return (
    <div role="button" tabIndex={0} data-top="" className={styles.top} onClick={() => onActivate(top)} onKeyDown={onKeyDown}>
      <Cover src={top.cover} size={112} radius={10} shape={top.kind === "artist" ? "circle" : "square"} fetchPriority="high" />
      <span className={styles.topText}>
        <span className={styles.topLine}>
          <span className={styles.topTitle}>{top.title}</span>
          {songBadge(top, t)}
        </span>
        <span className={styles.topSubtitle}>{subtitleOf(top, t)}</span>
      </span>
      {top.track ? (
        <span className={styles.topEnd} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <DislikeButton track={top.track} />
        </span>
      ) : null}
    </div>
  );
}

export function SearchGroups({ groups, filter, hasMore, onShowAll, onActivate }: SearchGroupsProps): JSX.Element {
  const { t } = useTranslation();
  const top = groups.top;
  const all = filter === "all";

  const section = (key: GroupKey) => {
    const results = groups[key];
    if (results.length === 0) return null;
    const title = t(`ui.search.tab_${key}`);
    return (
      <section key={key} className={styles.group} aria-label={title}>
        <div className={styles.headingLine}>
          <h2 className={styles.heading}>{title}</h2>
          {all && hasMore(key) ? (
            <button type="button" className={styles.more} onClick={() => onShowAll(key)}>
              {t("ui.search.show_all")}
            </button>
          ) : null}
        </div>
        {key === "songs" ? <SongRows songs={results} onActivate={onActivate} /> : <EntityRows results={results} onActivate={onActivate} />}
      </section>
    );
  };

  return (
    <>
      {top ? (
        <div className={styles.lead}>
          <section className={styles.group} aria-label={t("ui.search.top")}>
            <div className={styles.headingLine}>
              <h2 className={styles.heading}>{t("ui.search.top")}</h2>
            </div>
            <TopCard top={top} onActivate={onActivate} />
          </section>
          {section("songs")}
        </div>
      ) : (
        section("songs")
      )}
      {GROUP_ORDER.filter((key) => key !== "songs").map(section)}
    </>
  );
}
