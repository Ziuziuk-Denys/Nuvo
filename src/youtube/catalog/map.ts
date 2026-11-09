import type { AlbumRef, ArtistRef, Cover } from "../types";

// oxlint-disable-next-line typescript/no-explicit-any
export type Obj = Record<string, any>;

export const ARTIST = "MUSIC_PAGE_TYPE_ARTIST";
export const USER_CHANNEL = "MUSIC_PAGE_TYPE_USER_CHANNEL";
export const ALBUM = "MUSIC_PAGE_TYPE_ALBUM";
export const PLAYLIST = "MUSIC_PAGE_TYPE_PLAYLIST";

export function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null;
}

export function textOf(node: unknown): string | undefined {
  if (!isObj(node)) return undefined;
  if (typeof node.simpleText === "string") return node.simpleText.trim() || undefined;
  if (Array.isArray(node.runs)) {
    return (
      node.runs
        .map((run: Obj) => (typeof run?.text === "string" ? run.text : ""))
        .join("")
        .trim() || undefined
    );
  }
  return undefined;
}

export function runsOf(node: unknown): Obj[] {
  return isObj(node) && Array.isArray(node.runs) ? node.runs.filter(isObj) : [];
}

export const isSeparator = (value: string) => value.trim() === "•" || value.trim() === "";

export interface BrowseTarget {
  browseId: string;
  pageType?: string;
  params?: string;
}

export function browseOf(endpoint: unknown): BrowseTarget | undefined {
  const browse = isObj(endpoint) ? endpoint.browseEndpoint : undefined;
  if (!isObj(browse) || typeof browse.browseId !== "string") return undefined;
  const pageType = browse.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  return {
    browseId: browse.browseId,
    pageType: typeof pageType === "string" ? pageType : undefined,
    params: typeof browse.params === "string" ? browse.params : undefined,
  };
}

export function watchIdOf(endpoint: unknown): string | undefined {
  const id = isObj(endpoint) ? endpoint.watchEndpoint?.videoId : undefined;
  return typeof id === "string" && id ? id : undefined;
}

export function artistsFromRuns(runs: Obj[], artistOnly = false): ArtistRef[] {
  const types = artistOnly ? [ARTIST] : [ARTIST, USER_CHANNEL];
  const artists: ArtistRef[] = [];
  for (const run of runs) {
    const target = browseOf(run.navigationEndpoint);
    const name = typeof run.text === "string" ? run.text.trim() : "";
    if (target?.pageType && types.includes(target.pageType) && name) artists.push({ id: target.browseId, name });
  }
  return artists;
}

export function albumFromRuns(runs: Obj[]): AlbumRef | undefined {
  for (const run of runs) {
    const target = browseOf(run.navigationEndpoint);
    if (target?.pageType === ALBUM && typeof run.text === "string") return { id: target.browseId, title: run.text.trim() };
  }
  return undefined;
}

export function yearFromRuns(runs: Obj[]): number | undefined {
  const run = runs.find((candidate) => typeof candidate.text === "string" && /^\d{4}$/.test(candidate.text.trim()));
  return run ? Number(run.text.trim()) : undefined;
}

export function parseDuration(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{1,3}):(\d{1,3})(?::(\d{1,3}))?$/);
  if (!match) return undefined;
  const [hours, minutes, seconds] = match[3] === undefined ? [0, Number(match[1]), Number(match[2])] : [Number(match[1]), Number(match[2]), Number(match[3])];
  if (seconds > 59 || (match[3] !== undefined && minutes > 59)) return undefined;
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return total > 0 ? total : undefined;
}

export function durationFromRuns(runs: Obj[]): number | undefined {
  for (const run of runs) {
    const parsed = parseDuration(typeof run.text === "string" ? run.text : undefined);
    if (parsed) return parsed;
  }
  return undefined;
}

export function isArtworkHost(url: string): boolean {
  try {
    const host = new URL(url.startsWith("//") ? `https:${url}` : url).hostname;
    return host.endsWith(".googleusercontent.com") || host === "yt3.ggpht.com";
  } catch {
    return false;
  }
}

const SIZE_SUFFIX = /=(?:w\d+-h\d+|s\d+)(?:-[\w-]+)?$/;

export function resizeArtwork(url: string, suffix: string): string {
  return SIZE_SUFFIX.test(url) ? url.replace(SIZE_SUFFIX, suffix) : `${url}${suffix}`;
}

interface Thumb {
  url: string;
  width: number;
  height: number;
}

export function thumbnailsOf(node: unknown): Thumb[] {
  if (!isObj(node)) return [];
  const holder = node.thumbnail ?? node.thumbnailRenderer;
  const list = holder?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? holder?.thumbnails ?? holder?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item: Obj) => isObj(item) && typeof item.url === "string")
    .map((item: Obj) => ({
      url: item.url.startsWith("//") ? `https:${item.url}` : item.url,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
    }));
}

export function pickCover(thumbs: Thumb[], artist = false): Cover | undefined {
  if (thumbs.length === 0) return undefined;
  const largest = (list: Thumb[]) => list.reduce((best, item) => (item.width * item.height > best.width * best.height ? item : best));
  const square = thumbs.filter((item) => (item.width > 0 && item.width === item.height) || isArtworkHost(item.url));
  if (square.length === 0) {
    const best = largest(thumbs);
    return artist && isArtworkHost(best.url)
      ? {
          url: resizeArtwork(best.url, "=s0"),
          width: best.width,
          height: best.height,
        }
      : { ...best };
  }
  const best = largest(square);
  if (artist) {
    return {
      url: isArtworkHost(best.url) ? resizeArtwork(best.url, "=s0") : best.url,
      width: Math.max(best.width, 1024),
      height: Math.max(best.height, 1024),
    };
  }
  if (!isArtworkHost(best.url)) return { ...best };
  return {
    url: resizeArtwork(best.url, "=w512-h512-l90-rj"),
    width: 512,
    height: 512,
  };
}

export function videoThumbnail(videoId: string): Cover {
  return {
    url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    width: 480,
    height: 360,
  };
}

export function hasExplicit(node: unknown): boolean {
  let found = false;
  walk(node, (value) => {
    if (value.musicInlineBadgeRenderer?.icon?.iconType === "MUSIC_EXPLICIT_BADGE") found = true;
    return found;
  });
  return found;
}

export function walk(node: unknown, visit: (value: Obj) => boolean | void): void {
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push(value[i]);
    } else if (isObj(value)) {
      if (visit(value)) return;
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(value[keys[i]]);
    }
  }
}

export function findAll(node: unknown, key: string): Obj[] {
  const out: Obj[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isObj(value)) {
      for (const [name, child] of Object.entries(value)) {
        if (name === key && isObj(child)) out.push(child);
        else visit(child);
      }
    }
  };
  visit(node);
  return out;
}

export function findFirst(node: unknown, key: string): Obj | undefined {
  return findAll(node, key)[0];
}

export function continuationOf(node: unknown): string | undefined {
  let token: string | undefined;
  walk(node, (value) => {
    const candidate =
      value.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
      value.continuationCommand?.token ??
      value.continuationEndpoint?.continuationCommand?.token ??
      value.nextContinuationData?.continuation ??
      value.reloadContinuationData?.continuation;
    if (typeof candidate === "string" && candidate) token = candidate;
    return token !== undefined;
  });
  return token;
}
