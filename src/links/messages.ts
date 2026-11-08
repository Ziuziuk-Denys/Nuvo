/**
 * Translation keys for everything the link block and the sheets say. Pure: the UI passes the result to
 * `t(key, vars)`. Service names are brands and stay untranslated.
 */
import type { FoundVia, LinkResult, Stage } from "./resolve";
import type { Service } from "./router";

export interface Message {
  key: string;
  vars?: Record<string, string | number>;
}

const SERVICE_NAMES: Partial<Record<Service, string>> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  "apple-music": "Apple Music",
  deezer: "Deezer",
  spotify: "Spotify",
  yandex: "Yandex Music",
  vk: "VK Music",
  shazam: "Shazam",
};

/** The source label above the block; `null` means "use the translated `ui.links.service.<id>`". */
export function serviceName(service: Service): string | null {
  return SERVICE_NAMES[service] ?? null;
}

export function serviceLabel(service: Service, t: (key: string) => string): string {
  return serviceName(service) ?? t(`ui.links.service.${service === "nuvo" ? "nuvo" : "web"}`);
}

export function stageMessage(stage: Stage): Message {
  return stage.stage === "looking" ? { key: "ui.links.stage.looking", vars: { title: stage.title } } : { key: `ui.links.stage.${stage.stage}` };
}

export function viaMessage(via: FoundVia): Message {
  return { key: `ui.links.via.${via}` };
}

const ERROR_CODES = new Set([
  "invalid_link",
  "unsupported",
  "unavailable",
  "login_required",
  "region_blocked",
  "age_gated",
  "drm",
  "blocked",
  "throttled",
  "tool_missing",
  "decode_failed",
  "busy",
  "network",
  "newer_link",
  "bad_share",
  "spotify_file_only",
  "yandex_lists",
  "core_down",
  "locked",
  "proxy_unsupported",
  "failed",
]);

/** An unknown code reads as `unavailable`. `service` is the display name, `host` the link's host. */
export function errorMessage(code: string, service: string, host?: string): Message {
  const known = ERROR_CODES.has(code) ? code : "unavailable";
  return {
    key: `ui.links.error.${known}`,
    vars: { service, host: host ?? service },
  };
}

export function notFoundMessage(result: Extract<LinkResult, { kind: "not_found" }>): Message {
  switch (result.reason) {
    case "named_sound":
      return {
        key: "ui.links.not_found.named_sound",
        vars: { title: result.title ?? "", author: result.author ?? "" },
      };
    case "original_sound":
      return { key: "ui.links.not_found.original_sound" };
    case "sound_page":
      return {
        key: "ui.links.not_found.sound_page",
        vars: { title: result.title ?? "" },
      };
    case "song":
      return result.title
        ? {
            key: "ui.links.not_found.song_named",
            vars: { title: result.title },
          }
        : { key: "ui.links.not_found.song" };
  }
}

/** Display text from a link: bidi overrides and control characters removed, at most 200 characters. */
export function displayText(text: string): string {
  const clean = text
    .replace(/[\p{Cc}\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, 200).join("");
}
