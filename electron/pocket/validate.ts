import type { NotchTrack } from "../../src/notch/contracts";
import {
  POCKET_MENU_KEYS,
  POCKET_QUEUE_MAX,
  type PocketFace,
  type PocketFeed,
  type PocketLook,
  type PocketMenuLabels,
  type PocketMenuRequest,
} from "../../src/pocket/contracts";

const MAX_TEXT = 256;
const MAX_LABEL = 80;
const MAX_COVER_URL = 2048;
const MAX_MS = 86_400_000;
const FACES: readonly PocketFace[] = ["cover", "lyrics", "queue"];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isFace = (value: unknown): value is PocketFace => (FACES as readonly unknown[]).includes(value);

function isCover(value: unknown): value is string | null {
  return value === null || (isText(value, MAX_COVER_URL) && (value.startsWith("nuvo-core://local/") || value.startsWith("https://")));
}

function validTrack(raw: unknown): NotchTrack | null {
  if (!isObject(raw)) return null;
  const { id, title, artist, coverUrl, durationMs } = raw;
  if (!isText(id, MAX_TEXT) || !isText(title, MAX_TEXT) || !isText(artist, MAX_TEXT) || !isCover(coverUrl)) return null;
  if (typeof durationMs !== "number" || !(durationMs >= 0 && durationMs <= MAX_MS)) return null;
  return { id, title, artist, coverUrl, durationMs };
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]{5,48}\))$/i;
const isColor = (value: unknown): value is string => isText(value, 64) && COLOR.test(value);

function validLook(raw: unknown): PocketLook | null {
  if (!isObject(raw) || typeof raw.light !== "boolean" || !isColor(raw.field) || !isColor(raw.ink)) return null;
  return { light: raw.light, field: raw.field, ink: raw.ink };
}

export function validateFeed(raw: unknown): PocketFeed | null {
  if (!isObject(raw)) return null;
  const { trackId, coverUrl, upNext } = raw;
  if (!(trackId === null || isText(trackId, MAX_TEXT)) || !isCover(coverUrl)) return null;
  if (!Array.isArray(upNext) || upNext.length > POCKET_QUEUE_MAX) return null;
  const tracks = upNext.map(validTrack);
  const look = validLook(raw.look);
  return look && tracks.every((track) => track !== null) ? { trackId, coverUrl, upNext: tracks, look } : null;
}

export function validateMenu(raw: unknown): PocketMenuRequest | null {
  if (!isObject(raw) || !isObject(raw.labels) || !isFace(raw.face) || !Array.isArray(raw.faces)) return null;
  const { labels, face, faces } = raw;
  if (faces.length > FACES.length || !faces.every(isFace)) return null;
  if (!POCKET_MENU_KEYS.every((key) => isText(labels[key], MAX_LABEL))) return null;
  return { labels: Object.fromEntries(POCKET_MENU_KEYS.map((key) => [key, labels[key]])) as PocketMenuLabels, face, faces };
}
