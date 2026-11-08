import { VideoPlaybackAbrRequest } from "googlevideo/protos";
import { describe, expect, it, vi } from "vitest";
import { StreamResolver } from "./resolver";
import { SignedInTv, newCpn, sabrFetch, type SabrConfig, type SabrHandle } from "./tv";
import { json } from "../test/fakeFetch";
import { harness, signal } from "../test/harness";
import { format, fromClient, playerResponse } from "../test/formats";
import { FakeWorker, playbackDeps, streamRoutes } from "../test/playback";

const ID = "vidAAAAAAA1";
const WWW = "https://www.youtube.com";
const SABR = "https://rr1---sn-test.googlevideo.com/videoplayback?sabr=1&n=abc&expire=1900000000";

const tvResponse = (overrides: Record<string, unknown> = {}) =>
  json({
    ...playerResponse({ formats: [format({ itag: 251, url: null })] }),
    streamingData: {
      serverAbrStreamingUrl: SABR,
      adaptiveFormats: [format({ itag: 251, url: null })],
    },
    playerConfig: {
      mediaCommonConfig: {
        mediaUstreamerRequestConfig: {
          videoPlaybackUstreamerConfig: "dXN0cmVhbWVy",
        },
      },
    },
    ...overrides,
  });

function fakeSabr(chunks: Uint8Array[]) {
  const configs: SabrConfig[] = [];
  const abort = vi.fn();
  const start = async (config: SabrConfig): Promise<SabrHandle> => {
    configs.push(config);
    return {
      audio: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      format: {
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 150_000,
        contentLength: 3,
        approxDurationMs: 1000,
      },
      abort,
    };
  };
  return { start, configs, abort };
}

function setup(
  options: {
    chunks?: Uint8Array[];
    playThroughAccount?: boolean;
    supported?: boolean;
  } = {},
) {
  const h = harness();
  streamRoutes(h.fake);
  const worker = new FakeWorker();
  const sabr = fakeSabr(options.chunks ?? [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]);
  const account = {
    status: () => true,
    authorization: async () => "Bearer AT",
  };
  const tv = new SignedInTv({
    yt: h.yt,
    fetch: h.fake.fetch,
    worker,
    account,
    playThroughAccount: () => options.playThroughAccount ?? true,
    startSabr: sabr.start,
    isTypeSupported: () => options.supported ?? true,
    feed: {
      createMediaSource: () =>
        Object.assign(new EventTarget(), {
          readyState: "closed",
          duration: NaN,
          addSourceBuffer: () => {
            throw new Error("unused");
          },
          endOfStream: () => undefined,
        }),
      createObjectURL: () => "blob:tv",
      revokeObjectURL: () => undefined,
    },
  });
  const resolver = new StreamResolver({
    ...playbackDeps(h.fake, h.yt, worker),
    signedIn: tv,
  });
  return { ...h, worker, sabr, tv, resolver };
}

