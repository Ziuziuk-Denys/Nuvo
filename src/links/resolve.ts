import { CoreError, type Heard, type InspectAnswer, type ListenVia, type SoundCloudItem } from "./core";
import { lookupApple, lookupDeezer, lookupShazam, lookupYandex, type FetchJson, type SongLookup } from "./lookup";
import { alternatives, matchByName, type MatchPorts, type MatchResult } from "./match";
import { routeLink, type ImportService, type LinkRoute, type Service } from "./router";
import { ShareError, decodeShare, type Share } from "./shareCodec";
import type { CatalogTrack, MatchSource } from "./types";

export interface LinkPorts extends MatchPorts {
  inspect(url: string, signal: AbortSignal): Promise<InspectAnswer>;
  recognize(url: string, part: 0 | 1, signal: AbortSignal, onListening: (via: ListenVia) => void): Promise<Heard>;
  youtubeTrack(id: string, signal: AbortSignal): Promise<CatalogTrack | null>;
  soundcloudLookup(url: string, signal: AbortSignal): Promise<SoundCloudItem | null>;
  soundcloudTrack(id: string, signal: AbortSignal): Promise<CatalogTrack | null>;
  fetchJson: FetchJson;
}

export type Stage =
  { stage: "reading_tiktok" } | { stage: "reading_link" } | { stage: "looking"; title: string } | { stage: "listening_sound" } | { stage: "listening_video" };

export type FoundVia = "link" | "tiktok_name" | "recognized_sound" | "recognized_video" | "by_name" | "media_tags" | "share_gone";

export type LinkResult =
  | {
      kind: "track";
      track: CatalogTrack;
      via: FoundVia;
      sure: boolean;
      others: CatalogTrack[];
      listenUrl?: string;
      playlistUrl?: string;
    }
  | { kind: "import"; service: ImportService; url: string }
  | { kind: "share"; share: Share }
  | { kind: "navigate"; type: "artist" | "album" | "playlist"; id: string }
  | {
      kind: "not_found";
      reason: "named_sound" | "original_sound" | "sound_page" | "song";
      title?: string;
      author?: string;
      proposal?: CatalogTrack;
      more: boolean;
      listenUrl?: string;
    }
  | { kind: "error"; code: string; service: Service; host?: string };

export type Report = (stage: Stage) => void;

const ORIGINAL_SOUND =
  /^(original sound|оригинальный звук|som original|sonido original|son original|suono originale|originalton|oryginalny dźwięk|orijinal ses|оригінальний звук)/i;

function error(code: string, service: Service, host?: string): LinkResult {
  return { kind: "error", code, service, ...(host ? { host } : {}) };
}

function fromMatch(result: MatchResult, via: FoundVia, extra: { listenUrl?: string } = {}): LinkResult | null {
  if (result.status === "approved")
    return {
      kind: "track",
      track: result.track,
      via,
      sure: true,
      others: alternatives(result),
      ...extra,
    };
  if (result.proposedTrack)
    return {
      kind: "track",
      track: result.proposedTrack,
      via,
      sure: false,
      others: alternatives(result),
      ...extra,
    };
  return null;
}

function coreCode(caught: unknown): string {
  if (!(caught instanceof CoreError)) return "failed";
  if (caught.status === 0 || caught.status === 503) return "core_down";
  if (caught.status === 423) return "locked";
  return "failed";
}

export async function resolveLink(route: LinkRoute, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  try {
    return await resolveRoute(route, ports, report, signal, true);
  } catch (caught) {
    if (signal.aborted) throw caught;
    return error(coreCode(caught), "nuvo");
  }
}

