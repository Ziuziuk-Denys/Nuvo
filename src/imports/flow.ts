/**
 * The link import flow: detect, list, post, then hand the new imports to the
 * workers. Listing and posting are separate so the preview can show the rows before anything is
 * written; `importFromLink` runs both. A cancel during listing posts nothing.
 */
import { listApple } from "./apple";
import { CoreError, type ImportsDaemon } from "./core";
import { listDeezer } from "./deezer";
import { detectLink, hostMatches } from "./detect";
import type { FetchLike, Sleep } from "./http";
import { ImportError, MAX_LABEL_CHARS, MAX_ROWS, type ImportSummary, type ImportTarget, type Listing, type RowSource } from "./types";
import { listYoutube, type YoutubeLister } from "./youtube";

export interface ListPorts {
  /** Requests to the public sources (Apple Music pages, Deezer's API). */
  fetch: FetchLike;
  sleep?: Sleep;
  youtube: YoutubeLister;
  daemon: Pick<ImportsDaemon, "soundcloudListing" | "spotifyListing">;
}

export interface PostPorts {
  daemon: Pick<ImportsDaemon, "start"> & Partial<Pick<ImportsDaemon, "appendRows">>;
  /** Translated names for a listing without a title, and "{name}: Likes". */
  labels: { fallback(source: RowSource): string; likes(name: string): string };
  /** New imports: shown at once, and the ones still matching get workers. */
  started(summaries: ImportSummary[]): void;
}

export const PROGRESS_EVERY_MS = 120;
/** A listing is posted in pages of this many rows. */
export const POST_PAGE_ROWS = 500;

/** Calls `fn` at most once per `everyMs`. */
export function throttle(fn: (count: number) => void, everyMs: number, now: () => number = Date.now): (count: number) => void {
  let last = -Infinity;
  return (count) => {
    const at = now();
    if (at - last < everyMs) return;
    last = at;
    fn(count);
  };
}

function daemonError(error: unknown): unknown {
  if (!(error instanceof CoreError)) return error;
  if (error.status === 423) return new ImportError("locked");
  return new ImportError("daemon");
}

/** A listing the daemon reads; its statuses become the import's error codes. */
async function listByDaemon(read: () => Promise<Listing>): Promise<Listing> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    if (error.status === 400) throw new ImportError("bad_link");
    if (error.status === 404) throw new ImportError("gone");
    if (error.code === "SOURCE_CHANGED") throw new ImportError("source_changed");
    if (error.status === 423 || error.status === 0) throw daemonError(error);
    throw new ImportError("network");
  }
}

/** Public playlists and albums by link; Liked songs, tracks and profiles only through the export file. */
function spotifyReadable(url: string): boolean {
  const { hostname, pathname } = new URL(url);
  if (hostname === "spotify.link") return true;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  return parts.length === 2 && (parts[0] === "playlist" || parts[0] === "album");
}

/** Reads a pasted link into rows. Nothing is written. */
export async function listLink(text: string, ports: ListPorts, signal: AbortSignal, onProgress: (count: number) => void = () => {}): Promise<Listing> {
  const detected = detectLink(text);
  if ("error" in detected) throw new ImportError(detected.error, detected.host);
  const progress = throttle(onProgress, PROGRESS_EVERY_MS);
  const http = { fetch: ports.fetch, sleep: ports.sleep, signal };
  let listing: Listing;
  switch (detected.kind) {
    case "spotify":
      if (!spotifyReadable(detected.url)) throw new ImportError("spotify_file_only");
      listing = await listByDaemon(() => ports.daemon.spotifyListing(detected.url, signal));
      break;
    case "yandex-music":
      throw new ImportError("yandex_lists");
    case "vk":
      throw new ImportError("login_required");
    case "apple-music":
      listing = await listApple(detected.url, http);
      break;
    case "deezer":
      listing = await listDeezer(detected.url, http, progress);
      break;
    case "youtube":
      listing = await listYoutube(detected.url, ports.youtube, signal);
      break;
    case "soundcloud":
      listing = await listByDaemon(() => ports.daemon.soundcloudListing(detected.url, signal));
      break;
  }
  signal.throwIfAborted();
  if (listing.rows.length === 0) throw new ImportError("empty");
  if (listing.rows.length > MAX_ROWS) {
    listing = {
      ...listing,
      rows: listing.rows.slice(0, MAX_ROWS),
      notice: { kind: "capped", kept: MAX_ROWS },
    };
  }
  // the throttle may have dropped the last counts; the screen must end on the true one
  onProgress(listing.rows.length);
  return listing;
}

