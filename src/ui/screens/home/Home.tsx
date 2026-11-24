import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Enter } from "../../components/Enter";
import { offlineMixes, offlineSongs } from "../../ports/homeShelves";
import { useTranslation } from "../../ports/i18n";
import { useLikedTrackCount, usePlaylistsList } from "../../ports/library";
import { useOfflineMode, useStreamingReachable } from "../../ports/network";
import { playMix, recs, recsChanged, type HomeMix, type Track } from "../../ports/recs";
import { navigateWithTransition } from "../../shell/navigate";
import { useImportsUi } from "../imports/importsUi";
import { useAddMusic } from "../local/addMusic";
import { DiscoverArc } from "./discover/DiscoverArc";
import { EmptyRoom } from "./discover/EmptyRoom";
import { ringTracks } from "./discover/ring";
import { ArrangeHome } from "./arrange/ArrangeHome";
import { useHomeLayout, type SectionId } from "./arrange/homeLayout";
import { arrangeMixes, likeArtists, mixCovers, mixNames, mixText } from "./homeModel";
import { MixCard } from "./MixCard";
import { Continue } from "./moments/Continue";
import { Memory } from "./moments/Memory";
import { MoodPad } from "./mood/MoodPad";
import { GenreShelf, LikeShelf, ShuffleShelf, SongsForYou, StyleShelf } from "./Shelves";
import { useStarters } from "./useStarters";
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
  const offlineMode = useOfflineMode();
  const reachable = useStreamingReachable();
  const offline = offlineMode || !reachable;
  const kept = useOfflineHome(offline ? all : null);
  const addMusic = useAddMusic();
  const { data: likedCount } = useLikedTrackCount();
  const playlists = usePlaylistsList();
  const { order, hidden } = useHomeLayout();
  const libraryEmpty = likedCount === 0 && !playlists.isLoading && playlists.data.playlists.length === 0;
  const mixes = offline ? (kept?.mixes ?? null) : all;
  const ring = useMemo(() => (mixes ? ringTracks(mixes) : []), [mixes]);

  const starter = !offline && mixes?.length === 0;
  const starters = useStarters(starter, locale);

  if (mixes === null) return null;
  const open = (href: string) => navigateWithTransition(navigate, href);

  const sections: Array<{ key: string; node: ReactNode; own?: boolean }> = [];
  if (starter) {
    sections.push({ key: "cold-start", node: <ColdStartSlot ring={starters.ring} />, own: true });
    for (const { genre, pool } of starters.genres) sections.push({ key: `genre:${genre}`, node: <GenreShelf genre={genre} pool={pool} /> });
  }
  if (ring.length > 0)
    sections.push({ key: "discover", node: <DiscoverArc tracks={ring} title={t(offline ? "ui.home.offline.ring" : "ui.recs.home.discover")} /> });
  const [firstArtist, secondArtist] = offline ? [] : likeArtists(mixes, LIKE_SHELVES);
  const covers = mixCovers(mixes);
  const parts: Record<SectionId, Array<{ key: string; node: ReactNode }>> = {
    mixes:
      mixes.length === 0
        ? []
        : [
            {
              key: "mixes",
              node: (
                <div className={styles.mixes}>
                  {mixes.map((mix, index) => (
                    <MixCard
                      key={mix.id}
                      mix={mix}
                      cover={covers[index]}
                      number={index + 1}
                      lead={index === 0}
                      names={index === 0 ? mixNames(mix, t) : undefined}
                      {...mixText(mix, t)}
                      onOpen={() => open(`/collection?type=playlist&id=${encodeURIComponent(mix.id)}`)}
                      onPlay={() => playMix(mix.id, mix.tracks, 0)}
                    />
                  ))}
                </div>
              ),
            },
          ],
    continue: [{ key: "continue", node: <Continue offline={offline} /> }],
    mood: [{ key: "mood", node: <MoodPad offline={offline} /> }],
    songs: [{ key: "songs", node: <SongsForYou mixes={mixes} /> }],
    memory: [{ key: "memory", node: <Memory offline={offline} /> }],
    like: [firstArtist, secondArtist].filter(Boolean).map((artist) => ({ key: `like:${artist.name}`, node: <LikeShelf artist={artist} /> })),
    shuffle: [{ key: offline ? "shuffle:offline" : "shuffle", node: <ShuffleShelf songs={kept?.songs} /> }],
    style: [{ key: "style", node: <StyleShelf /> }],
  };
  for (const id of order) if (!hidden.includes(id)) sections.push(...parts[id]);
  const nothingHere = offline && mixes.length === 0 && (kept?.songs.length ?? 0) < OFFLINE_MIN_SONGS;
  if (nothingHere) {
    sections.push({
      key: "offline",
      node: (
        <div data-tour="home-start">
          <EmptyRoom title={t("ui.home.offline.title")} message={t("ui.home.offline.message")}>
            <Button variant="primary" onClick={() => void addMusic()}>
              {t("ui.local.add_files")}
            </Button>
          </EmptyRoom>
        </div>
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
      {sections.map((section, index) =>
        section.own ? (
          <div key={section.key}>{section.node}</div>
        ) : (
          <Enter key={section.key} index={index} screen="home">
            {section.node}
          </Enter>
        ),
      )}
      <HiddenLinkSlot />
      {starter || nothingHere ? null : <ArrangeHome />}
    </div>
  );
}
