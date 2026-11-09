// Deny by default: only http, https and nuvo; unknown web hosts go only to yt-dlp inspection

export type Service = "nuvo" | "tiktok" | "youtube" | "soundcloud" | "apple-music" | "deezer" | "spotify" | "yandex" | "vk" | "shazam" | "web";

export type ImportService = "youtube" | "soundcloud" | "apple-music" | "deezer" | "spotify";

export type RouteErrorCode = "invalid_link" | "bad_share" | "unsupported" | "login_required" | "spotify_file_only" | "yandex_lists";

export type LinkRoute =
  | { kind: "share"; payload: string }
  | { kind: "navigate"; type: "artist" | "album" | "playlist"; id: string }
  | { kind: "youtube"; id: string; url: string; playlistId?: string }
  | { kind: "tiktok"; url: string }
  | { kind: "tiktok-sound"; url: string; title: string }
  | { kind: "soundcloud"; url: string }
  | { kind: "apple-song"; id: string; storefront: string; url: string }
  | { kind: "deezer-track"; id: string; url: string }
  | { kind: "yandex-track"; id: string; url: string }
  | { kind: "shazam"; slug: string; id?: string; url: string }
  | { kind: "import"; service: ImportService; url: string }
  | { kind: "short"; service: Service; url: string }
  | { kind: "media"; url: string; host: string }
  | { kind: "error"; code: RouteErrorCode; service: Service; host?: string };

export const MAX_WEB_LINK = 2_048;
export const MAX_NUVO_LINK = 65_536 + "nuvo://share?id=".length;

const ID = /^[A-Za-z0-9_-]+$/;
const NAV_RULES = {
  artist: /^UC[A-Za-z0-9_-]{22}$/,
  album: /^MPRE[A-Za-z0-9_-]{4,64}$/,
  playlist: /^[A-Za-z0-9_-]{8,64}$/,
  track: /^[A-Za-z0-9_-]{11}$/,
} as const;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TRACKING = /^(si|utm_.*|_r|_t|is_from_webapp|sender_device|feature|igsh|fbclid)$/i;
const DANGEROUS_SCHEME = /^(javascript|data|file|vbscript|blob|about|chrome|ftp|ws|wss):/i;

