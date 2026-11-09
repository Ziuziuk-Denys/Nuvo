import { readCapped } from "./capped";

export type ShareSource = "text" | "youtube" | "soundcloud";

export interface ShareTrack {
  source: ShareSource;
  id?: string;
  artist?: string;
  title?: string;
  durationSec?: number;
}

export interface Share {
  title: string;
  tracks: ShareTrack[];
}

export type ShareErrorCode = "bad_share" | "newer_link";

export class ShareError extends Error {
  constructor(readonly code: ShareErrorCode) {
    super(code);
  }
}

export const SHARE_VERSION = 1;
export const MAX_PAYLOAD_CHARS = 65_536;
export const MAX_INFLATED_BYTES = 512 * 1024;
export const MAX_TRACKS = 5_000;
export const MAX_TITLE_BYTES = 200;
export const MAX_NAMES_BYTES = 400;
export const MAX_DURATION_SEC = 86_400;

const FLAG_DEFLATE = 1;
const KIND = { text: 0, youtube: 1, soundcloud: 2 } as const;
const TAG_NAMES = 4;
const TAG_DURATION = 8;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SOUNDCLOUD_ID = /^[1-9][0-9]{0,15}$/;
const encoder = new TextEncoder();

function fail(code: ShareErrorCode = "bad_share"): never {
  throw new ShareError(code);
}

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const char of text) {
    const value = B64.indexOf(char);
    if (value < 0) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return acc === 0 ? out : null;
}

// 11 base64url characters carry 66 bits; real YouTube ids use 64, so the low 2 bits are 0

export function packYoutubeId(id: string): Uint8Array | null {
  if (!YOUTUBE_ID.test(id)) return null;
  const values = [...id].map((char) => B64.indexOf(char));
  if (values[10] & 3) return null;
  const out = new Uint8Array(8);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const value of values) {
    acc = (acc << 6) | value;
    bits += 6;
    while (bits >= 8 && o < 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

export function unpackYoutubeId(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64[(acc >> bits) & 63];
    }
    acc &= (1 << bits) - 1;
  }
  return out + B64[acc << 2];
}

export function cleanText(text: string): string {
  return text
    .replace(/[\p{Cc}\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampUtf8(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let used = 0;
  let out = "";
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (used + size > maxBytes) break;
    used += size;
    out += char;
  }
  return out;
}

class Writer {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value);
  }

  raw(values: Uint8Array): void {
    for (const value of values) this.bytes.push(value);
  }

  varint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.bytes.push((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.bytes.push(rest);
  }

  text(value: string): void {
    const encoded = encoder.encode(value);
    this.varint(encoded.length);
    this.raw(encoded);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private pos = 0;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) fail();
    return this.bytes[this.pos++];
  }

  take(length: number): Uint8Array {
    if (this.pos + length > this.bytes.length) fail();
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  varint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.byte();
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) {
        if (i > 0 && byte === 0) fail();
        if (!Number.isSafeInteger(value)) fail();
        return value;
      }
      scale *= 0x80;
    }
    return fail();
  }

  text(maxBytes: number): string {
    const length = this.varint();
    if (length > maxBytes) fail();
    try {
      return this.decoder.decode(this.take(length));
    } catch {
      return fail();
    }
  }

  end(): void {
    if (this.pos !== this.bytes.length) fail();
  }
}

export function normalizeShare(share: Share): Share {
  return {
    title: clampUtf8(cleanText(share.title), MAX_TITLE_BYTES).trimEnd(),
    tracks: share.tracks.map(normalizeTrack),
  };
}

export function hasPackableId(track: ShareTrack): boolean {
  if (track.id === undefined) return false;
  if (track.source === "youtube") return packYoutubeId(track.id) !== null;
  return track.source === "soundcloud" && SOUNDCLOUD_ID.test(track.id) && Number.isSafeInteger(Number(track.id));
}

function normalizeTrack(track: ShareTrack): ShareTrack {
  const packable = hasPackableId(track);
  const youtube = packable && track.source === "youtube";
  const soundcloud = packable && track.source === "soundcloud";
  const out: ShareTrack = {
    source: youtube ? "youtube" : soundcloud ? "soundcloud" : "text",
  };
  if (out.source !== "text") out.id = track.id;
  if (out.source === "text" || (track.artist !== undefined && track.title !== undefined)) {
    [out.artist, out.title] = namesField(track.artist ?? "", track.title ?? "").split("\t");
  }
  const seconds = track.durationSec;
  if (seconds !== undefined && Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_DURATION_SEC) out.durationSec = seconds;
  return out;
}

