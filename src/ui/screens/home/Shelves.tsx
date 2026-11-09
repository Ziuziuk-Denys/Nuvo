import { useRef, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { librarySongs, localStyle, playSongs, shuffled, songsLike } from "../../ports/homeShelves";
import { playMix, type HomeMix, type Track } from "../../ports/recs";
import { byOthers, freshFirst, homeSongs, type LikeArtist } from "./homeModel";
import { ArtistLead, CoverShelf, ShuffleCard } from "./SongCovers";
import { SongsShelf } from "./SongsShelf";
import { useShelf } from "./useShelf";

const SHELF_SIZE = 12;
const LIKE_COVER = 140;
const STYLE_COVER = 175;
const MIN_SONGS = 4;

const notIn = (taken: Set<string>) => (track: Track) => !taken.has(track.id);

function rotate(seeds: readonly string[], round: number): string[] {
  const by = seeds.length === 0 ? 0 : round % seeds.length;
  return [...seeds.slice(seeds.length - by), ...seeds.slice(0, seeds.length - by)];
}

export function SongsForYou({ mixes }: { mixes: HomeMix[] }): JSX.Element | null {
  const { t } = useTranslation();
  const all = homeSongs(mixes, Infinity);
  const shelf = useShelf(
    "songs",
    async (shown, taken) => freshFirst(all.map((song) => song.track).filter(notIn(taken())), shown, SHELF_SIZE),
    all.slice(0, SHELF_SIZE).map((song) => song.track),
  );
  const { songs } = shelf;
  if (songs.length === 0) return null;
  const play = (index: number) => {
    const song = all.find((candidate) => candidate.track.id === songs[index].id)!;
    playMix(song.mixId, mixes.find((mix) => mix.id === song.mixId)!.tracks, song.index);
  };
  return <SongsShelf name="songs" title={t("ui.home.songs_for_you")} icon="track" shelf={shelf} songs={songs} onPlay={play} />;
}

export function ShuffleShelf(): JSX.Element | null {
  const { t } = useTranslation();
  const pool = useRef<Promise<Track[]> | null>(null);
  const shelf = useShelf("shuffle", async (shown, taken) => {
    pool.current ??= librarySongs();
    const library = await pool.current;
    return freshFirst(shuffled(library.filter(notIn(taken()))), shown, SHELF_SIZE);
  });
  const { songs } = shelf;
  if (songs.length < MIN_SONGS) return null;
  return <ShuffleCard title={t("ui.home.shuffle")} shelf={shelf} songs={songs} onPlay={(index) => playSongs(songs, index, "home:shuffle")} />;
}

export function LikeShelf({ artist }: { artist: LikeArtist }): JSX.Element | null {
  const { t } = useTranslation();
  const context = `home:like:${artist.name}`;
  const shelf = useShelf(context, async (shown, taken, round) => {
    const ranked = await songsLike(context, rotate(artist.seeds, round), [...shown.map((track) => track.id), ...taken()]);
    return byOthers(ranked, artist.name).filter(notIn(taken())).slice(0, SHELF_SIZE);
  });
  const { songs } = shelf;
  if (songs.length < MIN_SONGS) return null;
  return (
    <CoverShelf
      name="like"
      title={t("ui.home.more_like", { name: artist.name })}
      icon="radio"
      shelf={shelf}
      songs={songs}
      size={LIKE_COVER}
      lead={<ArtistLead name={artist.name} cover={artist.cover} size={LIKE_COVER} onPlay={() => playSongs(songs, 0, context)} />}
      onPlay={(index) => playSongs(songs, index, context)}
    />
  );
}

export function StyleShelf(): JSX.Element | null {
  const { t } = useTranslation();
  const [genre, setGenre] = useState("");
  const shelf = useShelf("style", async (shown, taken) => {
    const style = await localStyle();
    if (!style) return [];
    setGenre(style.genre);
    return freshFirst(style.tracks.filter(notIn(taken())), shown, SHELF_SIZE);
  });
  const { songs } = shelf;
  if (!genre || songs.length < MIN_SONGS) return null;
  return (
    <CoverShelf
      name="style"
      title={t("ui.home.style_for_you", { style: genre })}
      icon="album"
      shelf={shelf}
      songs={songs}
      size={STYLE_COVER}
      onPlay={(index) => playSongs(songs, index, `home:style:${genre}`)}
    />
  );
}
