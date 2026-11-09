import type { MenuItem } from "../components/Menu";
import type { TFunction } from "../ports/i18n";
import type { NotInterestedScope } from "../ports/recs";

interface Credited {
  artists: string;
  artistList?: ReadonlyArray<{ name: string }>;
}

export function firstArtist(track: Credited): string {
  return track.artistList?.[0]?.name ?? track.artists.split(",")[0]?.trim() ?? "";
}

export function notInterestedItems<T extends Credited>(track: T, t: TFunction, mark: (track: T, scope: NotInterestedScope) => void): MenuItem[] {
  const artist = firstArtist(track);
  const items: MenuItem[] = [
    { label: t("ui.recs.menu.exact"), onSelect: () => mark(track, "exact") },
    { label: t("ui.recs.menu.work"), onSelect: () => mark(track, "work") },
  ];
  if (artist) items.push({ label: t("ui.recs.menu.artist", { artist }), onSelect: () => mark(track, "artist") });
  return items;
}
