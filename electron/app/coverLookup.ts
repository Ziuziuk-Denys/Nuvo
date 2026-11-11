import { IMAGE_URL_MAX } from "./discord";

export type GetJson = (url: string) => Promise<unknown>;

const TIMEOUT_MS = 5000;

export const getJson: GetJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  return response.ok ? response.json() : null;
};

function simple(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function firstArtist(artists: string): string {
  return artists.split(/,|&| feat\.? | ft\.? | x /i)[0].trim();
}

function sameArtist(found: unknown, wanted: string): boolean {
  if (typeof found !== "string") return false;
  const a = simple(found);
  const b = simple(wanted);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

async function fromApple(artist: string, title: string, get: GetJson): Promise<string | null> {
  const term = encodeURIComponent(`${artist} ${title}`);
  const body = (await get(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=10`)) as { results?: Record<string, unknown>[] } | null;
  const hit = body?.results?.find((item) => sameArtist(item.artistName, artist) && typeof item.artworkUrl100 === "string");
  return hit ? (hit.artworkUrl100 as string).replace(/\/\d+x\d+bb\./, "/512x512bb.") : null;
}

async function fromDeezer(artist: string, title: string, get: GetJson): Promise<string | null> {
  const query = encodeURIComponent(`${artist} ${title}`);
  const body = (await get(`https://api.deezer.com/search?q=${query}&limit=10`)) as { data?: Array<Record<string, any>> } | null;
  const hit = body?.data?.find((item) => sameArtist(item.artist?.name, artist) && typeof item.album?.cover_xl === "string");
  return hit ? (hit.album.cover_xl as string) : null;
}

export async function findCover(artists: string, title: string, get: GetJson = getJson): Promise<string | null> {
  const artist = firstArtist(artists);
  if (!artist || !title.trim()) return null;
  for (const source of [fromApple, fromDeezer]) {
    const url = await source(artist, title, get).catch(() => null);
    if (url && url.length <= IMAGE_URL_MAX) return url;
  }
  return null;
}
