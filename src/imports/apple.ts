import { HttpError, get, readCapped, type Http } from "./http";
import { ImportError, MAX_LABEL_CHARS, MAX_ROWS, type ImportRow, type Listing } from "./types";

const MAX_PAGE_BYTES = 8_000_000;

export interface AppleLink {
  storefront: string;
  kind: "playlist" | "album";
  id: string;
  slug?: string;
}

const STOREFRONT = /^[a-z]{2}$/i;
const PLAYLIST_ID = /^pl\.[A-Za-z0-9-]+$/;
const ALBUM_ID = /^\d+$/;

export function parseAppleLink(href: string): AppleLink | null {
  let url: URL;
  let parts: string[];
  try {
    url = new URL(href);
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  // `?i=` names one song inside an album page
  if (url.searchParams.has("i")) return null;
  const storefront = parts[0] && STOREFRONT.test(parts[0]) ? parts.shift()!.toLowerCase() : "us";
  const [kind, ...rest] = parts;
  if ((kind !== "playlist" && kind !== "album") || rest.length < 1 || rest.length > 2) return null;
  const id = rest[rest.length - 1];
  if (!(kind === "playlist" ? PLAYLIST_ID : ALBUM_ID).test(id)) return null;
  return {
    storefront,
    kind,
    id,
    slug: rest.length === 2 ? rest[0] : undefined,
  };
}

export function applePageUrl(link: AppleLink, storefront = link.storefront): string {
  const slug = link.slug ? `${encodeURIComponent(link.slug)}/` : "";
  return `https://music.apple.com/${storefront}/${link.kind}/${slug}${link.id}`;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const PAGE_DATA = /<script\b[^>]*\bid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i;

function sections(html: string): Obj[] {
  const match = PAGE_DATA.exec(html);
  if (!match) throw new ImportError("source_changed");
  let doc: unknown;
  try {
    doc = JSON.parse(match[1]);
  } catch {
    throw new ImportError("source_changed");
  }
  const page = list(doc)[0];
  const found = isObj(page) && isObj(page.data) ? list(page.data.sections) : [];
  if (found.length === 0) throw new ImportError("source_changed");
  return found.filter(isObj);
}

function artistsOf(item: Obj): string[] {
  const names = list(item.subtitleLinks)
    .map((link) => (isObj(link) ? text(link.title) : ""))
    .filter(Boolean);
  // a single string can carry several names: "A, B & C"
  return names.length === 1
    ? names[0]
        .split(/, | & /)
        .map((n) => n.trim())
        .filter(Boolean)
    : names;
}

function rowOf(item: Obj, albumTitle: string | undefined): ImportRow | null {
  const title = text(item.title);
  if (!title) return null;
  const album = text(isObj(list(item.tertiaryLinks)[0]) ? (list(item.tertiaryLinks)[0] as Obj).title : "") || albumTitle;
  const duration = typeof item.duration === "number" && Number.isFinite(item.duration) && item.duration > 0 ? Math.round(item.duration) : undefined;
  return {
    title,
    artists: artistsOf(item),
    ...(album ? { album } : {}),
    ...(duration ? { durationMs: duration } : {}),
  };
}

export function parseApplePage(html: string, kind: AppleLink["kind"]): Listing {
  const all = sections(html);
  const header = all.find((s) => s.itemKind === "containerDetailHeaderLockup");
  const headerItem = header ? list(header.items).find(isObj) : undefined;
  const title = headerItem ? text(headerItem.title) : "";
  const count = headerItem?.trackCount;
  // the page sometimes sends the count as text
  const total = typeof count === "number" ? count : typeof count === "string" && /^\d{1,9}$/.test(count) ? Number(count) : 0;
  const tracks = all.find((s) => s.itemKind === "trackLockup");
  if (!tracks) throw new ImportError("source_changed");
  const rows = list(tracks.items)
    .filter(isObj)
    .map((item) => rowOf(item, kind === "album" && title ? title : undefined))
    .filter((row): row is ImportRow => row !== null);
  const listed = list(tracks.items).length;
  const capped = rows.length > MAX_ROWS;
  return {
    source: "apple-music",
    label: title.slice(0, MAX_LABEL_CHARS),
    rows: capped ? rows.slice(0, MAX_ROWS) : rows,
    ...(capped
      ? { notice: { kind: "capped" as const, kept: MAX_ROWS } }
      : total > listed
        ? { notice: { kind: "partial" as const, shown: rows.length, total } }
        : {}),
  };
}

export async function listApple(href: string, http: Http): Promise<Listing> {
  const link = parseAppleLink(href);
  if (!link) throw new ImportError("bad_link");
  let response: Response;
  try {
    response = await get(applePageUrl(link), http);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw toImportError(error);
    if (link.storefront === "us") throw new ImportError("gone");
    try {
      response = await get(applePageUrl(link, "us"), http);
    } catch (retry) {
      throw toImportError(retry);
    }
  }
  let html: string | null;
  try {
    html = await readCapped(response, MAX_PAGE_BYTES);
  } catch (error) {
    throw toImportError(error);
  }
  if (html === null) throw new ImportError("source_changed");
  return parseApplePage(html, link.kind);
}

function toImportError(error: unknown): unknown {
  if (!(error instanceof HttpError)) return error;
  return new ImportError(error.status === 404 || error.status === 410 ? "gone" : "network");
}