function writeBody(share: Share): Uint8Array {
  if (share.tracks.length < 1 || share.tracks.length > MAX_TRACKS) throw new RangeError("a share holds 1 to 5,000 tracks");
  const { title, tracks } = normalizeShare(share);
  const writer = new Writer();
  writer.text(title);
  writer.varint(tracks.length);
  for (const track of tracks) {
    const kind = KIND[track.source];
    const names = track.title !== undefined;
    writer.byte(kind | (names ? TAG_NAMES : 0) | (track.durationSec !== undefined ? TAG_DURATION : 0));
    if (kind === KIND.youtube) writer.raw(packYoutubeId(track.id as string) as Uint8Array);
    if (kind === KIND.soundcloud) writer.varint(Number(track.id));
    if (names) writer.text(`${track.artist}\t${track.title}`);
    if (track.durationSec !== undefined) writer.varint(track.durationSec);
  }
  return writer.done();
}

function namesField(artist: string, title: string): string {
  const cleanTitle = cleanText(title);
  const room = MAX_NAMES_BYTES - 1;
  const titleBytes = encoder.encode(cleanTitle).length;
  const artistRoom = Math.max(room - titleBytes, Math.floor(room / 2));
  const keptArtist = clampUtf8(cleanText(artist), artistRoom);
  const keptTitle = clampUtf8(cleanTitle, room - encoder.encode(keptArtist).length);
  // a cut can end on a space, which the decoder would refuse as uncleaned text
  return `${keptArtist.trimEnd()}\t${keptTitle.trimEnd()}`;
}

function readBody(body: Uint8Array): Share {
  const reader = new Reader(body);
  const title = reader.text(MAX_TITLE_BYTES);
  if (cleanText(title) !== title) fail();
  const count = reader.varint();
  if (count < 1 || count > MAX_TRACKS) fail();
  const tracks: ShareTrack[] = [];
  for (let i = 0; i < count; i++) {
    const tag = reader.byte();
    if (tag & 0xf0) fail();
    const kind = tag & 3;
    if (kind === 3) fail();
    const track: ShareTrack = {
      source: kind === KIND.youtube ? "youtube" : kind === KIND.soundcloud ? "soundcloud" : "text",
    };
    if (kind === KIND.youtube) track.id = unpackYoutubeId(reader.take(8));
    if (kind === KIND.soundcloud) {
      const id = reader.varint();
      if (id < 1) fail();
      track.id = String(id);
    }
    if (tag & TAG_NAMES) {
      const parts = reader.text(MAX_NAMES_BYTES).split("\t");
      if (parts.length !== 2) fail();
      if (parts.some((part) => cleanText(part) !== part)) fail();
      [track.artist, track.title] = parts;
    } else if (kind === KIND.text) {
      fail();
    }
    if (tag & TAG_DURATION) {
      const seconds = reader.varint();
      if (seconds < 1 || seconds > MAX_DURATION_SEC) fail();
      track.durationSec = seconds;
    }
    tracks.push(track);
  }
  reader.end();
  return { title, tracks };
}

function streamOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = streamOf(bytes).pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const inflated = streamOf(bytes).pipeThrough(new DecompressionStream("deflate-raw"));
  const out = await readCapped(inflated, limit).catch(() => null);
  if (!out) fail();
  return out;
}

export async function encodeShare(share: Share): Promise<string> {
  const body = writeBody(share);
  const deflated = await deflateRaw(body);
  const useDeflate = deflated.length < body.length;
  const chosen = useDeflate ? deflated : body;
  const payload = new Uint8Array(chosen.length + 1);
  payload[0] = (SHARE_VERSION << 4) | (useDeflate ? FLAG_DEFLATE : 0);
  payload.set(chosen, 1);
  return toBase64Url(payload);
}

export async function decodeShare(payload: string): Promise<Share> {
  if (payload.length < 2 || payload.length > MAX_PAYLOAD_CHARS) fail();
  const bytes = fromBase64Url(payload);
  if (!bytes || bytes.length < 2) fail();
  const version = bytes[0] >> 4;
  if (version === 0) fail();
  if (version > SHARE_VERSION) fail("newer_link");
  const flags = bytes[0] & 0x0f;
  if (flags & ~FLAG_DEFLATE) fail();
  const rest = bytes.subarray(1);
  const body = flags & FLAG_DEFLATE ? await inflateRaw(rest, MAX_INFLATED_BYTES) : rest;
  return readBody(body);
}
