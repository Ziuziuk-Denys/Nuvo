import { describe, expect, it, vi } from "vitest";
import type { DaemonPort, PlayableSource, YoutubePort } from "./ports";
import { AHEAD_LIMIT, HEAD_MAX_BYTES, REST_CHUNK_BYTES, StartAhead } from "./startAhead";
import type { Track } from "../types";

const track = (letter: string): Track => ({ id: letter.repeat(11), title: letter, artists: "A", coverUrl: "", durationMs: 200_000 });
const SIZE = 1_000_000;

const PIECE = 64 * 1024;
const PIECES = 8;

function liveBody(signal: AbortSignal, pulled: { count: number }) {
  return new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        if (signal.aborted) return controller.error(new DOMException("aborted", "AbortError"));
        pulled.count += 1;
        controller.enqueue(new Uint8Array(PIECE).fill(pulled.count));
        if (pulled.count === PIECES) controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

function setup(over: { resolve?: YoutubePort["resolve"]; now?: () => number; canPrefetch?: boolean; scFails?: boolean } = {}) {
  const resolve = vi.fn(
    over.resolve ??
      (async (target: Track): Promise<PlayableSource> => ({
        url: `https://rr.googlevideo.com/${target.id}`,
        mimeType: "audio/webm",
        codec: "opus",
        bitrate: 160_000,
        sizeBytes: SIZE,
        durationMs: 200_000,
        verify: async () => {
          throw new Error("verify is not needed after a head");
        },
      })),
  );
  const range = vi.fn(async (_url: string, from: number, to: number, signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    return new Uint8Array(to - from + 1).fill(from === 0 ? 1 : 2);
  });
  const feedLive = vi.fn((stream: ReadableStream<Uint8Array>, mime: string, _durationMs: number | undefined, stop: () => void) => ({
    url: "blob:ahead",
    whole: new Response(stream).blob(),
    overflowed: () => false,
    release: stop,
    mime,
  }));
  const pulled = { count: 0 };
  const liveSignals: AbortSignal[] = [];
  const daemon = {
    scStream: vi.fn(async () => {
      if (over.scFails) throw new Error("snippet only");
      return { kind: "live", url: "", expiresAt: null, codec: "mp3", mimeType: "audio/mpeg", bitrate: 128_000, contentLength: null };
    }),
    scLive: vi.fn(async (_id: string, signal: AbortSignal) => {
      liveSignals.push(signal);
      return liveBody(signal, pulled);
    }),
  } as unknown as Pick<DaemonPort, "scStream" | "scLive">;
  const ahead = new StartAhead({
    youtube: { resolve, range, canPrefetch: () => over.canPrefetch ?? true },
    daemon,
    match: { approvedOn: async () => ({ track: track("y"), score: 95 }) },
    feedLive,
    now: over.now ?? (() => 0),
  });
  return { ahead, resolve, range, feedLive, daemon, pulled, liveSignals };
}

const signal = () => new AbortController().signal;
const played = (taken: PlayableSource | "failed" | null) => taken as PlayableSource;

describe("StartAhead", () => {
  it("resolves the first three visible songs and keeps only their first seconds", async () => {
    const { ahead, resolve, range } = setup();
    ahead.prepare([track("a"), track("b"), track("c"), track("d"), track("e")]);
    await vi.waitFor(() => expect(range).toHaveBeenCalledTimes(AHEAD_LIMIT));
    expect(resolve.mock.calls.map((call) => call[0].title)).toEqual(["a", "b", "c"]);
    const taken = played(await ahead.take(track("a").id, signal()));
    expect(taken.progressive?.url).toBe("blob:ahead");
    expect(taken.verify).toBeUndefined();
    expect(resolve.mock.calls[0][1]).toMatchObject({ progressive: false, early: true, quality: "normal" });
    const head = range.mock.calls[0];
    expect(head[1]).toBe(0);
    expect(head[2] + 1).toBeLessThanOrEqual(HEAD_MAX_BYTES);
  });

  it("plays the head from memory and fetches the rest from where the head ends", async () => {
    const { ahead, range } = setup();
    ahead.prepare([track("a")]);
    const taken = played(await ahead.take(track("a").id, signal()));
    const blob = await taken.progressive!.whole;
    expect(blob.size).toBe(SIZE);
    const spans = range.mock.calls.map((call) => [call[1], call[2]]);
    spans.slice(1).forEach(([from, to], index) => {
      expect(from).toBe(spans[index][1] + 1);
      expect(to - from + 1).toBeLessThanOrEqual(Math.max(from, REST_CHUNK_BYTES));
    });
    expect(spans.at(-1)![1]).toBe(SIZE - 1);
    expect(spans[1][1] - spans[1][0]).toBe(spans[0][1] - spans[0][0]);
  });

  it("stops songs that left the visible list", async () => {
    let started = 0;
    const { ahead, resolve } = setup({
      resolve: (_t, _o, s) =>
        new Promise((_resolve, reject) => {
          started += 1;
          s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });
    ahead.prepare([track("a"), track("b")]);
    await vi.waitFor(() => expect(started).toBe(2));
    const aborted = resolve.mock.calls[0][2];
    ahead.prepare([track("c")]);
    expect(aborted.aborted).toBe(true);
    expect(await ahead.take(track("a").id, signal())).toBeNull();
  });

  it("answers null for a song it never prepared, an expired head or a failed head", async () => {
    let now = 0;
    const { ahead } = setup({ now: () => now });
    expect(await ahead.take(track("a").id, signal())).toBeNull();
    ahead.prepare([track("a")]);
    now = 11 * 60_000;
    expect(await ahead.take(track("a").id, signal())).toBeNull();

    const failing = setup({
      resolve: async () => {
        throw new Error("down");
      },
    });
    failing.ahead.prepare([track("b")]);
    expect(await failing.ahead.take(track("b").id, signal())).toBeNull();
  });

  it("reads a SoundCloud live stream up to its head and holds the rest until the song is taken", async () => {
    const { ahead, pulled, feedLive } = setup();
    const sc: Track = { ...track("x"), id: "sc:42" };
    ahead.prepare([sc]);
    await vi.waitFor(() => expect(pulled.count).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pulled.count).toBe(2);
    const taken = played(await ahead.take(sc.id, signal()));
    expect(feedLive.mock.calls[0][1]).toBe("audio/mpeg");
    expect((await taken.progressive!.whole).size).toBe(PIECE * PIECES);
  });

  it("closes a held SoundCloud stream once its song leaves the list", async () => {
    const { ahead, pulled, liveSignals } = setup();
    ahead.prepare([{ ...track("x"), id: "sc:42" }]);
    await vi.waitFor(() => expect(pulled.count).toBe(2));
    ahead.prepare([]);
    expect(liveSignals[0].aborted).toBe(true);
  });

  it("a SoundCloud song that fails ahead is reported failed and its YouTube stand-in plays from a head", async () => {
    const { ahead } = setup({ scFails: true });
    const sc: Track = { ...track("x"), id: "sc:42" };
    ahead.prepare([sc]);
    expect(await ahead.take(sc.id, signal())).toBe("failed");
    expect(played(await ahead.take(track("y").id, signal())).progressive?.url).toBe("blob:ahead");
  });

  it("does nothing while playback cannot start from a head", async () => {
    const { ahead, resolve } = setup({ canPrefetch: false });
    ahead.prepare([track("a")]);
    expect(await ahead.take(track("a").id, signal())).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("cancels heads still loading once a song is taken, so they do not compete with its stream", async () => {
    let second: AbortSignal | null = null;
    const { ahead } = setup({
      resolve: async (target, _o, s) => {
        if (target.id === track("b").id) {
          second = s;
          return new Promise(() => undefined);
        }
        return { url: "https://rr.googlevideo.com/a", mimeType: "audio/webm", codec: "opus", bitrate: 160_000, sizeBytes: SIZE };
      },
    });
    ahead.prepare([track("a"), track("b")]);
    await vi.waitFor(() => expect(second).not.toBeNull());
    await ahead.take(track("a").id, signal());
    expect(second!.aborted).toBe(true);
  });
});
