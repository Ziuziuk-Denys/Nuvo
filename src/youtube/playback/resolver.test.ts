import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_BUDGET_MS, StreamResolver } from "./resolver";
import { fallbackAttempt } from "./attempts";
import { PlayerScript } from "./player";
import { ipcWorker } from "./worker";
import { json, text } from "../test/fakeFetch";
import { harness, signal, swBody } from "../test/harness";
import { STREAM_HOST, format, fromClient, playerResponse } from "../test/formats";
import { FakeWorker, playbackDeps, streamRoutes } from "../test/playback";
import type { YtError } from "../types";

const ID = "vidAAAAAAA1";
const WWW = "https://www.youtube.com";
const ok = (...itags: number[]) => json(playerResponse({ formats: itags.map((itag) => format({ itag })) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const h = harness();
  streamRoutes(h.fake);
  const worker = new FakeWorker();
  const deps = playbackDeps(h.fake, h.yt, worker);
  return { ...h, worker, resolver: new StreamResolver(deps) };
}

/** Every client answers UNPLAYABLE unless a test adds its own route afterwards. */
function allUnplayable(fake: ReturnType<typeof harness>["fake"]) {
  const no = json(playerResponse({ status: "UNPLAYABLE", reason: "nope" }));
  fake.innertube("player", no);
  fake.innertube("player", no, undefined, WWW);
}

describe("a client that failed or hangs", () => {
  it("`avoid` leaves the client out of the chain", async () => {
    const { fake, resolver } = setup();
    fake.innertube("player", ok(251), fromClient("VISIONOS"), WWW);
    const source = await resolver.resolve({ id: `yt:${ID}` }, { progressive: true, avoid: ["WEB_REMIX", "TVHTML5"] }, signal());
    expect(source.servedBy).toBe("VISIONOS");
  });

  it("a hanging client costs its budget, then the next one answers", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hanging = async (_deps: unknown, _videoId: string, _choice: unknown, limited: AbortSignal) =>
      new Promise<never>((_, reject) => limited.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const h = harness();
    streamRoutes(h.fake);
    const deps = playbackDeps(h.fake, h.yt, new FakeWorker());
    h.fake.innertube("player", ok(251), undefined, WWW);
    const resolver = new StreamResolver(deps, {
      webRemix: hanging,
      fallback: fallbackAttempt,
    });
    const started = resolver.resolve({ id: `yt:${ID}` }, { progressive: true }, signal());
    await vi.advanceTimersByTimeAsync(CLIENT_BUDGET_MS * 2 + 100);
    expect((await started).servedBy).toBe("TVHTML5");
  });
});

describe("resolution chain", () => {
  it("a malformed id is bad-id before any request", async () => {
    const { fake, resolver } = setup();
    await expect(resolver.resolve({ id: "abc" }, { progressive: true }, signal())).rejects.toMatchObject({ code: "bad-id" });
    expect(fake.calls).toHaveLength(0);
  });

  it("WEB_REMIX: pot on the URL, itag 251, probe past the first megabyte", async () => {
    const { fake, resolver } = setup();
    fake.innertube("player", ok(140, 251), fromClient("WEB_REMIX"));
    const source = await resolver.resolve({ id: `yt:${ID}` }, { progressive: true }, signal());
    expect(new URL(source.url!).searchParams.get("pot")).toBe("T");
    expect([source.itag, source.codec, source.servedBy]).toEqual([251, "opus", "WEB_REMIX"]);
    const probeCall = fake.calls.find((call) => call.url.startsWith(STREAM_HOST))!;
    expect(new URL(probeCall.url).searchParams.get("range")).toBe("1052672-1052672");
    const player = fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/player")[0].json<{ serviceIntegrityDimensions: { poToken: string } }>();
    expect(player.serviceIntegrityDimensions.poToken).toBe("T");
  });

  it("WEB_REMIX probe 403 once, then VISIONOS; one content token", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    fake.innertube(
      "player",
      json(
        playerResponse({
          formats: [format({ itag: 251, url: `${STREAM_HOST}?itag=251&r=web` })],
        }),
      ),
      fromClient("WEB_REMIX"),
    );
    fake.innertube(
      "player",
      json(
        playerResponse({
          formats: [format({ itag: 251, url: `${STREAM_HOST}?itag=251&r=vision` })],
        }),
      ),
      fromClient("VISIONOS"),
      WWW,
    );
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=web`), text("", 403));
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    expect(worker.tokens).toEqual([ID]);
  });

  it("a 403 at the WEB_REMIX probe marks it down for the session; later tracks skip it", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("WEB_REMIX"));
    fake.innertube("player", ok(251), fromClient("VISIONOS"), WWW);
    fake.on("GET", (url) => url.startsWith(STREAM_HOST) && url.includes("range=1052672"), text("", 403));
    const first = await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch((e) => e);
    expect(worker.tokens).toEqual([ID]);
    vi.setSystemTime(60 * 60_000);
    const callsBefore = fake.calls.length;
    await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens).toEqual([ID]);
    const asked = fake.calls.slice(callsBefore).filter((call) => call.url.includes("music.youtube.com/youtubei/v1/player"));
    expect(asked).toHaveLength(0);
    expect(first).toBeDefined();
    resolver.reset();
    await resolver.resolve({ id: "vidCCCCCCC3" }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens).toEqual([ID, "vidCCCCCCC3"]);
  });

  it("a 403 at the ANDROID_VR probe marks it down; later tracks skip it", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251, url: `${STREAM_HOST}?itag=251&r=vr` })] })), fromClient("ANDROID_VR"), WWW);
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vr`), text("", 403));
    await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    const before = fake.calls.length;
    const error = (await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal()).catch((e) => e)) as YtError;
    const vr = fake.calls.slice(before).filter((call) => call.url.includes("/youtubei/v1/player") && fromClient("ANDROID_VR")(call.json()));
    expect(vr).toHaveLength(0);
    expect(error.attempts?.find((entry) => entry.client === "ANDROID_VR")).toMatchObject({ code: "paused" });
  });

  it("three failing resolves pause WEB_REMIX for five minutes", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("WEB_REMIX"));
    fake.on("GET", (url) => url.startsWith(STREAM_HOST), text("", 500));
    for (let i = 0; i < 3; i += 1) await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens).toHaveLength(6);
    vi.setSystemTime(60_000);
    const paused = (await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch((e) => e)) as YtError;
    expect(worker.tokens).toHaveLength(6);
    expect(paused.attempts?.[0]).toMatchObject({
      client: "WEB_REMIX",
      code: "paused",
    });
    vi.setSystemTime(5 * 60_000 + 1000);
    await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens).toHaveLength(8);
  });

  it("a WEB_REMIX success sets the failure count back to zero", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    let webOk = false;
    fake.innertube("player", ok(251), fromClient("WEB_REMIX"));
    fake.on(
      "GET",
      (url) => url.startsWith(STREAM_HOST),
      () => text("", webOk ? 200 : 500),
    );
    await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    webOk = true;
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    webOk = false;
    await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal()).catch(() => undefined);
    await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal()).catch(() => undefined);
    const before = worker.tokens.length;
    await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens.length).toBe(before + 2);
  });

  it("the last good fallback client goes first next time", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("VISIONOS"), WWW);
    vi.setSystemTime(0);
    for (let i = 0; i < 3; i += 1) await resolver.resolve({ id: `vidCOOL000${i}` }, { progressive: true }, signal());
    const before = fake.calls.length;
    await resolver.resolve({ id: "vidSECOND01" }, { progressive: true }, signal());
    const clients = fake.calls
      .slice(before)
      .filter((call) => call.url.includes("/youtubei/v1/player"))
      .map((call) => call.json<{ context: { client: { clientName: string } } }>().context.client.clientName);
    expect(clients).toEqual(["VISIONOS"]);
  });

  it("LOGIN_REQUIRED on a fallback refreshes visitor data and asks again", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.on("GET", "https://www.youtube.com/sw.js_data", [text(swBody("CgsAAAAAAAAAAAAAAAAAAAAAAAA")), text(swBody("CgsBBBBBBBBBBBBBBBBBBBBBBBB"))]);
    fake.innertube("player", [json(playerResponse({ status: "LOGIN_REQUIRED" })), ok(251)], fromClient("TVHTML5"), WWW);
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("TVHTML5");
    const tvCalls = fake.calls.filter((call) => call.url.includes("/player") && fromClient("TVHTML5")(call.json()));
    expect(tvCalls.map((call) => call.headers["x-goog-visitor-id"])).toEqual(["CgsAAAAAAAAAAAAAAAAAAAAAAAA", "CgsBBBBBBBBBBBBBBBBBBBBBBBB"]);
  });

  it("TVHTML5 sends the signature timestamp and probes the deciphered URL", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    const cipher = new URLSearchParams({
      s: "SCRAMBLED",
      sp: "sig",
      url: `${STREAM_HOST}?itag=251&n=abc&expire=1900000000`,
    }).toString();
    fake.innertube(
      "player",
      json(
        playerResponse({
          formats: [format({ itag: 251, url: null, signatureCipher: cipher })],
        }),
      ),
      fromClient("TVHTML5"),
      WWW,
    );
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    const request = fake.calls.find((call) => call.url.includes("/player") && fromClient("TVHTML5")(call.json()))!;
    expect(
      request.json<{
        playbackContext: {
          contentPlaybackContext: { signatureTimestamp: number };
        };
      }>().playbackContext.contentPlaybackContext.signatureTimestamp,
    ).toBe(20000);
    const url = new URL(source.url!);
    expect([url.searchParams.get("n"), url.searchParams.get("sig")]).toEqual(["abc_t", "SSCRAMBLED"]);
    const probed = fake.calls.filter((call) => call.url.startsWith(STREAM_HOST)).at(-1)!;
    expect(new URL(probed.url).searchParams.get("sig")).toBe("SSCRAMBLED");
    expect(worker.transforms.at(-1)).toEqual({
      playerId: "pl4yer01",
      n: ["abc"],
      sig: ["SCRAMBLED"],
    });
  });

  it("VISIONOS with only ciphered formats is no-formats and the chain continues", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube(
      "player",
      json(
        playerResponse({
          formats: [format({ itag: 251, url: null, signatureCipher: "s=x&url=y" })],
        }),
      ),
      fromClient("VISIONOS"),
      WWW,
    );
    fake.innertube("player", ok(140), fromClient("ANDROID_VR"), WWW);
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("ANDROID_VR");
  });

  it("every step failing lists one entry per client in order", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    const error = (await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch((e) => e)) as YtError;
    expect(error.code).toBe("all-failed");
    expect(error.attempts?.map((entry) => [entry.client, entry.code])).toEqual([
      ["WEB_REMIX", "unplayable"],
      ["TVHTML5", "unplayable"],
      ["VISIONOS", "unplayable"],
      ["ANDROID_VR", "unplayable"],
    ]);
    expect(error.attempts?.[0].text).toBe("nope");
  });

  it("bot checks everywhere throw bot-check with the attempts", async () => {
    const { fake, resolver } = setup();
    const login = json(
      playerResponse({
        status: "LOGIN_REQUIRED",
        reason: "Sign in to confirm",
      }),
    );
    fake.innertube("player", login);
    fake.innertube("player", login, undefined, WWW);
    const error = (await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch((e) => e)) as YtError;
    expect([error.code, error.botCheck]).toEqual(["bot-check", true]);
    expect(error.attempts).toHaveLength(4);
  });

  it("an abort while the token is pending stops everything", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    worker.token = () => new Promise(() => undefined);
    const controller = new AbortController();
    const pending = resolver.resolve({ id: ID }, { progressive: true }, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls.filter((call) => call.url.includes("/player") || call.url.startsWith(STREAM_HOST))).toHaveLength(0);
  });

  it("review focus: a player answer with no playability status is unplayable and the chain moves on", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", json({}), fromClient("WEB_REMIX"));
    fake.innertube("player", ok(251), fromClient("TVHTML5"), WWW);
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("TVHTML5");
  });

  it("10.3.3 a track remembers the client that played it", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("ANDROID_VR"), WWW);
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    const before = fake.calls.length;
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    const first = fake.calls.slice(before).find((call) => call.url.includes("/player"))!;
    expect(fromClient("ANDROID_VR")(first.json())).toBe(true);
  });

  it("a worker that cannot start fails WEB_REMIX fast; fallback clients still run", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("VISIONOS"), WWW);
    worker.token = () => Promise.reject(Object.assign(new Error("worker-start"), { code: "worker-start" }));
    worker.playerTransform = () => Promise.reject(new Error("worker-start"));
    expect((await resolver.resolve({ id: ID }, { progressive: true }, signal())).servedBy).toBe("VISIONOS");
  });

  it("the worst HTTP status of the attempts rides on all-failed", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("WEB_REMIX"));
    fake.on("GET", (url) => url.startsWith(STREAM_HOST), text("", 403));
    const error = (await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch((e) => e)) as YtError;
    expect([error.code, error.status]).toEqual(["all-failed", 403]);
    expect(error.attempts?.[0]).toMatchObject({
      client: "WEB_REMIX",
      status: 403,
    });
  });

  it("WEB_REMIX is not retried after unplayable or a bot check", async () => {
    const { fake, worker, resolver } = setup();
    allUnplayable(fake);
    await resolver.resolve({ id: ID }, { progressive: true }, signal()).catch(() => undefined);
    expect(worker.tokens).toHaveLength(1);
  });

  it("the per-track memory is capped", async () => {
    const { fake, resolver } = setup();
    allUnplayable(fake);
    fake.innertube("player", ok(251), fromClient("WEB_REMIX"));
    for (let i = 0; i < 230; i += 1) await resolver.resolve({ id: `vid${String(i).padStart(8, "0")}` }, { progressive: true }, signal());
    expect((resolver as unknown as { perTrack: Map<string, string> }).perTrack.size).toBe(200);
  });
});

