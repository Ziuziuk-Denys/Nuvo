import { ImportError, type CatalogTrack, type ImportRow, type Listing } from "./types";

export interface YoutubeImportedList {
  title: string;
  tracks: {
    ytId: string;
    title: string;
    artistTexts: string[];
    artistChannelIds: string[];
    albumTitle?: string;
    albumBrowseId?: string;
    durationMs?: number;
    coverUrl: string;
  }[];
}

export interface YoutubeLister {
  importUrl(url: string, signal: AbortSignal): Promise<YoutubeImportedList>;
}

const CODES: Record<string, ConstructorParameters<typeof ImportError>[0]> = {
  "sign-in-required": "login_required",
  "empty-playlist": "empty",
  "not-found": "gone",
  "bad-url": "bad_link",
  "bad-id": "bad_link",
};

function rowOf(item: YoutubeImportedList["tracks"][number]): ImportRow {
  const track: CatalogTrack = {
    id: item.ytId,
    title: item.title,
    artists: item.artistTexts.map((name, i) => ({
      id: item.artistChannelIds?.[i] ?? "",
      name,
    })),
    ...(item.albumTitle ? { album: { id: item.albumBrowseId ?? "", title: item.albumTitle } } : {}),
    durationMs: item.durationMs ?? 0,
    ...(item.coverUrl ? { cover: { url: item.coverUrl } } : {}),
  };
  return {
    title: item.title,
    artists: item.artistTexts,
    ...(item.albumTitle ? { album: item.albumTitle } : {}),
    ...(item.durationMs ? { durationMs: item.durationMs } : {}),
    track,
  };
}

export async function listYoutube(url: string, youtube: YoutubeLister, signal: AbortSignal): Promise<Listing> {
  let list: YoutubeImportedList;
  try {
    list = await youtube.importUrl(url, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    throw new ImportError(typeof code === "string" && code in CODES ? CODES[code] : "network");
  }
  // The client is not trusted to match its type: a malformed list is a network failure.
  if (!list || !Array.isArray(list.tracks) || typeof list.title !== "string") throw new ImportError("network");
  const rows: ImportRow[] = [];
  for (const item of list.tracks) {
    if (typeof item?.ytId === "string" && typeof item.title === "string" && Array.isArray(item.artistTexts)) rows.push(rowOf(item));
  }
  return { source: "youtube-music", label: list.title.trim(), rows };
}
