import { useEffect, useMemo, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { EmptyState } from "../../components/EmptyState";
import type { MenuItem } from "../../components/Menu";
import { startArtistRadio, useArtist, type ArtistAlbumViewModel } from "../../ports/catalog";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { usePlayerStore, type Track } from "../../ports/player";
import { playLibraryEntry } from "../../ports/library";
import { ArtistLinks } from "../../shell/ArtistLinks";
import { navigateWithTransition } from "../../shell/navigate";
import { openArtist } from "../../shell/openArtist";
import look from "../look.module.css";
import { MediaRowPlaceholder } from "../MediaRow";
import styles from "./Artist.module.css";
import { usePinItems, useSaved } from "./entityActions";
import { ArtistHero, PersonalLine, SlimBar } from "./ArtistHero";
import { latestRelease } from "./artistModel";
import { EntityButtons } from "./EntityHead";
import { EntityLoading, EntityPage } from "./EntityPage";
import { ReleaseCard, Shelf } from "./ReleaseShelf";
import { EntityTracks, entityPlayback, useUnavailable } from "./EntityTracks";

const TOP = 6;
const NO_TRACKS: Track[] = [];

export function Artist(): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const name = params.get("name") ?? "";
  return <ArtistPage key={id || name} pageId={id} givenName={name} />;
}

function byArtist(track: Track, id: string): boolean {
  return track.artistId === id || (track.artistList ?? []).some((artist) => artist.id === id);
}

function listeners(monthly: string | undefined, t: TFunction): string | null {
  const count = monthly?.match(/^[\d.,]+\s?[KMBkmb]?/)?.[0];
  return count ? t("artist.monthly_audience", { count: count.trim() }) : null;
}

const LATEST_LABEL = { album: "ui.artist.latest_album", ep: "ui.artist.latest_ep", single: "ui.artist.latest_single" } as const;
const WIDE_PAGE_PX = 1700;

function onResize(change: () => void): () => void {
  window.addEventListener("resize", change);
  return () => window.removeEventListener("resize", change);
}

function useWidePage(): boolean {
  return useSyncExternalStore(onResize, () => window.innerWidth >= WIDE_PAGE_PX);
}

