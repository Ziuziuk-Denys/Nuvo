import { useDeferredValue, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Menu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useCollection, type CollectionPageData } from "../../ports/catalog";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, type Track } from "../../ports/player";
import { useHomeMix } from "../../ports/recs";
import { navigateWithTransition } from "../../shell/navigate";
import { MIX_PREFIX, mixText, mosaicCovers } from "../home/homeModel";
import look from "../look.module.css";
import { SearchField } from "../SearchField";
import { usePinItems, useSaved } from "./entityActions";
import { EntityHead, Facts } from "./EntityHead";
import { EntityLoading, EntityPage } from "./EntityPage";
import { formatTotal, matchTracks, orderTracks, totalMs, type TrackOrder } from "./entityModel";
import pageStyles from "./EntityPage.module.css";
import { EntityTracks, entityPlayback, useUnavailable } from "./EntityTracks";

const NO_TRACKS: Track[] = [];
const SORTS: TrackOrder[] = ["default", "title", "duration"];

export function Album(): JSX.Element {
  const [params] = useSearchParams();
  const kind = params.get("type") === "playlist" ? "playlist" : "album";
  const id = params.get("id") ?? "";
  return <AlbumPage key={`${kind}:${id}`} kind={kind} id={id} />;
}

function AlbumPage({ kind, id }: { kind: "album" | "playlist"; id: string }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // a Home mix lives in the daemon; the catalog has no playlist by its id
  const mixId = kind === "playlist" && id.startsWith(MIX_PREFIX) ? id : null;
  const catalogPage = useCollection(kind, id && !mixId ? id : null);
  const mix = useHomeMix(mixId);
  const mixData = useMemo((): CollectionPageData | null => {
    if (!mix) return null;
    const text = mixText(mix, t);
    return {
      type: "playlist",
      id: mix.id,
      title: text.title,
      author: text.subtitle,
      coverUrl: mosaicCovers(mix.tracks)[0] ?? "",
      tracks: mix.tracks.map((track) => ({ ...track, playCount: track.playCount ?? 0 })),
    };
  }, [mix, t]);
  const { data, loading } = mixId ? { data: mixData, loading: mix === undefined } : catalogPage;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TrackOrder>("default");
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  const tracks = data?.tracks ?? NO_TRACKS;
  const cover = data?.coverUrl ?? "";
  // a mix plays under the same context as from Home
  const context = mixId ? `mix:${id}` : `${kind}:${id}`;
  const by = data?.artists?.map((artist) => artist.name).join(", ") || data?.author;
  usePageBackdrop(cover || undefined);

  const unavailable = useUnavailable(tracks);
  const { playable, play, playAll, shuffle } = entityPlayback(tracks, unavailable, context, cover);
  const sorted = useMemo(() => orderTracks([...tracks], sort), [tracks, sort]);
  const shown = useMemo(() => matchTracks(sorted, deferredQuery) ?? sorted.map((track, index) => ({ track, index })), [sorted, deferredQuery]);
  const href = `/collection?type=${kind}&id=${encodeURIComponent(id)}`;

  const { saved, toggle } = useSaved(kind, id, () => ({
    id,
    title: data?.title ?? "",
    ...(cover ? { cover: { url: cover } } : {}),
    ...(data?.year ? { year: data.year } : {}),
    ...(data?.artists ? { artists: data.artists } : {}),
    ...(data?.author ? { author: data.author } : {}),
    trackCount: tracks.length,
  }));
  const pinItems = usePinItems(
    {
      kind,
      id,
      title: data?.title ?? "",
      subtitle: kind === "album" ? t("ui.library.kind_album", { artist: by ?? "" }) : t("ui.library.kind_playlist", { owner: by ?? "" }),
      imageUrl: cover || undefined,
      href,
      trackCount: tracks.length,
    },
    t,
  );

  if (!data && loading) return <EntityLoading kind={kind} />;

  if (!data) {
    return (
      <EmptyState
        title={t(mixId ? "ui.entity.mix_gone_title" : "ui.entity.load_failed_title")}
        message={t(mixId ? "ui.entity.mix_gone_message" : "ui.entity.load_failed_message")}
        actions={[{ label: t("ui.entity.back_to_library"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") }]}
      />
    );
  }

  const count = tracks.length;
  const menu: MenuItem[] = [
    ...(id && !mixId ? [{ label: t(saved ? "ui.library.remove" : "ui.entity.save"), onSelect: toggle }] : []),
    ...pinItems,
    { label: t("ui.entity.start_radio"), disabled: playable.length === 0, onSelect: () => void playerEngine.startRadioStation(playable[0]) },
  ];

  const search = (
    <SearchField
      value={query}
      onChange={setQuery}
      placeholder={t(kind === "album" ? "track_search.placeholder_album" : "track_search.placeholder_playlist")}
      clearLabel={t("ui.clear")}
    />
  );
  const sortButton = (
    <button
      type="button"
      className={look.icon}
      aria-label={t(`ui.entity.sort_${sort}`)}
      aria-haspopup="menu"
      aria-expanded={sortAnchor !== null}
      disabled={count < 2}
      onClick={(event) => setSortAnchor(sortAnchor ? null : event.currentTarget)}
    >
      <Icon name="sort-lines" size={18} />
    </button>
  );
  const oneArtist = kind === "album" && tracks.every((track) => track.artists === by);
  const mosaic = mix ? mosaicCovers(mix.tracks) : [];
  let art = <Icon name="album" size={24} className={pageStyles.glyph} />;
  if (mosaic.length === 4) {
    art = (
      <span className={pageStyles.mosaic}>
        {mosaic.map((url) => (
          <Cover key={url} src={url} size={84} radius={0} />
        ))}
      </span>
    );
  } else if (cover) {
    art = <Cover src={cover} size={168} alt="" />;
  }

  return (
    <>
      <EntityPage
        kind={kind}
        head={
          <EntityHead
            cover={art}
            title={data.title}
            subtitle={by}
            chips={<Facts year={data.year ? String(data.year) : undefined} count={t("common.tracks", { count })} length={formatTotal(totalMs(tracks), t)} />}
            onPlay={playAll}
            onShuffle={shuffle}
            onQueue={() => playable.forEach((track) => playerEngine.addToQueue(track))}
            menu={menu}
            search={search}
            sort={sortButton}
            idle={playable.length === 0}
          />
        }
        tracks={
          <EntityTracks
            shown={shown}
            tracks={sorted}
            unavailable={unavailable}
            onPlay={play}
            numbered={kind === "album" && sort === "default"}
            hideArtists={oneArtist}
          />
        }
      />
      <Menu
        open={sortAnchor !== null}
        anchor={sortAnchor}
        onClose={() => setSortAnchor(null)}
        items={SORTS.map((key) => ({ label: t(`ui.entity.sort_${key}`), onSelect: () => setSort(key) }))}
      />
    </>
  );
}
