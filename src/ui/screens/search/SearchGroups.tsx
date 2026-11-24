import type { CSSProperties, JSX, KeyboardEvent, ReactNode } from "react";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { Icon } from "../../icons/Icon";
import { coverSrc, useCoverColors } from "../../ports/covers";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { isSoundCloudId, usePlayerStore } from "../../ports/player";
import type { SearchResult } from "../../ports/search";
import { formatDuration } from "../entity/entityModel";
import { MediaRow } from "../MediaRow";
import { useUnavailable } from "../entity/EntityTracks";
import { DislikeButton } from "../../recs/DislikeButton";
import { useTrackMenu } from "../entity/useTrackMenu";
import { subtitleOf, type GroupKey, type SearchFilter, type SearchGroups as Groups } from "./searchModel";
import { ArtistLinks } from "../../shell/ArtistLinks";
import look from "../look.module.css";
import styles from "./Search.module.css";

const SAMPLE_PX = 64;
const OTHER_GROUPS: GroupKey[] = ["artists", "albums", "playlists"];

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
              subtitle={<ArtistLinks track={track} />}
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

const shapeOf = (result: SearchResult) => (result.kind === "artist" ? "circle" : "square");

function EntityRows({ results, onActivate }: { results: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.rows}>
      {results.map((result) => (
        <MediaRow
          key={`${result.kind}:${result.id}`}
          leading={<Cover src={result.cover} size={48} radius={8} shape={shapeOf(result)} fetchPriority="low" />}
          title={result.title}
          subtitle={subtitleOf(result, t)}
          onActivate={() => onActivate(result)}
        />
      ))}
    </div>
  );
}

function EntityTiles({ results, onActivate }: { results: SearchResult[]; onActivate: (result: SearchResult) => void }) {
  return (
    <div className={styles.tiles}>
      {results.map((result) => (
        <button key={`${result.kind}:${result.id}`} type="button" className={styles.tile} data-kind={result.kind} onClick={() => onActivate(result)}>
          <span className={styles.tileArt}>
            <Cover src={result.cover} size={180} radius={10} shape={shapeOf(result)} fetchPriority="low" />
          </span>
          <span className={styles.tileTitle}>{result.title}</span>
          {result.subtitle ? <span className={styles.tileSubtitle}>{result.subtitle}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TopCard({
  top,
  onActivate,
  onPlay,
}: {
  top: SearchResult;
  onActivate: (result: SearchResult) => void;
  onPlay: (result: SearchResult) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { color2 } = useCoverColors(coverSrc(top.cover, SAMPLE_PX, 1) || undefined);
  const lit = { "--lit": color2 } as CSSProperties;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (!event.repeat) onActivate(top);
  };
  return (
    <section className={styles.group} aria-label={t("ui.search.top")}>
      <div className={styles.topHeading}>
        <h2 className={styles.heading}>{t("ui.search.top")}</h2>
      </div>
      <div role="button" tabIndex={0} data-top="" className={styles.top} style={lit} onClick={() => onActivate(top)} onKeyDown={onKeyDown}>
        <Cover src={top.cover} size={112} radius={10} shape={top.kind === "artist" ? "circle" : "square"} fetchPriority="high" />
        <span className={styles.topText}>
          <span className={styles.topLine}>
            <span className={styles.topTitle}>{top.title}</span>
            {songBadge(top, t)}
          </span>
          <span className={styles.topSubtitle}>{top.track ? <ArtistLinks track={top.track} /> : subtitleOf(top, t)}</span>
        </span>
        <span className={styles.topActions} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <button type="button" className={`${look.pill} ${look.solid}`} onClick={() => onPlay(top)}>
            <Icon name="play" size={16} />
            {t("ui.entity.play")}
          </button>
          {top.track ? null : (
            <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => onActivate(top)}>
              {t("ui.palette.open")}
            </button>
          )}
        </span>
        {top.track ? (
          <span className={styles.topEnd} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DislikeButton track={top.track} />
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function LeadList({ groups, filter, onActivate }: Pick<SearchGroupsProps, "groups" | "filter" | "onActivate">): JSX.Element {
  const { t } = useTranslation();
  const key = filter === "all" ? "songs" : filter;
  const results = groups[key];
  return (
    <section className={styles.group} aria-label={t(`ui.search.tab_${key}`)}>
      {key === "songs" ? <SongRows songs={results} onActivate={onActivate} /> : <EntityRows results={results} onActivate={onActivate} />}
    </section>
  );
}

export function OtherGroups({ groups, hasMore, onShowAll, onActivate }: Omit<SearchGroupsProps, "filter">): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {OTHER_GROUPS.filter((key) => groups[key].length > 0).map((key) => {
        const title = t(`ui.search.tab_${key}`);
        return (
          <section key={key} className={styles.group} aria-label={title}>
            <div className={styles.headingLine}>
              <h2 className={styles.heading}>{title}</h2>
              {hasMore(key) ? (
                <button type="button" className={styles.more} onClick={() => onShowAll(key)}>
                  {t("ui.search.show_all")}
                </button>
              ) : null}
            </div>
            <EntityTiles results={groups[key]} onActivate={onActivate} />
          </section>
        );
      })}
    </>
  );
}
