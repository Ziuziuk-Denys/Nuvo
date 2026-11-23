import type { ArtistAlbumViewModel } from "../../ports/catalog";

const WIDE_SCRIPT = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;
const WIDE_EM = 1.02;
const LETTER_EM = 0.64;
const NARROW_EM = 0.36;

export function nameWidth(name: string): number {
  const width = [...name].reduce((sum, char) => sum + (WIDE_SCRIPT.test(char) ? WIDE_EM : /[ .,'!|iIlj1]/.test(char) ? NARROW_EM : LETTER_EM), 0);
  return Math.max(1, Math.round(width * 100) / 100);
}

export function monthAndYear(iso: string, locale: string): string {
  // a day in the pattern keeps Russian months in the genitive
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("month")} ${part("year")}`;
}

export function heardOf(tracks: readonly { id: string }[], heardIds: readonly string[]): number {
  const heard = new Set(heardIds);
  return tracks.filter((track) => heard.has(track.id)).length;
}

const yearOf = (release: ArtistAlbumViewModel) => Number(release.releaseDate ?? 0);

// an album wins its year over a single
export function latestRelease(albums: readonly ArtistAlbumViewModel[], singles: readonly ArtistAlbumViewModel[]): ArtistAlbumViewModel | undefined {
  return [...albums, ...singles].reduce<ArtistAlbumViewModel | undefined>(
    (latest, release) => (!latest || yearOf(release) > yearOf(latest) ? release : latest),
    undefined,
  );
}
