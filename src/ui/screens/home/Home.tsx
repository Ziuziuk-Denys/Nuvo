import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { usePageBackdrop } from "../../ports/backdrop";
import { offlineMixes, offlineSongs } from "../../ports/homeShelves";
import { useTranslation } from "../../ports/i18n";
import { useLikedTrackCount, usePlaylistsList } from "../../ports/library";
import { useOfflineMode, useStreamingReachable } from "../../ports/network";
import { playMix, recs, recsChanged, type HomeMix, type Track } from "../../ports/recs";
import { navigateWithTransition } from "../../shell/navigate";
import { useImportsUi } from "../imports/importsUi";
import { useAddMusic } from "../local/addMusic";
import { arrangeMixes, likeArtists, mixText, mosaicCovers, starterGenres } from "./homeModel";
import { MixCard } from "./MixCard";
import { GenreShelf, LikeShelf, ShuffleShelf, SongsForYou, StyleShelf } from "./Shelves";
import { ColdStartSlot, HiddenLinkSlot } from "./slots";
import styles from "./Home.module.css";

const LIKE_SHELVES = 2;
const OFFLINE_MIN_SONGS = 4;

function useHomeMixes(): HomeMix[] | null {
  const [mixes, setMixes] = useState<HomeMix[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void recs.homeMixes().then((all) => {
        if (live) setMixes(arrangeMixes(all));
      });
    load();
    recsChanged.addEventListener("change", load);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", load);
    };
  }, []);
  return mixes;
}

function useOfflineHome(mixes: HomeMix[] | null): { mixes: HomeMix[]; songs: Track[] } | null {
  const [kept, setKept] = useState<{ mixes: HomeMix[]; songs: Track[] } | null>(null);
  useEffect(() => {
    setKept(null);
    if (!mixes) return;
    let live = true;
    void Promise.all([offlineMixes(mixes), offlineSongs()]).then(([playable, songs]) => {
      if (live) setKept({ mixes: playable, songs });
    });
    return () => {
      live = false;
    };
  }, [mixes]);
  return kept;
}

export function Home(): JSX.Element | null {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const all = useHomeMixes();
  const offline = useOfflineMode() || !useStreamingReachable();
  const kept = useOfflineHome(offline ? all : null);
  const addMusic = useAddMusic();
  const { data: likedCount } = useLikedTrackCount();
  const playlists = usePlaylistsList();
  const libraryEmpty = likedCount === 0 && !playlists.isLoading && playlists.data.playlists.length === 0;
  const mixes = offline ? (kept?.mixes ?? null) : all;
  usePageBackdrop(mixes?.[0] ? mosaicCovers(mixes[0].tracks)[0] : undefined);

  if (mixes === null) return null;
  const open = (href: string) => navigateWithTransition(navigate, href);

  const sections: Array<{ key: string; node: ReactNode }> = [];
  const starter = !offline && mixes.length === 0;
  if (starter) {
    sections.push({ key: "cold-start", node: <ColdStartSlot /> });
    for (const { genre, query } of starterGenres(locale)) sections.push({ key: `genre:${genre}`, node: <GenreShelf genre={genre} query={query} /> });
  }
  if (mixes.length > 0) {
    sections.push({
      key: "mixes",
      node: (
        <div className={styles.mixes}>
          {mixes.map((mix, index) => (
            <MixCard
              key={mix.id}
              mix={mix}
              number={index + 1}
              lead={index === 0}
              {...mixText(mix, t)}
              onOpen={() => open(`/collection?type=playlist&id=${encodeURIComponent(mix.id)}`)}
              onPlay={() => playMix(mix.id, mix.tracks, 0)}
            />
          ))}
        </div>
      ),
    });
  }
  sections.push({ key: "songs", node: <SongsForYou mixes={mixes} /> });
  const [firstArtist, secondArtist] = offline ? [] : likeArtists(mixes, LIKE_SHELVES);
  if (firstArtist) sections.push({ key: `like:${firstArtist.name}`, node: <LikeShelf artist={firstArtist} /> });
  sections.push({ key: offline ? "shuffle:offline" : "shuffle", node: <ShuffleShelf songs={kept?.songs} /> });
  if (secondArtist) sections.push({ key: `like:${secondArtist.name}`, node: <LikeShelf artist={secondArtist} /> });
  sections.push({ key: "style", node: <StyleShelf /> });
  if (offline && mixes.length === 0 && (kept?.songs.length ?? 0) < OFFLINE_MIN_SONGS) {
    sections.push({
      key: "offline",
      node: (
        <EmptyState
          title={t("ui.home.offline.title")}
          message={t("ui.home.offline.message")}
          actions={[{ label: t("ui.local.add_files"), primary: true, onClick: () => void addMusic() }]}
        />
      ),
    });
  } else if (!starter && !offline && libraryEmpty) {
    sections.push({
      key: "import",
      node: (
        <Button variant="text" className={styles.textAction} onClick={() => useImportsUi.getState().openImport()}>
          {t("ui.library.import")}
        </Button>
      ),
    });
  }

  return (
    <div className={styles.home} data-offline={offline ? "" : undefined}>
      {sections.map((section, index) => (
        <Enter key={section.key} index={index} screen="home">
          {section.node}
        </Enter>
      ))}
      <HiddenLinkSlot />
    </div>
  );
}