describe("worker answers are validated", () => {
  const bridge = (answer: unknown) => ipcWorker(async () => answer);

  it("a transform answer with the wrong shape is bad-input", async () => {
    for (const answer of [
      undefined,
      {},
      { signatureTimestamp: 1, n: [], sig: [] },
      { signatureTimestamp: 1, n: [undefined], sig: [] },
      { signatureTimestamp: "1", n: ["a"], sig: [] },
    ])
      await expect(bridge(answer).playerTransform("p", ["a"], [])).rejects.toMatchObject({ code: "bad-input" });
    await expect(bridge({ signatureTimestamp: 1, n: ["b"], sig: [] }).playerTransform("p", ["a"], [])).resolves.toMatchObject({ n: ["b"] });
  });

  it("a closed bridge rejects worker-closed without calling main", async () => {
    const call = vi.fn(async () => "token");
    const worker = ipcWorker(call);
    worker.close?.();
    await expect(worker.contentToken(ID)).rejects.toMatchObject({
      code: "worker-closed",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("a token that is not a string is bad-input", async () => {
    await expect(bridge(undefined).contentToken(ID)).rejects.toMatchObject({
      code: "bad-input",
    });
    await expect(bridge({ token: 1 }).tvIdentity()).rejects.toMatchObject({
      code: "bad-input",
    });
  });
});

describe("player script", () => {
  const html = (id: string) => text(`"https:\\/\\/www.youtube.com\\/s\\/player\\/${id}\\/base.js"`);

  it("the player id expires, and an oversized page is refused", async () => {
    const h = harness();
    const worker = new FakeWorker();
    const script = new PlayerScript(h.fake.fetch, worker);
    h.fake.on("GET", "https://www.youtube.com/iframe_api", [html("firstid01"), html("secondid2")]);
    expect(await script.playerId(signal())).toBe("firstid01");
    vi.setSystemTime(60_000);
    expect(await script.playerId(signal())).toBe("firstid01");
    vi.setSystemTime(7 * 60 * 60 * 1000);
    expect(await script.playerId(signal())).toBe("secondid2");
    script.reset();
    h.fake.on("GET", "https://www.youtube.com/iframe_api", text("x".repeat(3_000_000)));
    await expect(script.playerId(signal())).rejects.toMatchObject({
      code: "rejected-stream",
    });
  });

  it("an abort of the first caller does not fail the second", async () => {
    const h = harness();
    const script = new PlayerScript(h.fake.fetch, new FakeWorker());
    h.fake.on("GET", "https://www.youtube.com/iframe_api", html("firstid01"));
    const first = new AbortController();
    const a = script.playerId(first.signal);
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(await script.playerId(signal())).toBe("firstid01");
  });
});

describe("early start", () => {
  /** WEB_REMIX and TVHTML5 refuse; VISIONOS and ANDROID_VR answer with their own stream URLs. */
  function chain() {
    const s = setup();
    allUnplayable(s.fake);
    const answer = (tag: string) =>
      json(
        playerResponse({
          formats: [format({ itag: 251, url: `${STREAM_HOST}?itag=251&r=${tag}` })],
        }),
      );
    s.fake.innertube("player", answer("vision"), fromClient("VISIONOS"), WWW);
    s.fake.innertube("player", answer("vr"), fromClient("ANDROID_VR"), WWW);
    return s;
  }
  const probesOf = (fake: ReturnType<typeof setup>["fake"], tag: string) =>
    fake.calls.filter((call) => call.url.startsWith(`${STREAM_HOST}?itag=251&r=${tag}`)).length;

  it("a client's first stream waits for its probe", async () => {
    const { fake, resolver } = chain();
    const source = await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    expect(source.verify).toBeUndefined();
    expect(probesOf(fake, "vision")).toBe(1);
  });

  it("a client whose probe passed starts without a probe; verify probes once, when asked", async () => {
    const { fake, resolver } = chain();
    await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    const source = await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true, early: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    expect(probesOf(fake, "vision")).toBe(1);
    const verified = await source.verify!();
    await source.verify!();
    expect([verified.servedBy, verified.url]).toEqual(["VISIONOS", source.url]);
    expect(probesOf(fake, "vision")).toBe(2);
  });

  it("a failed probe after an early start goes on with the next client, probed", async () => {
    const { fake, resolver } = chain();
    await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vision`), text("", 403));
    const source = await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true, early: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    const verified = await source.verify!();
    expect(verified.servedBy).toBe("ANDROID_VR");
    expect(verified.verify).toBeUndefined();
    expect(probesOf(fake, "vr")).toBe(1);
    // ANDROID_VR is now the last good client and its probe passed: the next start is early with it.
    const third = await resolver.resolve({ id: "vidCCCCCCC3" }, { progressive: true, early: true }, signal());
    expect([third.servedBy, third.verify !== undefined]).toEqual(["ANDROID_VR", true]);
  });

  it("a client whose probe failed waits for its probe again", async () => {
    const { fake, resolver } = chain();
    await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vision`), text("", 403));
    fake.innertube("player", json(playerResponse({ status: "UNPLAYABLE", reason: "nope" })), fromClient("ANDROID_VR"), WWW);
    const failed = await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true, early: true }, signal());
    await expect(failed.verify!()).rejects.toMatchObject({ code: "all-failed" });
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vision`), text("x"));
    const next = await resolver.resolve({ id: "vidCCCCCCC3" }, { progressive: true, early: true }, signal());
    expect([next.servedBy, next.verify]).toEqual(["VISIONOS", undefined]);
  });

  it("without early the probe always comes first", async () => {
    const { resolver } = chain();
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    const source = await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal());
    expect(source.verify).toBeUndefined();
  });
});

describe("cold worker", () => {
  /** WEB_REMIX and VISIONOS both answer with their own stream; only the worker readiness differs. */
  function cold() {
    const h = harness();
    streamRoutes(h.fake);
    const worker = new FakeWorker();
    const state = { ready: false };
    worker.isReady = async () => state.ready;
    const answer = (tag: string) =>
      json(
        playerResponse({
          formats: [format({ itag: 251, url: `${STREAM_HOST}?itag=251&r=${tag}` })],
        }),
      );
    allUnplayable(h.fake);
    h.fake.innertube("player", answer("web"), fromClient("WEB_REMIX"));
    h.fake.innertube("player", answer("vision"), fromClient("VISIONOS"), WWW);
    const resolver = new StreamResolver(playbackDeps(h.fake, h.yt, worker));
    return { ...h, worker, state, resolver };
  }

  it("a cold worker: VISIONOS first, no WEB_REMIX request, and the warm-up starts once it is resolved", async () => {
    const { fake, worker, resolver } = cold();
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    const webRemix = fake.calls.filter((call) => call.url.includes("music.youtube.com/youtubei/v1/player"));
    expect(webRemix).toHaveLength(0);
    expect(worker.tokens).toEqual([ID]);
    await vi.waitFor(() => expect(worker.transforms.length).toBeGreaterThan(0));
  });

  it("a cold worker and VISIONOS failing: the normal order goes on", async () => {
    const { fake, resolver } = cold();
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vision`), text("", 500));
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("WEB_REMIX");
  });

  it("while the warm-up is still running, the next track keeps VISIONOS first", async () => {
    const { worker, state, resolver } = cold();
    let release!: (token: string) => void;
    worker.token = () => new Promise((resolve) => (release = resolve));
    await resolver.resolve({ id: ID }, { progressive: true }, signal());
    state.ready = true;
    const second = await resolver.resolve({ id: "vidBBBBBBB2" }, { progressive: true }, signal());
    expect(second.servedBy).toBe("VISIONOS");
    worker.token = async () => "T";
    release("T");
    await vi.waitFor(async () => {
      // A track keeps the client that served it, so every try asks for a new one.
      const id = `vid${Math.random().toString(36).slice(2, 10).padEnd(8, "x")}`.slice(0, 11);
      const third = await resolver.resolve({ id }, { progressive: true }, signal());
      expect(third.servedBy).toBe("WEB_REMIX");
    });
  });

  it("a cold early start plays VISIONOS before its probe; verify swaps on a failed probe", async () => {
    const { fake, resolver } = cold();
    const probes = () => fake.calls.filter((call) => call.url.startsWith(`${STREAM_HOST}?itag=251&r=vision`)).length;
    const source = await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    expect([source.servedBy, probes(), source.verify !== undefined]).toEqual(["VISIONOS", 0, true]);
    await source.verify!();
    expect(probes()).toBe(1);
  });

  it("a cold early start whose probe fails goes on with the next client", async () => {
    const { fake, resolver } = cold();
    fake.on("GET", (url) => url.startsWith(`${STREAM_HOST}?itag=251&r=vision`), text("", 500));
    const source = await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    expect(source.servedBy).toBe("VISIONOS");
    expect((await source.verify!()).servedBy).toBe("WEB_REMIX");
  });

  it("a cold early start warms the worker only once the stream answered (verify)", async () => {
    const { worker, resolver } = cold();
    const source = await resolver.resolve({ id: ID }, { progressive: true, early: true }, signal());
    expect(worker.tokens).toEqual([]);
    expect(worker.transforms).toEqual([]);
    await source.verify!();
    expect(worker.tokens).toEqual([ID]);
  });

  it("a ready worker keeps the normal order and starts no warm-up", async () => {
    const { worker, state, resolver } = cold();
    state.ready = true;
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("WEB_REMIX");
    expect(worker.tokens).toEqual([ID]);
  });

  it("a worker that cannot tell is treated as ready", async () => {
    const { worker, resolver } = cold();
    worker.isReady = () => Promise.reject(new Error("ipc"));
    const source = await resolver.resolve({ id: ID }, { progressive: true }, signal());
    expect(source.servedBy).toBe("WEB_REMIX");
  });
});
