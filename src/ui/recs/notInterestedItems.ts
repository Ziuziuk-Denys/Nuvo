import type { MenuItem } from "../components/Menu";
import type { TFunction } from "../ports/i18n";
import type { NotInterestedScope } from "../ports/recs";

interface Credited {
  artists: string;
  artistList?: ReadonlyArray<{ name: string }>;
}

/** The first credited artist, the one "Not interested in ..." and the hide offer name. */
export function firstArtist(track: Credited): string {
  return track.artistList?.[0]?.name ?? track.artists.split(",")[0]?.trim() ?? "";
}

/** The three "Not interested" scopes as menu items; every song menu and the bar's own menu use these. */
export function notInterestedItems<T extends Credited>(track: T, t: TFunction, mark: (track: T, scope: NotInterestedScope) => void): MenuItem[] {
  const artist = firstArtist(track);
  const items: MenuItem[] = [
    { label: t("ui.recs.menu.exact"), onSelect: () => mark(track, "exact") },
    { label: t("ui.recs.menu.work"), onSelect: () => mark(track, "work") },
  ];
  if (artist) items.push({ label: t("ui.recs.menu.artist", { artist }), onSelect: () => mark(track, "artist") });
  return items;
}