describe("signed-in TV", () => {
  it("cpn is 16 URL-safe characters", () => {
    expect(newCpn()).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("transformed n, matching cpn, alr=yes, living-room id in the request", async () => {
    const { fake, sabr, resolver } = setup();
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("TVHTML5 (account)");
    expect(source.progressive?.url).toBe("blob:tv");
    const url = new URL(sabr.configs[0].serverAbrStreamingUrl);
    const request = fake.calls.find((call) => call.url.includes("/player"))!;
    const body = request.json<{
      cpn: string;
      context: {
        client: {
          tvAppInfo: { livingRoomPoTokenId: string };
          clientVersion: string;
          visitorData: string;
        };
      };
    }>();
    expect([url.searchParams.get("n"), url.searchParams.get("alr"), url.searchParams.get("cpn")]).toEqual(["abc_t", "yes", body.cpn]);
    expect(body.cpn).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.context.client.tvAppInfo.livingRoomPoTokenId).toBe("lr-1");
    expect(body.context.client.clientVersion).toBe("7.20260101.00.00");
    expect(request.headers.authorization).toBe("Bearer AT");
    expect(sabr.configs[0].poToken).toBe("TVTOKEN");
  });

  it("an empty first read is no-formats and the chain moves to WEB_REMIX", async () => {
    const { fake, tv, resolver } = setup({ chunks: [] });
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251 })] })), fromClient("WEB_REMIX"));
    await expect(tv.resolve(ID, { progressive: false }, signal())).rejects.toMatchObject({ code: "no-formats" });
    expect((await resolver.resolve({ id: ID }, { progressive: true }, signal())).servedBy).toBe("WEB_REMIX");
  });

  it("an unsupported MIME aborts SABR and the chain continues", async () => {
    const { fake, sabr, resolver } = setup({ supported: false });
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251 })] })), fromClient("WEB_REMIX"));
    expect((await resolver.resolve({ id: ID }, { progressive: true }, signal())).servedBy).toBe("WEB_REMIX");
    expect(sabr.abort).toHaveBeenCalled();
  });

  it("account playback off: no TV identity", async () => {
    const { fake, worker, resolver } = setup({ playThroughAccount: false });
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251 })] })), fromClient("WEB_REMIX"));
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(worker.identities).toBe(0);
  });

  it("SABR bodies carry the TV device fields and the Cobalt agent", async () => {
    const sent: Array<{ headers: Headers; body: Uint8Array }> = [];
    const capture = async (_input: string, init: RequestInit = {}) => {
      sent.push({
        headers: new Headers(init.headers),
        body: init.body as Uint8Array,
      });
      return new Response(null);
    };
    const codec = {
      decode: (bytes: Uint8Array) => VideoPlaybackAbrRequest.decode(bytes) as unknown as Record<string, unknown>,
      encode: (message: Record<string, unknown>) => VideoPlaybackAbrRequest.encode(message as never).finish(),
    };
    const empty = VideoPlaybackAbrRequest.decode(new Uint8Array()) as unknown as Record<string, unknown>;
    const original = codec.encode({
      ...empty,
      streamerContext: {
        clientInfo: { clientName: 7, clientVersion: "7.1" },
        sabrContexts: [],
        unsentSabrContexts: [],
      },
    });
    await sabrFetch(capture, codec)("https://rr1---sn-test.googlevideo.com/videoplayback?sabr=1", { method: "POST", body: original });
    expect(sent[0].headers.get("x-nuvo-ua")).toContain("Cobalt");
    expect(VideoPlaybackAbrRequest.decode(sent[0].body).streamerContext?.clientInfo).toEqual({
      osName: "Unknown_0",
      hl: "en_US",
      deviceMake: "Unknown",
      deviceModel: "Unknown",
      clientName: 7,
      clientVersion: "7.1",
    });
  });

  it("the TV player's reason becomes the step's error text", async () => {
    const { fake, tv } = setup();
    fake.innertube("player", json(playerResponse({ status: "ERROR", reason: "Video unavailable" })), fromClient("TVHTML5"), WWW);
    await expect(tv.resolve(ID, { progressive: false }, signal())).rejects.toMatchObject({
      code: "unplayable",
      message: "Video unavailable",
    });
  });

  it("non-progressive reads the whole SABR file into bytes", async () => {
    const { fake, tv } = setup({
      chunks: [new Uint8Array([1, 2]), new Uint8Array([3])],
    });
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    const source = await tv.resolve(ID, { progressive: false }, signal());
    expect(new Uint8Array(await source.bytes!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect([source.mimeType, source.codec]).toEqual(["audio/webm", "opus"]);
  });

  it.each([
    "http://rr1---sn-test.googlevideo.com/videoplayback?sabr=1",
    "https://evilgooglevideo.com/videoplayback?sabr=1",
    "https://rr1---sn-test.googlevideo.com.evil.test/videoplayback?sabr=1",
    "https://user@rr1---sn-test.googlevideo.com/videoplayback?sabr=1",
    "https://user:pw@rr1---sn-test.googlevideo.com/videoplayback?sabr=1",
    "https://rr1---sn-test.googlevideo.com:8443/videoplayback?sabr=1",
  ])("rejects SABR url %s without starting SABR", async (bad) => {
    const { fake, sabr, tv } = setup();
    fake.innertube(
      "player",
      tvResponse({
        streamingData: {
          serverAbrStreamingUrl: bad,
          adaptiveFormats: [format({ itag: 251, url: null })],
        },
      }),
      fromClient("TVHTML5"),
      WWW,
    );
    await expect(tv.resolve(ID, { progressive: false }, signal())).rejects.toMatchObject({ code: "no-formats" });
    expect(sabr.configs).toHaveLength(0);
  });

  it("accepts a plain googlevideo url", async () => {
    const { fake, sabr, tv } = setup();
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    await tv.resolve(ID, { progressive: false }, signal());
    expect(sabr.configs).toHaveLength(1);
  });

  it("a stream over 512 MB fails with no-formats and aborts once", async () => {
    const big = new Uint8Array(64 * 1024 * 1024);
    const { fake, sabr, tv } = setup({ chunks: Array(9).fill(big) });
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    await expect(tv.resolve(ID, { progressive: false }, signal())).rejects.toMatchObject({ code: "no-formats" });
    expect(sabr.abort).toHaveBeenCalledTimes(1);
  });

  it("aborts the handle when the signal fires during startup", async () => {
    const { fake, sabr, tv } = setup();
    fake.innertube("player", tvResponse(), fromClient("TVHTML5"), WWW);
    const controller = new AbortController();
    const slow = async (config: SabrConfig) => {
      const handle = await sabr.start(config);
      controller.abort();
      return handle;
    };
    (tv as unknown as { deps: { startSabr: typeof slow } }).deps.startSabr = slow;
    await expect(tv.resolve(ID, { progressive: false }, controller.signal)).rejects.toBeDefined();
    expect(sabr.abort).toHaveBeenCalled();
  });

  it("LOGIN_REQUIRED maps to sign-in-required", async () => {
    const { fake, tv } = setup();
    fake.innertube("player", json(playerResponse({ status: "LOGIN_REQUIRED", reason: "Sign in" })), fromClient("TVHTML5"), WWW);
    await expect(tv.resolve(ID, { progressive: false }, signal())).rejects.toMatchObject({ code: "sign-in-required" });
  });

  it("sabrFetch follows redirects only inside googlevideo", async () => {
    const codec = { decode: () => ({}), encode: () => new Uint8Array() };
    const seen: string[] = [];
    const hop = (location: string | null) => async (input: string) => {
      seen.push(input);
      return new Response(null, {
        status: location ? 307 : 200,
        headers: location ? { location } : {},
      });
    };
    const good = vi.fn().mockImplementationOnce(hop("https://rr2---sn-x.googlevideo.com/videoplayback")).mockImplementationOnce(hop(null));
    const ok = await sabrFetch(good, codec)("https://rr1---sn-test.googlevideo.com/videoplayback");
    expect(ok.status).toBe(200);
    expect(seen).toHaveLength(2);
    const bad = vi.fn(hop("https://evil.test/x"));
    await expect(sabrFetch(bad, codec)("https://rr1---sn-test.googlevideo.com/videoplayback")).rejects.toMatchObject({ code: "no-formats" });
  });
});
