/**
 * Link detection for imports. Deny by default: only http and https, no
 * credentials, no explicit ports, and only the hosts in the table; everything else is refused
 * before any request is made.
 */
import type { ImportErrorCode } from "./types";

export type LinkKind = "youtube" | "soundcloud" | "apple-music" | "deezer" | "spotify" | "yandex-music" | "vk";

export type Detected =
  | { kind: LinkKind; url: string }
  | {
      error: Extract<ImportErrorCode, "not_a_link" | "unsupported_host">;
      host?: string;
    };

/** Longer text is never a link worth reading. */
export const MAX_LINK_CHARS = 2_048;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A host matches a domain when it equals it or ends with "." plus the domain. */
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const YOUTUBE_HOSTS = ["youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"];
const YANDEX_HOSTS = ["music.yandex.ru", "music.yandex.com", "music.yandex.by", "music.yandex.kz"];

function kindOf(host: string, path: string): LinkKind | null {
  if (YOUTUBE_HOSTS.includes(host)) return "youtube";
  if (hostMatches(host, "soundcloud.com")) return "soundcloud";
  if (hostMatches(host, "music.apple.com") || host === "itunes.apple.com") return "apple-music";
  if (hostMatches(host, "deezer.com") || host === "deezer.page.link") return "deezer";
  if (hostMatches(host, "spotify.com") || host === "spotify.link") return "spotify";
  if (YANDEX_HOSTS.includes(host)) return "yandex-music";
  // only VK's music pages: other VK links are videos and posts, not playlists
  if ((host === "vk.com" || host === "m.vk.com") && /^\/(audio|music)/.test(path)) return "vk";
  return null;
}

export function detectLink(text: string): Detected {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_LINK_CHARS || /\s/.test(trimmed)) return { error: "not_a_link" };
  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "not_a_link" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "not_a_link" };
  if (url.username || url.password || url.port) return { error: "not_a_link" };
  const host = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
  if (!host.includes(".")) return { error: "not_a_link" };
  const kind = kindOf(host, url.pathname);
  if (!kind) return { error: "unsupported_host", host };
  url.hash = "";
  return { kind, url: url.href };
}
