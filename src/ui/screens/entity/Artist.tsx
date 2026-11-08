import { useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { EmptyState } from "../../components/EmptyState";
import type { MenuItem } from "../../components/Menu";
import { usePageBackdrop } from "../../ports/backdrop";
import { startArtistRadio, useArtist, type ArtistAlbumViewModel } from "../../ports/catalog";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { usePlayerStore, type Track } from "../../ports/player";
import { navigateWithTransition } from "../../shell/navigate";
import look from "../look.module.css";
import styles from "./Artist.module.css";
import { usePinItems, useSaved } from "./entityActions";
import { EntityHead } from "./EntityHead";
import { EntityLoading, EntityPage } from "./EntityPage";
import { EntityTracks, entityPlayback, useUnavailable } from "./EntityTracks";

const TOP = 5;
const NO_TRACKS: Track[] = [];

/** /artist?id=: one page per artist, so "Show all" folds back when the id changes. */
export function Artist(): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  return <ArtistPage key={id} id={id} />;
}

function byArtist(track: Track, id: string): boolean {
  return track.artistId === id || (track.artistList ?? []).some((artist) => artist.id === id);
}

/** "61.5M monthly audience", from the catalog's own phrase, else the number of songs. */
function audience(monthly: string | undefined, count: number, t: TFunction): string | undefined {
  const listeners = monthly?.match(/^[\d.,]+\s?[KMBkmb]?/)?.[0];
  if (listeners) return t("artist.monthly_audience", { count: listeners.trim() });
  return count > 0 ? t("ui.home.songs", { count }) : undefined;
}

/** A shelf of releases: 180 px covers in one row that scrolls sideways. */
function Shelf({ title, items, onOpen }: { title: string; items: ArtistAlbumViewModel[]; onOpen: (id: string) => void }): JSX.Element {
  return (
    <section className={styles.section}>
      <h2 className={`${look.sectionTitle} ${styles.shelfTitle}`}>{title}</h2>
      <div className={styles.shelf}>
        {items.map((item) => (
          <button key={item.id} type="button" className={styles.card} onClick={() => onOpen(item.id)}>
            <span className={styles.art}>
              <Cover src={item.coverUrl} size={180} radius={8} />
            </span>
            <span className={styles.cardText}>
              <span className={styles.cardTitle}>{item.title}</span>
              {item.releaseDate ? <span className={styles.cardSubtitle}>{item.releaseDate}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ArtistPage({ id }: { id: string }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading } = useArtist(id || null);
  // a song by this artist the player already holds: the radio's seed when the catalog is out of reach
  const localSeed = usePlayerStore((state) => state.queue.find((track) => byArtist(track, id)));
  const [all, setAll] = useState(false);

  const tracks = data?.tracks ?? NO_TRACKS;
  const { saved, toggle, item } = useSaved("artist", id, () => ({
    id,
    name: data?.title ?? "",
    title: data?.title ?? "",
    ...(data?.coverUrl ? { cover: { url: data.coverUrl } } : {}),
  }));
  const name = data?.title ?? item?.title ?? localSeed?.artistList?.find((artist) => artist.id === id)?.name ?? "";
  const cover = data?.coverUrl || item?.imageUrl || "";
  usePageBackdrop(cover || undefined);

  const unavailable = useUnavailable(tracks);
  // the library plays an artist under its name, so the two agree on what is playing
  const { playable, play, playAll, shuffle } = entityPlayback(tracks, unavailable, `artist:${id}`, cover);
  const shown = useMemo(() => (all ? tracks : tracks.slice(0, TOP)).map((track, index) => ({ track, index })), [all, tracks]);
  const albums = data?.albums ?? [];
  const singles = data?.singles ?? [];
  const openAlbum = (albumId: string) => navigateWithTransition(navigate, `/collection?type=album&id=${encodeURIComponent(albumId)}`);
  const pinItems = usePinItems(
    { kind: "artist", id, title: name, subtitle: t("ui.library.kind_artist"), imageUrl: cover || undefined, href: `/artist?id=${encodeURIComponent(id)}` },
    t,
  );

  if (!data && loading) return <EntityLoading kind="artist" />;

  const menu: MenuItem[] = [
    { label: t("ui.entity.start_radio"), onSelect: () => void startArtistRadio(id, playable[0]) },
    ...pinItems,
    {
      label: t("ui.stats.track_stats"),
      onSelect: () => navigateWithTransition(navigate, `/stats/artist?key=${encodeURIComponent(`name:${name.toLowerCase()}`)}`),
    },
  ];
  const head = (actions?: JSX.Element) => (
    <EntityHead
      cover={cover ? <Cover src={cover} size={144} shape="circle" alt="" /> : <span className={styles.initial}>{name.charAt(0)}</span>}
      shape="circle"
      title={name}
      badge={
        data?.verified ? (
          <span role="img" className={styles.verified} aria-label={t("ui.entity.verified")}>
            <Icon name="verified-badge" size={20} />
          </span>
        ) : undefined
      }
      subtitle={data ? audience(data.monthlyListeners, tracks.length, t) : undefined}
      onPlay={playAll}
      onShuffle={shuffle}
      saved={saved}
      onSave={toggle}
      menu={menu}
      idle={playable.length === 0}
      actions={actions}
    />
  );

  if (!data) {
    if (!name) {
      return (
        <EmptyState
          title={t("ui.entity.load_failed_title")}
          message={t("ui.entity.load_failed_message")}
          actions={[{ label: t("ui.entity.back_to_library"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") }]}
        />
      );
    }
    // nothing local to list and no catalog: the name and one way to start listening
    const radio = (
      <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} data-primary="" onClick={() => void startArtistRadio(id, localSeed)}>
        {t("ui.entity.radio_from", { artist: name })}
      </button>
    );
    return <EntityPage kind="artist" head={head(radio)} tracks={null} />;
  }

  return (
    <EntityPage
      kind="artist"
      head={head()}
      tracks={
        <div className={styles.sections}>
          {tracks.length > 0 ? (
            <section className={styles.section}>
              <div className={look.sectionHead}>
                <h2 className={look.sectionTitle}>{t("artist.popular_songs")}</h2>
                {!all && tracks.length > TOP ? (
                  <button type="button" className={look.sectionLink} onClick={() => setAll(true)}>
                    {t("ui.entity.show_all")}
                  </button>
                ) : null}
              </div>
              <div className={styles.songs}>
                <EntityTracks shown={shown} tracks={tracks} unavailable={unavailable} onPlay={play} />
              </div>
            </section>
          ) : null}
          {albums.length > 0 ? <Shelf title={t("ui.entity.albums")} items={albums} onOpen={openAlbum} /> : null}
          {singles.length > 0 ? <Shelf title={t("ui.entity.singles")} items={singles} onOpen={openAlbum} /> : null}
        </div>
      }
    />
  );
}
