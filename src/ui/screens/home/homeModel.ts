import type { TFunction } from "../../ports/i18n";
import type { HomeMix, Track } from "../../ports/recs";
import { firstArtist } from "../../recs/notInterestedItems";

/** Every Home mix id starts with this; the daemon keeps it so the collection page knows a mix from a catalog playlist. */
export const MIX_PREFIX = "daily-mix-";
export const FOR_YOU = "daily-mix-for-you";
export const DISCOVER = "daily-mix-discover";
const RECENT_LIKES = "daily-mix-recent-likes";
const ARTIST_MIX = "daily-mix-artist-";
const MOOD_MIX = "daily-mix-mood-";
const MOODS = ["energy", "calm", "bright", "late-night"];

export function mixText(mix: HomeMix, t: TFunction): { title: string; subtitle: string } {
  if (mix.id === FOR_YOU) return { title: t("ui.recs.home.for_you"), subtitle: t("ui.home.for_you_subtitle") };
  if (mix.id === DISCOVER) return { title: t("ui.recs.home.discover"), subtitle: t("ui.home.discover_subtitle") };
  if (mix.id === RECENT_LIKES) return { title: t("ui.home.recent_likes"), subtitle: t("ui.home.recent_likes_subtitle") };
  const name = mix.tracks[0] ? firstArtist(mix.tracks[0]) : "";
  if (mix.id.startsWith(ARTIST_MIX) && name) return { title: t("ui.home.artist_mix", { name }), subtitle: t("ui.home.artist_mix_subtitle", { name }) };
  const mood = mix.id.slice(MOOD_MIX.length);
  if (mix.id.startsWith(MOOD_MIX) && MOODS.includes(mood)) return { title: t(`ui.home.mood_${mood.replace("-", "_")}`), subtitle: "" };
  return { title: mix.title, subtitle: mix.description };
}

export function arrangeMixes(mixes: HomeMix[]): HomeMix[] {
  const rank = (mix: HomeMix) => (mix.id === FOR_YOU ? 0 : mix.id === DISCOVER ? 1 : 2);
  // sort is stable, so equal ranks keep the daemon's order
  return mixes.filter((mix) => mix.tracks.length > 0).sort((left, right) => rank(left) - rank(right));
}

export function mosaicCovers(tracks: Pick<Track, "coverUrl">[]): string[] {
  const covers = [...new Set(tracks.map((track) => track.coverUrl).filter(Boolean))];
  return covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1);
}

export interface HomeSong {
  track: Track;
  mixId: string;
  index: number;
}

export function homeSongs(mixes: readonly HomeMix[], limit: number): HomeSong[] {
  const seen = new Set<string>();
  const songs: HomeSong[] = [];
  const longest = Math.max(0, ...mixes.map((mix) => mix.tracks.length));
  for (let index = 0; index < longest && songs.length < limit; index += 1) {
    for (const mix of mixes) {
      const track = mix.tracks[index];
      if (!track || seen.has(track.id)) continue;
      seen.add(track.id);
      songs.push({ track, mixId: mix.id, index });
      if (songs.length === limit) break;
    }
  }
  return songs;
}

export function freshFirst(tracks: readonly Track[], shown: readonly Track[], limit: number): Track[] {
  const old = new Set(shown.map((track) => track.id));
  return [...tracks.filter((track) => !old.has(track.id)), ...tracks.filter((track) => old.has(track.id))].slice(0, limit);
}

export interface LikeArtist {
  name: string;
  seeds: string[];
  cover: string;
}

export function likeArtists(mixes: readonly HomeMix[], limit: number): LikeArtist[] {
  return mixes
    .filter((mix) => mix.id.startsWith(ARTIST_MIX) && mix.tracks.length > 0)
    .map((mix) => ({ name: firstArtist(mix.tracks[0]), seeds: mix.tracks.map((track) => track.id), cover: mix.tracks[0].coverUrl }))
    .filter((artist) => artist.name !== "")
    .slice(0, limit);
}

export function byOthers(tracks: readonly Track[], name: string): Track[] {
  const key = name.toLocaleLowerCase();
  return tracks.filter((track) => firstArtist(track).toLocaleLowerCase() !== key);
}
