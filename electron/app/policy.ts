const IMAGE_HOSTS = [
  "https://*.ytimg.com",
  "https://lh3.googleusercontent.com",
  "https://yt3.googleusercontent.com",
  "https://yt3.ggpht.com",
  "https://*.sndcdn.com",
];
const MEDIA_HOSTS = ["https://*.googlevideo.com", "https://*.sndcdn.com", "https://playback.media-streaming.soundcloud.cloud"];
const CONNECT_HOSTS = [
  "https://*.youtube.com",
  "https://*.googlevideo.com",
  "https://itunes.apple.com",
  "https://api.deezer.com",
  "https://api.music.yandex.net",
];
const IMPORT_HOSTS = ["https://music.apple.com", "https://api.deezer.com", "https://www.deezer.com", "https://deezer.page.link", "https://link.deezer.com"];
const APPLE_MUSIC = ["https://api.music.apple.com", "https://amp-api.music.apple.com"];

/** `devServer`: the Vite origin in development (its React preamble is inline and HMR uses a websocket). */
export function contentSecurityPolicy(options: { wasm: boolean; appleMusic: boolean; devServer?: string }): string {
  const hmr = options.devServer ? ` ${options.devServer.replace(/^http/, "ws")}` : "";
  return [
    "default-src 'self'",
    `script-src 'self'${options.wasm ? " 'wasm-unsafe-eval'" : ""}${options.devServer ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: nuvo-core: ${IMAGE_HOSTS.join(" ")}`,
    `media-src 'self' blob: nuvo-core: ${MEDIA_HOSTS.join(" ")}`,
    `connect-src 'self' nuvo-core: ${[...CONNECT_HOSTS, ...IMPORT_HOSTS, ...(options.appleMusic ? APPLE_MUSIC : [])].join(" ")}${hmr}`,
    // User fonts come only from main's own font handler
    "font-src 'self' nuvo-core:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export interface AppLocation {
  indexUrl?: string;
  devServerUrl?: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** `url` is the full requesting URL (details.requestingUrl), never just an origin. Query and hash are ignored. */
export function isAppOrigin(url: string, app: AppLocation): boolean {
  const requester = parse(url);
  if (!requester) return false;
  if (requester.protocol === "file:") {
    const index = app.indexUrl ? parse(app.indexUrl) : null;
    return index !== null && requester.host === "" && requester.pathname === index.pathname;
  }
  const dev = app.devServerUrl ? parse(app.devServerUrl) : null;
  return dev !== null && requester.origin !== "null" && requester.origin === dev.origin;
}

const ALLOWED = new Set(["media", "speaker-selection", "clipboard-sanitized-write", "fullscreen"]);

export function allowCheck(permission: string, url: string, details: { mediaType?: string }, app: AppLocation): boolean {
  if (!ALLOWED.has(permission) || !isAppOrigin(url, app)) return false;
  if (permission === "media") return details.mediaType === "audio";
  return true;
}

export function allowRequest(permission: string, url: string, _details: { mediaTypes?: string[] }, app: AppLocation): boolean {
  return permission !== "media" && allowCheck(permission, url, {}, app);
}