const KNOWN_HOSTS: [string, Service][] = [
  ["tiktok.com", "tiktok"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["soundcloud.com", "soundcloud"],
  ["music.apple.com", "apple-music"],
  ["itunes.apple.com", "apple-music"],
  ["deezer.com", "deezer"],
  ["deezer.page.link", "deezer"],
  ["link.deezer.com", "deezer"],
  ["open.spotify.com", "spotify"],
  ["spotify.com", "spotify"],
  ["spotify.link", "spotify"],
  ["music.yandex.ru", "yandex"],
  ["music.yandex.com", "yandex"],
  ["music.yandex.by", "yandex"],
  ["music.yandex.kz", "yandex"],
  ["vk.com", "vk"],
  ["vk.ru", "vk"],
  ["shazam.com", "shazam"],
];

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function serviceOf(host: string): Service | null {
  return KNOWN_HOSTS.find(([domain]) => matches(host, domain))?.[1] ?? null;
}

export function cleanUrl(url: URL): string {
  const out = new URL(url.href);
  out.hash = "";
  // a copy of the keys: deleting while iterating the live list skips entries
  for (const key of Array.from(out.searchParams.keys())) if (TRACKING.test(key)) out.searchParams.delete(key);
  return out.href;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isAddressLiteral(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.startsWith("[");
}

export function routeLink(input: string): LinkRoute | null {
  const text = input.trim();
  const shared = /(?:^|\s)(nuvo:\/\/share\?id=\S*)/.exec(text);
  if (shared && /\s/.test(text)) return routeNuvo(shared[1]);
  if (!text || /\s/.test(text)) return null;
  if (/^nuvo:/i.test(text)) return routeNuvo(text);
  if (DANGEROUS_SCHEME.test(text)) return { kind: "error", code: "invalid_link", service: "web" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return { kind: "error", code: "invalid_link", service: "web" };
  if (!hasScheme) {
    const first = text.split(/[/?#]/, 1)[0].toLowerCase();
    if (!serviceOf(first.replace(/^www\./, "")) || first.includes("@") || first.includes(":")) return null;
  }
  if (text.length > MAX_WEB_LINK) return { kind: "error", code: "invalid_link", service: "web" };
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return hasScheme ? { kind: "error", code: "invalid_link", service: "web" } : null;
  }
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) return { kind: "error", code: "invalid_link", service: "web" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isAddressLiteral(host)) return { kind: "error", code: "invalid_link", service: "web" };
  const service = serviceOf(host);
  const path = url.pathname.split("/").filter(Boolean);
  const clean = cleanUrl(url);
  switch (service) {
    case "tiktok":
      return routeTikTok(host, path, clean);
    case "youtube":
      return routeYouTube(host, path, url.searchParams, clean);
    case "soundcloud":
      if (host === "on.soundcloud.com") return { kind: "short", service, url: clean };
      if (path.length === 2 && path[1] === "likes") return { kind: "import", service, url: clean };
      if (path.length === 3 && path[1] === "sets") return { kind: "import", service, url: clean };
      return path.length >= 1 ? { kind: "soundcloud", url: clean } : { kind: "error", code: "unsupported", service, host };
    case "apple-music":
      return routeApple(path, url.searchParams, clean, host);
    case "deezer":
      return routeDeezer(host, path, clean);
    case "spotify":
      return routeSpotify(host, path, clean);
    case "yandex":
      return routeYandex(path, clean, host);
    case "vk":
      if (/^audio-?\d/.test(path[0] ?? "") || path[0] === "audio" || path[0] === "music") return { kind: "error", code: "login_required", service };
      return { kind: "media", url: clean, host };
    case "shazam":
      return routeShazam(path, clean, host);
    default:
      // the daemon allows only public addresses for media hosts (ensure_public in links/inspect)
      return { kind: "media", url: clean, host };
  }
}

function routeNuvo(text: string): LinkRoute {
  if (text.length > MAX_NUVO_LINK) return { kind: "error", code: "bad_share", service: "nuvo" };
  const match = /^nuvo:\/\/([A-Za-z]+)\?(.*)$/.exec(text);
  if (!match) return { kind: "error", code: "invalid_link", service: "nuvo" };
  const type = match[1].toLowerCase();
  const ids = new URLSearchParams(match[2]).getAll("id");
  if (type === "share") {
    return ids.length === 1 && ids[0].length >= 2 && ID.test(ids[0])
      ? { kind: "share", payload: ids[0] }
      : { kind: "error", code: "bad_share", service: "nuvo" };
  }
  if (!(type in NAV_RULES) || ids.length !== 1 || !NAV_RULES[type as keyof typeof NAV_RULES].test(ids[0]))
    return { kind: "error", code: "invalid_link", service: "nuvo" };
  if (type === "track") return { kind: "youtube", id: ids[0], url: `https://youtu.be/${ids[0]}` };
  return {
    kind: "navigate",
    type: type as "artist" | "album" | "playlist",
    id: ids[0],
  };
}

function routeTikTok(host: string, path: string[], url: string): LinkRoute {
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com" || path[0] === "t") return { kind: "tiktok", url };
  if (path[0] === "v" && /^\d{15,21}(\.html)?$/.test(path[1] ?? "")) return { kind: "tiktok", url };
  if (path[0]?.startsWith("@") && (path[1] === "video" || path[1] === "photo") && /^\d{15,21}$/.test(path[2] ?? "")) return { kind: "tiktok", url };
  if (path[0] === "music" && path[1]) {
    const slug = decode(path[1]).replace(/-\d{6,}$/, "");
    const title = slug.replace(/-+/g, " ").trim();
    if (title) return { kind: "tiktok-sound", url, title };
  }
  return { kind: "error", code: "unsupported", service: "tiktok", host };
}

function routeYouTube(host: string, path: string[], params: URLSearchParams, url: string): LinkRoute {
  const list = params.get("list") ?? undefined;
  const listId = list && ID.test(list) && !list.startsWith("RD") ? list : undefined;
  let id: string | undefined;
  if (host === "youtu.be") id = path[0];
  else if (path[0] === "watch") id = params.get("v") ?? undefined;
  else if ((path[0] === "shorts" || path[0] === "live" || path[0] === "embed") && path[1]) id = path[1];
  if (id && YOUTUBE_ID.test(id))
    return {
      kind: "youtube",
      id,
      url,
      ...(listId ? { playlistId: listId } : {}),
    };
  if (path[0] === "playlist" && listId) return { kind: "import", service: "youtube", url };
  if (path[0] === "browse" && /^MPRE[A-Za-z0-9_-]{4,64}$/.test(path[1] ?? "")) return { kind: "import", service: "youtube", url };
  return { kind: "error", code: "unsupported", service: "youtube", host };
}

function routeApple(path: string[], params: URLSearchParams, url: string, host: string): LinkRoute {
  const parts = /^[a-z]{2}$/i.test(path[0] ?? "") ? path.slice(1) : path;
  const storefront = parts === path ? "us" : path[0].toLowerCase();
  const last = parts[parts.length - 1] ?? "";
  const trackId = params.get("i");
  if (parts[0] === "album" && trackId && /^\d+$/.test(trackId)) return { kind: "apple-song", id: trackId, storefront, url };
  if (parts[0] === "song" && /^\d+$/.test(last)) return { kind: "apple-song", id: last, storefront, url };
  if ((parts[0] === "album" && /^\d+$/.test(last)) || (parts[0] === "playlist" && /^pl\.[A-Za-z0-9-]+$/.test(last)))
    return { kind: "import", service: "apple-music", url };
  return { kind: "error", code: "unsupported", service: "apple-music", host };
}

function routeDeezer(host: string, path: string[], url: string): LinkRoute {
  if (host === "deezer.page.link" || host === "link.deezer.com") return { kind: "short", service: "deezer", url };
  const parts = /^[a-z]{2}(-[a-z]{2})?$/i.test(path[0] ?? "") ? path.slice(1) : path;
  if (parts[0] === "track" && /^\d+$/.test(parts[1] ?? "")) return { kind: "deezer-track", id: parts[1], url };
  if ((parts[0] === "album" || parts[0] === "playlist") && /^\d+$/.test(parts[1] ?? "")) return { kind: "import", service: "deezer", url };
  return { kind: "error", code: "unsupported", service: "deezer", host };
}

function routeSpotify(host: string, path: string[], url: string): LinkRoute {
  if (host === "spotify.link") return { kind: "short", service: "spotify", url };
  const parts = path[0]?.startsWith("intl-") ? path.slice(1) : path;
  if ((parts[0] === "playlist" || parts[0] === "album") && /^[A-Za-z0-9]{22}$/.test(parts[1] ?? "") && parts.length === 2)
    return { kind: "import", service: "spotify", url };
  return { kind: "error", code: "spotify_file_only", service: "spotify" };
}

function routeYandex(path: string[], url: string, host: string): LinkRoute {
  const track = path[0] === "track" ? path[1] : path[0] === "album" && path[2] === "track" ? path[3] : undefined;
  if (track && /^\d+$/.test(track)) return { kind: "yandex-track", id: track, url };
  if (path[0] === "album" || path.includes("playlists")) return { kind: "error", code: "yandex_lists", service: "yandex" };
  return { kind: "error", code: "unsupported", service: "yandex", host };
}

function routeShazam(path: string[], url: string, host: string): LinkRoute {
  const parts = /^[a-z]{2}(-[a-z]{2})?$/i.test(path[0] ?? "") ? path.slice(1) : path;
  const slug = parts[2] ? decode(parts[2]).replace(/-+/g, " ").trim() : "";
  if (parts[0] === "song" && /^\d+$/.test(parts[1] ?? "") && slug) return { kind: "shazam", id: parts[1], slug, url };
  if (parts[0] === "track" && parts[1] && slug) return { kind: "shazam", slug, url };
  return { kind: "error", code: "unsupported", service: "shazam", host };
}
