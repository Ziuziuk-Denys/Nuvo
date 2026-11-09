// Deezer reports errors inside an HTTP 200 body, so every page is checked
import { HttpError, drop, get, readCapped, type Http } from "./http";
import { detectLink } from "./detect";
import { ImportError, MAX_LABEL_CHARS, MAX_ROWS, type ImportRow, type Listing } from "./types";

export interface DeezerLink {
  kind: "playlist" | "album";
  id: string;
}

const API = "https://api.deezer.com/";
const MAX_ANSWER_BYTES = 2_000_000;
export const MAX_DEEZER_REQUESTS = 60;
const SHORT_HOSTS = ["deezer.page.link", "link.deezer.com"];
const LANG = /^[a-z]{2}(-[a-z]{2})?$/i;

export function isDeezerShortLink(href: string): boolean {
  try {
    return SHORT_HOSTS.includes(new URL(href).hostname.replace(/\.$/, "").replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export function parseDeezerLink(href: string): DeezerLink | null {
  if (isDeezerShortLink(href)) return null;
  let parts: string[];
  try {
    parts = new URL(href).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  if (parts.length === 3 && LANG.test(parts[0])) parts.shift();
  const [kind, id] = parts;
  if (parts.length !== 2 || (kind !== "playlist" && kind !== "album") || !/^\d{1,20}$/.test(id)) return null;
  return { kind, id };
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

interface Page {
  data: unknown[];
  next?: string;
}

class Budget {
  used = 0;
  take() {
    this.used += 1;
    return this.used <= MAX_DEEZER_REQUESTS;
  }
}

async function getJson(url: string, http: Http, budget: Budget): Promise<Obj> {
  if (!budget.take()) throw new ImportError("network");
  let body: unknown;
  try {
    const raw = await readCapped(await get(url, http), MAX_ANSWER_BYTES);
    if (raw === null) throw new ImportError("network");
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof HttpError) throw new ImportError(error.status === 404 ? "gone" : "network");
    if (error instanceof SyntaxError) throw new ImportError("network");
    throw error;
  }
  if (!isObj(body)) throw new ImportError("network");
  if (typeof body.error === "string" && body.error) throw new ImportError("network");
  if (isObj(body.error)) {
    // DataException: no such item; OAuthException: a private playlist
    const type = text(body.error.type);
    throw new ImportError(type === "DataException" || type === "OAuthException" ? "gone" : "network");
  }
  return body;
}

function pageOf(value: unknown): Page {
  const page = isObj(value) ? value : {};
  const next = text(page.next);
  return {
    data: Array.isArray(page.data) ? page.data : [],
    next: next.startsWith(API) ? next : undefined,
  };
}

function rowOf(track: unknown, albumTitle: string | undefined): ImportRow | null {
  if (!isObj(track)) return null;
  const title = text(track.title);
  if (!title) return null;
  const artist = isObj(track.artist) ? text(track.artist.name) : "";
  const album = albumTitle ?? (isObj(track.album) ? text(track.album.title) : "");
  const seconds = typeof track.duration === "number" && track.duration > 0 ? track.duration : 0;
  return {
    title,
    artists: artist ? [artist] : [],
    ...(album ? { album } : {}),
    ...(seconds ? { durationMs: Math.round(seconds * 1000) } : {}),
  };
}

async function followShort(href: string, http: Http): Promise<string> {
  let response: Response;
  try {
    response = await get(href, http);
  } catch (error) {
    throw error instanceof HttpError ? new ImportError(error.status === 404 ? "bad_link" : "network") : error;
  }
  drop(response);
  const target = response.url ? detectLink(response.url) : null;
  if (!target || !("kind" in target) || target.kind !== "deezer" || isDeezerShortLink(target.url)) throw new ImportError("bad_link");
  return target.url;
}

export async function listDeezer(href: string, http: Http, onProgress: (count: number) => void = () => {}): Promise<Listing> {
  const resolved = isDeezerShortLink(href) ? await followShort(href, http) : href;
  const link = parseDeezerLink(resolved);
  if (!link) throw new ImportError("bad_link");
  const budget = new Budget();
  const record = await getJson(`${API}${link.kind}/${link.id}`, http, budget);
  const label = text(record.title).slice(0, MAX_LABEL_CHARS);
  const albumTitle = link.kind === "album" ? label || undefined : undefined;
  const total = typeof record.nb_tracks === "number" ? record.nb_tracks : 0;
  const rows: ImportRow[] = [];
  let seen = 0;
  const add = (page: Page) => {
    seen += page.data.length;
    for (const track of page.data) {
      if (rows.length >= MAX_ROWS) break;
      const row = rowOf(track, albumTitle);
      if (row) rows.push(row);
    }
    onProgress(rows.length);
  };

  let page = pageOf(record.tracks);
  add(page);
  const room = () => seen < total && rows.length < MAX_ROWS && budget.used < MAX_DEEZER_REQUESTS;
  let failed = false;
  try {
    while (page.next && room()) {
      page = pageOf(await getJson(page.next, http, budget));
      if (page.data.length === 0) break;
      add(page);
    }
    // `next` can stop early on long playlists; index paging fills the rest
    while (room()) {
      const more = pageOf(await getJson(`${API}${link.kind}/${link.id}/tracks?limit=100&index=${seen}`, http, budget));
      if (more.data.length === 0) break;
      add(more);
    }
  } catch (error) {
    if (!(error instanceof ImportError) || error.code !== "network") throw error;
    failed = true;
  }
  return {
    source: "deezer",
    label,
    rows,
    ...(rows.length >= MAX_ROWS
      ? { notice: { kind: "capped" as const, kept: MAX_ROWS } }
      : seen < total || failed
        ? { notice: { kind: "partial" as const, shown: rows.length, total: Math.max(total, rows.length) } }
        : {}),
  };
}
