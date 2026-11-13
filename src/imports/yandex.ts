// Public playlists only, read without an account; any field of the answer may be missing or wrong
import { HttpError, get, readCapped, type Http } from "./http";
import { ImportError, MAX_LABEL_CHARS, MAX_ROWS, type ImportRow, type Listing } from "./types";

export type YandexLink =
  { kind: "playlist"; owner: string; id: string } | { kind: "shared-playlist"; id: string } | { kind: "album"; id: string } | { kind: "track"; id: string };

export const YANDEX_API = "https://api.music.yandex.net/";
const MAX_ANSWER_BYTES = 32_000_000;
const TRACKS_PER_REQUEST = 100;
export const MAX_YANDEX_REQUESTS = 2 + Math.ceil(MAX_ROWS / TRACKS_PER_REQUEST);
const NUMBER = /^\d{1,15}$/;
const OWNER = /^(?!\.+$)[A-Za-z0-9._-]{1,64}$/;
const SHARED_ID = /^(?!\.+$)[A-Za-z0-9.-]{1,80}$/;

export function parseYandexLink(href: string): YandexLink | null {
  let parts: string[];
  try {
    parts = new URL(href).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  const [first, second, third, fourth] = parts;
  if (parts.length === 4 && first === "users" && OWNER.test(second) && third === "playlists" && NUMBER.test(fourth))
    return { kind: "playlist", owner: second, id: fourth };
  if (parts.length === 2 && first === "playlists" && SHARED_ID.test(second)) return { kind: "shared-playlist", id: second };
  if (parts.length === 2 && first === "album" && NUMBER.test(second)) return { kind: "album", id: second };
  if (parts.length === 4 && first === "album" && NUMBER.test(second) && third === "track" && NUMBER.test(fourth)) return { kind: "track", id: fourth };
  if (parts.length === 2 && first === "track" && NUMBER.test(second)) return { kind: "track", id: second };
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);

class Budget {
  used = 0;
  take() {
    this.used += 1;
    return this.used <= MAX_YANDEX_REQUESTS;
  }
}

async function getResult(path: string, http: Http, budget: Budget): Promise<unknown> {
  if (!budget.take()) throw new ImportError("network");
  let body: unknown;
  try {
    const raw = await readCapped(await get(`${YANDEX_API}${path}`, http), MAX_ANSWER_BYTES);
    if (raw === null) throw new ImportError("network");
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 451) throw new ImportError("region_blocked");
      throw new ImportError(error.status === 403 || error.status === 404 ? "gone" : "network");
    }
    if (error instanceof SyntaxError) throw new ImportError("network");
    throw error;
  }
  if (!isObj(body)) throw new ImportError("network");
  if (isObj(body.error)) {
    const name = text(body.error.name);
    throw new ImportError(name === "not-found" ? "gone" : name === "Unavailable For Legal Reasons" ? "region_blocked" : "network");
  }
  return body.result;
}

function rowOf(track: unknown, albumTitle?: string): ImportRow | null {
  if (!isObj(track)) return null;
  const title = text(track.title);
  if (!title) return null;
  const version = text(track.version);
  const artists = list(track.artists)
    .map((artist) => (isObj(artist) ? text(artist.name) : ""))
    .filter(Boolean);
  const firstAlbum = list(track.albums)[0];
  const album = albumTitle ?? (isObj(firstAlbum) ? text(firstAlbum.title) : "");
  const durationMs = typeof track.durationMs === "number" && track.durationMs > 0 ? Math.round(track.durationMs) : 0;
  return {
    title: version ? `${title} (${version})` : title,
    artists,
    ...(album ? { album } : {}),
    ...(durationMs ? { durationMs } : {}),
  };
}

function rowsOf(tracks: unknown[], albumTitle?: string): ImportRow[] {
  return tracks.map((track) => rowOf(track, albumTitle)).filter((row): row is ImportRow => row !== null);
}

async function readPlaylist(path: string, http: Http, budget: Budget, onProgress: (count: number) => void): Promise<Listing> {
  const playlist = await getResult(path, http, budget);
  if (!isObj(playlist)) throw new ImportError("network");
  const items = list(playlist.tracks).slice(0, MAX_ROWS);
  const total = typeof playlist.trackCount === "number" ? playlist.trackCount : items.length;
  const rows: ImportRow[] = [];
  let failed = false;
  // A long playlist may list only track ids; those are fetched in batches, keeping the playlist order
  for (let at = 0; at < items.length; at += TRACKS_PER_REQUEST) {
    const batch = items.slice(at, at + TRACKS_PER_REQUEST).filter(isObj);
    const missing = batch.filter((item) => !isObj(item.track)).map((item) => String(item.id ?? ""));
    const fetched = new Map<string, unknown>();
    if (missing.some((id) => NUMBER.test(id))) {
      try {
        const ids = missing.filter((id) => NUMBER.test(id)).join(",");
        for (const track of list(await getResult(`tracks?track-ids=${ids}`, http, budget))) {
          if (isObj(track)) fetched.set(String(track.id), track);
        }
      } catch (error) {
        if (!(error instanceof ImportError) || rows.length === 0) throw error;
        failed = true;
        break;
      }
    }
    rows.push(...rowsOf(batch.map((item) => (isObj(item.track) ? item.track : fetched.get(String(item.id))))));
    onProgress(rows.length);
  }
  return {
    source: "yandex-music",
    label: text(playlist.title).slice(0, MAX_LABEL_CHARS),
    rows,
    ...(failed ? { notice: { kind: "cut" as const, kept: rows.length } } : total > MAX_ROWS ? { notice: { kind: "capped" as const, kept: MAX_ROWS } } : {}),
  };
}

export async function listYandex(href: string, http: Http, onProgress: (count: number) => void = () => {}): Promise<Listing> {
  const link = parseYandexLink(href);
  if (!link) throw new ImportError("bad_link");
  const budget = new Budget();
  switch (link.kind) {
    case "playlist":
      return readPlaylist(`users/${link.owner}/playlists/${link.id}`, http, budget, onProgress);
    case "shared-playlist":
      return readPlaylist(`playlist/${link.id}`, http, budget, onProgress);
    case "album": {
      const album = await getResult(`albums/${link.id}/with-tracks`, http, budget);
      if (!isObj(album)) throw new ImportError("network");
      const label = text(album.title).slice(0, MAX_LABEL_CHARS);
      const rows = rowsOf(list(album.volumes).flatMap(list), label || undefined);
      onProgress(rows.length);
      return { source: "yandex-music", label, rows };
    }
    case "track": {
      const rows = rowsOf(list(await getResult(`tracks/${link.id}`, http, budget)).slice(0, 1));
      onProgress(rows.length);
      return { source: "yandex-music", label: rows[0]?.title ?? "", rows };
    }
  }
}