const SOUNDCLOUD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The likes field: a bare name (with or without "@") or a SoundCloud link. */
export function soundcloudLikesUrl(nameOrUrl: string): string {
  const value = nameOrUrl.trim().replace(/^@/, "");
  if (!value) throw new ImportError("missing_name");
  const detected = detectLink(value);
  if ("kind" in detected && detected.kind === "soundcloud" && hostMatches(new URL(detected.url).hostname, "soundcloud.com")) return detected.url;
  if (!SOUNDCLOUD_NAME.test(value)) throw new ImportError("bad_link");
  return `https://soundcloud.com/${value}/likes`;
}

export function labelOf(listing: Listing, labels: PostPorts["labels"]): string {
  const raw = listing.likesOf ? labels.likes(listing.likesOf) : listing.label;
  const label = raw.trim() || labels.fallback(listing.source);
  return [...label].slice(0, MAX_LABEL_CHARS).join("");
}

/** Posts listed rows as one import; the workers start on the answer. */
export async function postListing(listing: Listing, target: ImportTarget | undefined, ports: PostPorts, signal?: AbortSignal): Promise<ImportSummary[]> {
  let summaries: ImportSummary[];
  try {
    summaries = await ports.daemon.start(
      {
        source: listing.source,
        label: labelOf(listing, ports.labels),
        rows: listing.rows.slice(0, POST_PAGE_ROWS),
        ...(target && target.kind !== "new" ? { target } : {}),
      },
      signal,
    );
  } catch (error) {
    throw daemonError(error);
  }
  ports.started(summaries);
  // the rest follows page by page; a page that fails leaves the earlier ones imported
  const first = summaries[0];
  if (listing.rows.length > POST_PAGE_ROWS && first && ports.daemon.appendRows) {
    try {
      for (let at = POST_PAGE_ROWS; at < listing.rows.length; at += POST_PAGE_ROWS) {
        signal?.throwIfAborted();
        await ports.daemon.appendRows(first.id, listing.rows.slice(at, at + POST_PAGE_ROWS), signal);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ImportError("cut");
    }
  }
  return summaries;
}

export interface LinkImportOptions {
  target?: ImportTarget;
  signal: AbortSignal;
  onProgress?: (count: number) => void;
}

export async function importFromLink(
  text: string,
  ports: ListPorts & PostPorts,
  options: LinkImportOptions,
): Promise<{ listing: Listing; summaries: ImportSummary[] }> {
  const listing = await listLink(text, ports, options.signal, options.onProgress);
  return {
    listing,
    summaries: await postListing(listing, options.target, ports, options.signal),
  };
}

export async function importSoundCloudLikes(
  nameOrUrl: string,
  ports: ListPorts & PostPorts,
  options: LinkImportOptions,
): Promise<{ listing: Listing; summaries: ImportSummary[] }> {
  return importFromLink(soundcloudLikesUrl(nameOrUrl), ports, options);
}

/** A picked file (Spotify export, M3U, Nuvo JSON) sent as base64 bytes, never as a path; one import per playlist inside. */
export async function importFile(
  file: { name: string; data: string },
  target: ImportTarget | undefined,
  ports: Omit<PostPorts, "labels">,
): Promise<ImportSummary[]> {
  let summaries: ImportSummary[];
  try {
    summaries = await ports.daemon.start({
      file,
      ...(target && target.kind !== "new" ? { target } : {}),
    });
  } catch (error) {
    if (error instanceof CoreError && (error.status === 400 || error.status === 404)) throw new ImportError("bad_file");
    throw daemonError(error);
  }
  ports.started(summaries);
  return summaries;
}