function Latest({ release, onOpen }: { release: ArtistAlbumViewModel; onOpen: (id: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const play = () => void playLibraryEntry({ kind: "album", id: release.id, title: release.title, cover: release.coverUrl }, `album:${release.id}`);
  return (
    <div className={styles.latest}>
      <button type="button" className={styles.latestCover} aria-label={release.title} onClick={() => onOpen(release.id)}>
        <Cover src={release.coverUrl} size={320} radius={14} />
      </button>
      <div className={styles.latestLine}>
        <button type="button" className={styles.latestText} tabIndex={-1} onClick={() => onOpen(release.id)}>
          <span className={styles.latestTitle}>{release.title}</span>
          <span className={styles.cardSubtitle}>{[t(LATEST_LABEL[release.kind]), release.releaseDate].filter(Boolean).join(", ")}</span>
        </button>
        <button type="button" className={look.icon} aria-label={t("ui.artist.play_release", { title: release.title })} onClick={play}>
          <Icon name="play" size={16} />
        </button>
      </div>
    </div>
  );
}

function ArtistPage({ pageId, givenName }: { pageId: string; givenName: string }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading } = useArtist(pageId || null, givenName);
  const id = pageId || data?.id || "";
  const localSeed = usePlayerStore((state) => state.queue.find((track) => byArtist(track, id)));
  const [all, setAll] = useState(false);

  const tracks = data?.tracks ?? NO_TRACKS;
  const { saved, toggle, item } = useSaved("artist", id, () => ({
    id,
    name: data?.title ?? "",
    title: data?.title ?? "",
    ...(data?.coverUrl ? { cover: { url: data.coverUrl } } : {}),
  }));
  const name = data?.title ?? item?.title ?? localSeed?.artistList?.find((artist) => artist.id === id)?.name ?? givenName;
  const cover = data?.coverUrl || item?.imageUrl || "";

  const unavailable = useUnavailable(tracks);
  // the library plays an artist under its name, so the two agree on what is playing
  const { playable, play, playAll, shuffle } = entityPlayback(tracks, unavailable, `artist:${id}`, cover);
  const [pressed, setPressed] = useState<"play" | "shuffle" | null>(null);
  const partial = loading && data !== null;
  useEffect(() => {
    if (!pressed || partial) return;
    setPressed(null);
    if (pressed === "play") playAll();
    else shuffle();
  }, [pressed, partial, playAll, shuffle]);
  const wide = useWidePage();
  const columns = wide && !all ? 2 : 1;
  const limit = TOP * columns;
  const shown = useMemo(() => (all ? tracks : tracks.slice(0, limit)).map((track, index) => ({ track, index })), [all, limit, tracks]);
  const albums = data?.albums ?? [];
  const singles = data?.singles ?? [];
  const openAlbum = (albumId: string) => navigateWithTransition(navigate, `/collection?type=album&id=${encodeURIComponent(albumId)}`);
  const pinItems = usePinItems(
    { kind: "artist", id, title: name, subtitle: t("ui.library.kind_artist"), imageUrl: cover || undefined, href: `/artist?id=${encodeURIComponent(id)}` },
    t,
  );

  if (!data && loading && !name) return <EntityLoading kind="artist" />;

  const menu: MenuItem[] = [
    { label: t("ui.entity.start_radio"), onSelect: () => void startArtistRadio(id, playable[0]) },
    ...pinItems,
    {
      label: t("ui.stats.track_stats"),
      onSelect: () => navigateWithTransition(navigate, `/stats/artist?key=${encodeURIComponent(`name:${name.toLowerCase()}`)}`),
    },
  ];
  const onPlay = () => setPressed("play");
  const onShuffle = () => setPressed("shuffle");
  const idle = playable.length === 0;
  const personal = <PersonalLine name={name} tracks={tracks} byArtist={(track) => byArtist(track, id)} audience={listeners(data?.monthlyListeners, t)} />;
  const head = (actions?: JSX.Element) => (
    <ArtistHero
      name={name}
      banner={data?.bannerUrl}
      cover={cover}
      actions={
        actions ?? (
          <EntityButtons
            playLabel={t("ui.entity.play")}
            shuffleLabel={t("ui.entity.shuffle")}
            onPlay={onPlay}
            onShuffle={onShuffle}
            saved={saved}
            onSave={toggle}
            menu={menu}
            idle={idle}
          />
        )
      }
      aside={personal}
    />
  );

  if (!data && loading)
    return (
      <EntityPage
        kind="artist"
        head={head()}
        tracks={Array.from({ length: TOP }, (_, index) => (
          <MediaRowPlaceholder key={index} />
        ))}
      />
    );

  if (!data) {
    if (!name || !id) {
      return (
        <EmptyState
          title={name ? t("ui.entity.artist_not_found_title", { name }) : t("ui.entity.load_failed_title")}
          message={t(name ? "ui.entity.artist_not_found_message" : "ui.entity.load_failed_message")}
          actions={[
            name
              ? {
                  label: t("ui.palette.show_all", { query: name }),
                  primary: true,
                  onClick: () => navigateWithTransition(navigate, `/search?q=${encodeURIComponent(name)}`),
                }
              : { label: t("ui.entity.back_to_library"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") },
          ]}
        />
      );
    }
    const radio = (
      <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} data-primary="" onClick={() => void startArtistRadio(id, localSeed)}>
        {t("ui.entity.radio_from", { artist: name })}
      </button>
    );
    return <EntityPage kind="artist" head={head(radio)} tracks={null} />;
  }

  const latest = latestRelease(albums, singles);
  const songList = (from: number, to?: number) => (
    <EntityTracks shown={shown.slice(from, to)} tracks={tracks} unavailable={unavailable} onPlay={play} subtitle={songSubtitle} marks />
  );
  return (
    <>
      <SlimBar name={name} idle={idle} onPlay={onPlay} onShuffle={onShuffle} />
      <EntityPage
        kind="artist"
        head={head()}
        tracks={
          <div className={styles.sections}>
            {tracks.length > 0 ? (
              <div className={styles.lead}>
                {latest ? <Latest release={latest} onOpen={openAlbum} /> : null}
                <section className={styles.section}>
                  <div className={`${look.sectionHead} ${styles.songsHead}`}>
                    <h2 className={look.sectionTitle}>{t("artist.popular_songs")}</h2>
                    {!all && tracks.length > limit ? (
                      <button type="button" className={look.sectionLink} onClick={() => setAll(true)}>
                        {t("ui.entity.show_all")}
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.songs} data-columns={columns}>
                    {columns === 2 ? (
                      <>
                        <div>{songList(0, TOP)}</div>
                        <div>{songList(TOP)}</div>
                      </>
                    ) : (
                      songList(0)
                    )}
                  </div>
                </section>
              </div>
            ) : null}
            {albums.length > 0 ? (
              <Shelf title={t("ui.entity.albums")}>
                {albums.map((release) => (
                  <ReleaseCard key={release.id} release={release} onOpen={openAlbum} />
                ))}
              </Shelf>
            ) : null}
            {singles.length > 0 ? (
              <Shelf title={t("ui.entity.singles")}>
                {singles.map((release) => (
                  <ReleaseCard key={release.id} release={release} onOpen={openAlbum} />
                ))}
              </Shelf>
            ) : null}
            {data.similar.length > 0 ? (
              <Shelf title={t("ui.artist.similar")}>
                {data.similar.map((artist) => (
                  <button key={artist.id} type="button" className={styles.face} onClick={() => openArtist(artist)}>
                    <span className={styles.art}>
                      <Cover src={artist.coverUrl} size={120} shape="circle" />
                    </span>
                    <span className={styles.cardTitle}>{artist.name}</span>
                  </button>
                ))}
              </Shelf>
            ) : null}
          </div>
        }
      />
    </>
  );
}

function songSubtitle(track: Track): ReactNode {
  return (track.artistList?.length ?? 0) > 1 ? <ArtistLinks track={track} /> : track.album?.title;
}
