import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Enter } from "../../components/Enter";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { mostSaved, useLikedTrackCount, usePlaylistsList, type MostSavedEntry } from "../../ports/library";
import { playMix, recs, recsChanged, type HomeMix } from "../../ports/recs";
import { navigateWithTransition } from "../../shell/navigate";
import { useImportsUi } from "../imports/importsUi";
import { arrangeMixes, likeArtists, mixText, mosaicCovers } from "./homeModel";
import { MixCard } from "./MixCard";
import { QuickPicks } from "./QuickPicks";
import { SavedShelf } from "./SavedShelf";
import { LikeShelf, ShuffleShelf, SongsForYou, StyleShelf } from "./Shelves";
import { ColdStartSlot, HiddenLinkSlot } from "./slots";
import styles from "./Home.module.css";

const LIKE_SHELVES = 2;

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

function useMostSaved(): MostSavedEntry[] {
  const [items, setItems] = useState<MostSavedEntry[]>([]);
  useEffect(() => {
    let live = true;
    void mostSaved().then((found) => {
      if (live) setItems(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return items;
}

export function Home(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mixes = useHomeMixes();
  const saved = useMostSaved();
  const { data: likedCount } = useLikedTrackCount();
  const playlists = usePlaylistsList();
  const libraryEmpty = likedCount === 0 && !playlists.isLoading && playlists.data.playlists.length === 0;
  usePageBackdrop(mixes?.[0] ? mosaicCovers(mixes[0].tracks)[0] : undefined);

  if (mixes === null) return null;
  const open = (href: string) => navigateWithTransition(navigate, href);

  const sections: Array<{ key: string; node: ReactNode }> = [];
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
  sections.push({ key: "picks", node: <QuickPicks onOpen={open} /> });
  sections.push({ key: "songs", node: <SongsForYou mixes={mixes} /> });
  const [firstArtist, secondArtist] = likeArtists(mixes, LIKE_SHELVES);
  if (firstArtist) sections.push({ key: `like:${firstArtist.name}`, node: <LikeShelf artist={firstArtist} /> });
  sections.push({ key: "shuffle", node: <ShuffleShelf /> });
  if (secondArtist) sections.push({ key: `like:${secondArtist.name}`, node: <LikeShelf artist={secondArtist} /> });
  sections.push({ key: "style", node: <StyleShelf /> });
  const openImport = libraryEmpty ? () => useImportsUi.getState().openImport() : undefined;
  if (mixes.length === 0) sections.push({ key: "cold-start", node: <ColdStartSlot onImport={openImport} /> });
  else if (openImport) {
    sections.push({
      key: "import",
      node: (
        <Button variant="text" className={styles.textAction} onClick={openImport}>
          {t("ui.library.import")}
        </Button>
      ),
    });
  }
  if (saved.length > 0) sections.push({ key: "saved", node: <SavedShelf title={t("ui.home.most_saved")} items={saved} onOpen={open} /> });

  return (
    <div className={styles.home}>
      {sections.map((section, index) => (
        <Enter key={section.key} index={index} screen="home">
          {section.node}
        </Enter>
      ))}
      <HiddenLinkSlot />
    </div>
  );
}