async function resolveRoute(route: LinkRoute, ports: LinkPorts, report: Report, signal: AbortSignal, followShort: boolean): Promise<LinkResult> {
  switch (route.kind) {
    case "error":
    case "import":
    case "navigate":
      return route;
    case "share":
      return resolveShare(route.payload, ports, report, signal);
    case "youtube": {
      report({ stage: "reading_link" });
      const track = await ports.youtubeTrack(route.id, signal);
      if (!track) return error("unavailable", "youtube");
      return {
        kind: "track",
        track,
        via: "link",
        sure: true,
        others: [],
        listenUrl: route.url,
        ...(route.playlistId
          ? {
              playlistUrl: `https://www.youtube.com/playlist?list=${route.playlistId}`,
            }
          : {}),
      };
    }
    case "tiktok":
      return resolveTikTok(route.url, ports, report, signal);
    case "tiktok-sound": {
      report({ stage: "looking", title: route.title });
      const result = await matchByName({ title: route.title }, ports, signal);
      return result.status === "approved"
        ? (fromMatch(result, "by_name") as LinkResult)
        : {
            kind: "not_found",
            reason: "sound_page",
            title: route.title,
            more: false,
          };
    }
    case "soundcloud": {
      report({ stage: "reading_link" });
      const item = await ports.soundcloudLookup(route.url, signal);
      if (!item) return error("unavailable", "soundcloud");
      if (item.type === "track") {
        const { type: _type, ...track } = item;
        return { kind: "track", track, via: "link", sure: true, others: [] };
      }
      if (item.type === "artist") return { kind: "navigate", type: "artist", id: item.id };
      return { kind: "import", service: "soundcloud", url: route.url };
    }
    case "short": {
      report({ stage: "reading_link" });
      const answer = await ports.inspect(route.url, signal);
      if ("error" in answer) return error(answer.error, route.service);
      const next = answer.kind === "redirect" ? routeLink(answer.canonicalUrl) : null;
      if (!followShort || !next || next.kind === "short") return error("unsupported", route.service);
      return resolveRoute(next, ports, report, signal, false);
    }
    case "apple-song":
      return bySongLookup(await lookupApple(route.id, route.storefront, ports.fetchJson, signal), "apple-music", ports, report, signal);
    case "deezer-track":
      return bySongLookup(await lookupDeezer(route.id, ports.fetchJson, signal), "deezer", ports, report, signal);
    case "yandex-track":
      return bySongLookup(await lookupYandex(route.id, ports.fetchJson, signal), "yandex", ports, report, signal);
    case "shazam":
      return bySongLookup(await lookupShazam(route.slug, route.id, ports.fetchJson, signal), "shazam", ports, report, signal);
    case "media":
      return resolveMedia(route.url, route.host, ports, report, signal);
  }
}

async function bySongLookup(lookup: SongLookup, service: Service, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  if (lookup.kind === "error") return error(lookup.code, service);
  report({ stage: "looking", title: lookup.source.title });
  const result = await matchByName(lookup.source, ports, signal);
  const found = fromMatch(result, "by_name");
  if (!found)
    return {
      kind: "not_found",
      reason: "song",
      title: lookup.source.title,
      author: lookup.source.artists?.[0],
      more: false,
    };
  if (found.kind === "track" && lookup.isrc) found.track = { ...found.track, isrc: lookup.isrc };
  return found;
}

async function resolveShare(payload: string, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  let share: Share;
  try {
    share = await decodeShare(payload);
  } catch (caught) {
    if (caught instanceof ShareError) return error(caught.code, "nuvo");
    throw caught;
  }
  if (share.tracks.length > 1) return { kind: "share", share };
  const [song] = share.tracks;
  const named: MatchSource | null =
    song.title !== undefined
      ? {
          title: song.title,
          artists: song.artist ? [song.artist] : [],
          durationMs: song.durationSec ? song.durationSec * 1000 : undefined,
        }
      : null;
  if (song.source !== "text") {
    report({ stage: "reading_link" });
    const track = song.source === "youtube" ? await ports.youtubeTrack(song.id as string, signal) : await ports.soundcloudTrack(`sc:${song.id}`, signal);
    if (track) return { kind: "track", track, via: "link", sure: true, others: [] };
    if (!named) return error("unavailable", song.source);
  }
  if (!named) return error("bad_share", "nuvo");
  report({ stage: "looking", title: named.title });
  const found = fromMatch(await matchByName(named, ports, signal), song.source === "text" ? "by_name" : "share_gone");
  return (
    found ?? {
      kind: "not_found",
      reason: "song",
      title: named.title,
      author: named.artists?.[0],
      more: false,
    }
  );
}

