import { idKind, type Track } from "../types";
import { isAbort, type DaemonPort, type FeedLive, type MatchPort, type PlayableSource, type YoutubePort } from "./ports";

export const AHEAD_LIMIT = 3;
export const HEAD_SECONDS = 6;
export const HEAD_MAX_BYTES = 256 * 1024;
export const REST_CHUNK_BYTES = 1 << 20;
export const AHEAD_TTL_MS = 5 * 60_000;
const URL_MARGIN_MS = 60_000;

export interface StartAheadDeps {
  youtube: Pick<YoutubePort, "resolve" | "range" | "canPrefetch">;
  daemon: Pick<DaemonPort, "scStream" | "scLive">;
  match: MatchPort;
  feedLive: FeedLive;
  now(): number;
}

interface Head {
  info: PlayableSource;
  mse: string;
  bytes: Uint8Array;
  more(signal: AbortSignal): Promise<Uint8Array | null>;
}

interface StandIn {
  id: string;
  head: Head;
  controller: AbortController;
}

type Prepared = { head: Head } | { failed: true; standIn: StandIn | null };

interface Entry {
  at: number;
  controller: AbortController;
  settled: boolean;
  ready: Promise<Prepared | null>;
}

const mseType = (codec: string) => (codec === "opus" ? 'audio/webm; codecs="opus"' : 'audio/mp4; codecs="mp4a.40.2"');
const headLength = (bitrate: number) => Math.min(HEAD_MAX_BYTES, Math.round((bitrate / 8) * HEAD_SECONDS));

function joined(pieces: Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return bytes;
}

export class StartAhead {
  private readonly entries = new Map<string, Entry>();
  private standIn: StandIn | null = null;

  constructor(private readonly deps: StartAheadDeps) {}

  prepare(tracks: readonly Track[]): void {
    const youtube = this.deps.youtube.canPrefetch();
    const wanted = tracks.slice(0, AHEAD_LIMIT).filter((track) => youtube || idKind(track.id) !== "youtube");
    const ids = new Set(wanted.map((track) => track.id));
    if (this.standIn && !ids.size) this.dropStandIn();
    for (const [id, entry] of this.entries) {
      if (ids.has(id) && this.fresh(entry)) continue;
      entry.controller.abort();
      this.entries.delete(id);
    }
    for (const track of wanted) if (!this.entries.has(track.id)) this.entries.set(track.id, this.start(track));
  }

  async take(trackId: string, signal: AbortSignal): Promise<PlayableSource | "failed" | null> {
    const standIn = this.standIn;
    if (standIn?.id === trackId) {
      this.standIn = null;
      return this.play(standIn.head, standIn.controller);
    }
    const entry = this.entries.get(trackId);
    if (!entry) return null;
    this.entries.delete(trackId);
    this.dropStandIn();
    for (const other of this.entries.values()) if (!other.settled) other.controller.abort();
    if (!this.fresh(entry)) {
      entry.controller.abort();
      return null;
    }
    const stop = () => entry.controller.abort();
    signal.addEventListener("abort", stop, { once: true });
    try {
      const prepared = await entry.ready;
      if (!prepared || signal.aborted) {
        entry.controller.abort();
        return null;
      }
      if ("failed" in prepared) {
        this.standIn = prepared.standIn;
        return "failed";
      }
      return this.play(prepared.head, entry.controller);
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }

  private dropStandIn(): void {
    this.standIn?.controller.abort();
    this.standIn = null;
  }

  private fresh(entry: Entry): boolean {
    return this.deps.now() - entry.at < AHEAD_TTL_MS;
  }

  private start(track: Track): Entry {
    const controller = new AbortController();
    const entry: Entry = { at: this.deps.now(), controller, settled: false, ready: Promise.resolve(null) };
    const run = Promise.resolve()
      .then(() => (controller.signal.aborted ? null : this.prepareOne(track, controller)))
      .catch(() => null);
    entry.ready = run.finally(() => {
      entry.settled = true;
    });
    return entry;
  }

  private async prepareOne(track: Track, controller: AbortController): Promise<Prepared | null> {
    const signal = controller.signal;
    if (idKind(track.id) !== "soundcloud") {
      const head = await this.youtubeHead(track, signal);
      return head && { head };
    }
    try {
      const head = await this.soundcloudHead(track, signal);
      return head && { head };
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
    }
    const match = this.deps.youtube.canPrefetch() ? await this.deps.match.approvedOn("youtube", track, signal).catch(() => null) : null;
    const head = match && (await this.youtubeHead(match.track, signal).catch(() => null));
    return { failed: true, standIn: match && head ? { id: match.track.id, head, controller } : null };
  }

  private async youtubeHead(track: Track, signal: AbortSignal): Promise<Head | null> {
    const info = await this.deps.youtube.resolve(track, { progressive: false, early: true, quality: "normal" }, signal);
    const { url, sizeBytes } = info;
    if (!url || !sizeBytes) return null;
    if (info.expiresAt !== undefined && info.expiresAt - this.deps.now() < AHEAD_TTL_MS + URL_MARGIN_MS) return null;
    const length = Math.min(sizeBytes, headLength(info.bitrate));
    const bytes = await this.deps.youtube.range(url, 0, length - 1, signal);
    if (bytes.byteLength !== length) return null;
    let next = length;
    const more = async (stop: AbortSignal) => {
      if (next >= sizeBytes) return null;
      const to = Math.min(next + Math.min(next, REST_CHUNK_BYTES), sizeBytes) - 1;
      const chunk = await this.deps.youtube.range(url, next, to, stop);
      if (chunk.byteLength !== to - next + 1) throw new Error("short chunk");
      next = to + 1;
      return chunk;
    };
    return { info: { ...info, url: undefined, verify: undefined }, mse: mseType(info.codec), bytes, more };
  }

  // The live stream stays open unread past the head: the daemon stops fetching once its small buffer is full
  private async soundcloudHead(track: Track, signal: AbortSignal): Promise<Head | null> {
    const id = track.id.replace(/^sc:/, "");
    const descriptor = await this.deps.daemon.scStream(id, signal, true);
    if (descriptor.kind !== "live") return null;
    const reader = (await this.deps.daemon.scLive(id, signal)).getReader();
    const want = headLength(descriptor.bitrate);
    const pieces: Uint8Array[] = [];
    let length = 0;
    while (length < want) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
      length += value.byteLength;
    }
    const more = async () => {
      const { done, value } = await reader.read();
      return done ? null : value;
    };
    const info: PlayableSource = { mimeType: descriptor.mimeType, codec: descriptor.codec, bitrate: descriptor.bitrate, durationMs: track.durationMs };
    return { info, mse: descriptor.mimeType, bytes: joined(pieces, length), more };
  }

  private play(head: Head, controller: AbortController): PlayableSource {
    const rest = new ReadableStream<Uint8Array>({
      start: (stream) => stream.enqueue(head.bytes),
      pull: async (stream) => {
        const next = await head.more(controller.signal);
        if (next) stream.enqueue(next);
        else stream.close();
      },
      cancel: () => controller.abort(),
    });
    return { ...head.info, progressive: this.deps.feedLive(rest, head.mse, head.info.durationMs, () => controller.abort()) };
  }
}
