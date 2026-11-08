/** Request header rewriting for YouTube and scoped CORS for media hosts. Pure. */

export type Headers = Record<string, string | string[]>;

export const UA_HEADER = "x-nuvo-ua";

/** Public pages and APIs the import reads; they send no CORS headers for the app's origin. */
export const IMPORT_HOSTS = ["music.apple.com", "api.deezer.com", "www.deezer.com", "deezer.page.link", "link.deezer.com"];

/** Hosts whose responses the audio graph and the cover accent read cross-origin, and the import hosts. */
export const CORS_HOSTS = [
  "*.youtube.com",
  "*.googlevideo.com",
  "*.ytimg.com",
  "lh3.googleusercontent.com",
  "yt3.ggpht.com",
  "*.sndcdn.com",
  "playback.media-streaming.soundcloud.cloud",
  ...IMPORT_HOSTS,
];

/** Song lookups for pasted links; these APIs send no CORS headers for the app's origin. */
export const LOOKUP_HOSTS = ["api.deezer.com", "api.music.yandex.net"];

/** Removed together with the Apple Music import. */
export const APPLE_MUSIC_HOSTS = ["api.music.apple.com", "amp-api.music.apple.com"];

export function hostMatches(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => (pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) || host === pattern.slice(2) : host === pattern));
}

function withoutKeys(headers: Headers, names: string[]): Headers {
  const lower = names.map((n) => n.toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !lower.includes(key.toLowerCase())));
}

function find(headers: Headers, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  if (!entry) return undefined;
  return Array.isArray(entry[1]) ? entry[1][0] : entry[1];
}

export function rewriteRequestHeaders(url: string, headers: Headers): Headers {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return headers;
  }
  if (hostMatches(host, ["*.youtube.com", "*.googlevideo.com"])) {
    const origin = host === "www.youtube.com" ? "https://www.youtube.com" : "https://music.youtube.com";
    const agent = find(headers, UA_HEADER);
    const next = withoutKeys(headers, ["origin", "referer", UA_HEADER, ...(agent ? ["user-agent"] : [])]);
    return { ...next, Origin: origin, Referer: `${origin}/`, ...(agent ? { "User-Agent": agent } : {}) };
  }
  if (APPLE_MUSIC_HOSTS.includes(host)) {
    return { ...withoutKeys(headers, ["origin", "referer"]), Origin: "https://music.apple.com", Referer: "https://music.apple.com/" };
  }
  return headers;
}

const RELAXED: Headers = {
  "access-control-allow-origin": ["*"],
  "access-control-allow-headers": ["*, authorization"],
  "access-control-allow-methods": ["OPTIONS, GET, HEAD, POST, PUT, PATCH, DELETE"],
  "access-control-expose-headers": ["*"],
  "access-control-max-age": ["600"],
};

export function relaxCors(url: string, method: string, headers: Headers, statusLine: string): { headers: Headers; statusLine: string } {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { headers, statusLine };
  }
  if (!hostMatches(host, [...CORS_HOSTS, ...LOOKUP_HOSTS, ...APPLE_MUSIC_HOSTS])) return { headers, statusLine };
  const kept = Object.fromEntries(Object.entries(headers).filter(([key]) => !key.toLowerCase().startsWith("access-control-")));
  return { headers: { ...kept, ...RELAXED }, statusLine: method.toUpperCase() === "OPTIONS" ? "HTTP/1.1 200 OK" : statusLine };
}