async function resolveTikTok(url: string, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  report({ stage: "reading_tiktok" });
  const answer = await ports.inspect(url, signal);
  if ("error" in answer) return error(answer.error, "tiktok");
  if (answer.kind === "media") return fromMedia(answer.canonicalUrl, answer.media, "tiktok", ports, report, signal);
  if (answer.kind !== "tiktok") return error("unsupported", "tiktok");
  const sound = answer.sound;
  const named = sound && !sound.original && !ORIGINAL_SOUND.test(sound.title) ? sound : undefined;
  let proposal: CatalogTrack | undefined;
  if (named) {
    report({ stage: "looking", title: named.title });
    // the clip length is never the song's length, so no duration goes to the matcher
    const result = await matchByName({ title: named.title, artists: named.author ? [named.author] : [] }, ports, signal);
    if (result.status === "approved")
      return fromMatch(result, "tiktok_name", {
        listenUrl: answer.canonicalUrl,
      }) as LinkResult;
    proposal = result.proposedTrack;
  }
  const heard = await listen(answer.canonicalUrl, 0, ports, report, signal, "listening_sound");
  if (heard.kind === "found") {
    const found = await matchHeard(heard, ports, report, signal);
    if (found) return found;
  }
  if (heard.kind === "error" && !named) return error(heard.code, "tiktok");
  const more = heard.kind === "not_found" && heard.more;
  if (named)
    return {
      kind: "not_found",
      reason: "named_sound",
      title: named.title,
      author: named.author,
      proposal,
      more,
      listenUrl: answer.canonicalUrl,
    };
  return {
    kind: "not_found",
    reason: "original_sound",
    more,
    listenUrl: answer.canonicalUrl,
  };
}

async function resolveMedia(url: string, host: string, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  report({ stage: "reading_link" });
  const answer = await ports.inspect(url, signal);
  if ("error" in answer) return error(answer.error, "web", host);
  if (answer.kind === "tiktok") return resolveTikTok(answer.canonicalUrl, ports, report, signal);
  if (answer.kind !== "media") return error("unsupported", "web", host);
  return fromMedia(answer.canonicalUrl, answer.media, "web", ports, report, signal, host);
}

async function fromMedia(
  canonicalUrl: string,
  media: {
    track?: string;
    artist?: string;
    durationMs?: number;
    isLive: boolean;
  },
  service: Service,
  ports: LinkPorts,
  report: Report,
  signal: AbortSignal,
  host?: string,
): Promise<LinkResult> {
  let proposal: CatalogTrack | undefined;
  if (media.track && media.artist) {
    report({ stage: "looking", title: media.track });
    const result = await matchByName(
      {
        title: media.track,
        artists: [media.artist],
        durationMs: media.isLive ? undefined : media.durationMs,
      },
      ports,
      signal,
    );
    if (result.status === "approved")
      return fromMatch(result, "media_tags", {
        listenUrl: canonicalUrl,
      }) as LinkResult;
    proposal = result.proposedTrack;
  }
  const heard = await listen(canonicalUrl, 0, ports, report, signal, "listening_video");
  if (heard.kind === "found") {
    const found = await matchHeard(heard, ports, report, signal);
    if (found) return found;
  }
  if (heard.kind === "error") return error(heard.code, service, host);
  return {
    kind: "not_found",
    reason: "song",
    proposal,
    title: media.track,
    author: media.artist,
    more: heard.kind === "not_found" && heard.more,
    listenUrl: canonicalUrl,
  };
}

async function listen(
  url: string,
  part: 0 | 1,
  ports: LinkPorts,
  report: Report,
  signal: AbortSignal,
  first: "listening_sound" | "listening_video",
): Promise<Heard> {
  report({ stage: first });
  return ports.recognize(url, part, signal, (via) => report({ stage: via === "clean" ? "listening_sound" : "listening_video" }));
}

async function matchHeard(heard: Extract<Heard, { kind: "found" }>, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult | null> {
  report({ stage: "looking", title: heard.title });
  const result = await matchByName({ title: heard.title, artists: heard.artist ? [heard.artist] : [] }, ports, signal);
  return fromMatch(result, heard.via === "clean" ? "recognized_sound" : "recognized_video");
}

export async function listenAgain(url: string, part: 0 | 1, ports: LinkPorts, report: Report, signal: AbortSignal): Promise<LinkResult> {
  try {
    const heard = await listen(url, part, ports, report, signal, "listening_video");
    if (heard.kind === "error") return error(heard.code, "web");
    if (heard.kind === "found") {
      const found = await matchHeard(heard, ports, report, signal);
      if (found) return found;
    }
    return {
      kind: "not_found",
      reason: "song",
      more: heard.kind === "not_found" && heard.more && part === 0,
      listenUrl: url,
    };
  } catch (caught) {
    if (signal.aborted) throw caught;
    return error(coreCode(caught), "nuvo");
  }
}
