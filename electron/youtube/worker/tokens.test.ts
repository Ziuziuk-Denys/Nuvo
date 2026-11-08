// @vitest-environment node
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { ContentTokens, TvIdentities, deadlineFor, type BotGuard, type Challenge, type TokenEnv } from "./tokens";
import { FakeFetch, json, text } from "../../../src/youtube/test/fakeFetch";

const ATT = "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false";
const GENERATE = "https://www.youtube.com/api/jnn/v1/GenerateIT";
const challengeJson = (extra: Record<string, unknown> = {}) => ({
  program: "PROGRAM",
  globalName: "bgGlobal",
  interpreterJavascript: {
    privateDoNotAccessOrElseSafeScriptWrappedValue: "/* interpreter */",
  },
  ...extra,
});

class FakeBotGuard implements BotGuard {
  snapshots: Array<{ challenge: Challenge; interpreter: string }> = [];
  integrityTokens: string[] = [];
  mints: string[] = [];
  async snapshot(challenge: Challenge, interpreter: string) {
    this.snapshots.push({ challenge, interpreter });
    return { response: "BG_RESPONSE", signalOutput: [] };
  }
  async minter(integrityToken: string) {
    this.integrityTokens.push(integrityToken);
    return {
      mint: async (identifier: string) => {
        this.mints.push(identifier);
        return `po-${identifier}`;
      },
    };
  }
}

let fake: FakeFetch;
let botguard: FakeBotGuard;
let loaded: string[];
let env: TokenEnv;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  fake = new FakeFetch();
  botguard = new FakeBotGuard();
  loaded = [];
  env = {
    fetch: fake.fetch,
    botguard,
    apiKey: "KEY",
    loadInterpreter: async (url) => (loaded.push(url), "/* downloaded */"),
  };
});

afterEach(() => vi.useRealTimers());

describe("content tokens", () => {
  it("one challenge and one GenerateIT serve two ids; the integrity token is made web-safe", async () => {
    fake.on("POST", ATT, json({ bgChallenge: challengeJson() }));
    fake.on("POST", GENERATE, json(["it+/x", 3600]));
    const tokens = new ContentTokens(env);
    expect(await tokens.mint("vidAAAAAAA1")).toBe("po-vidAAAAAAA1");
    expect(await tokens.mint("vidBBBBBBB2")).toBe("po-vidBBBBBBB2");
    expect(fake.callsTo("POST", ATT)).toHaveLength(1);
    expect(fake.callsTo("POST", GENERATE)).toHaveLength(1);
    expect(botguard.integrityTokens).toEqual(["it-_x"]);
    const generate = fake.callsTo("POST", GENERATE)[0];
    expect(generate.json()).toEqual(["O43z0dpjhgX20SCx4KAo", "BG_RESPONSE"]);
    expect(generate.headers).toMatchObject({
      "content-type": "application/json+protobuf",
      "x-goog-api-key": "KEY",
      "x-user-agent": "grpc-web-javascript/0.1",
    });
    expect(fake.callsTo("POST", ATT)[0].json()).toMatchObject({
      context: { client: { clientName: "WEB" } },
      engagementType: "ENGAGEMENT_TYPE_UNBOUND",
    });
  });

  it("a 3600 s TTL is renewed after 50 minutes", async () => {
    fake.on("POST", ATT, json({ bgChallenge: challengeJson() }));
    fake.on("POST", GENERATE, json(["it", 3600]));
    const tokens = new ContentTokens(env);
    await tokens.mint("a");
    vi.setSystemTime(49 * 60_000);
    await tokens.mint("b");
    expect(fake.callsTo("POST", ATT)).toHaveLength(1);
    vi.setSystemTime(51 * 60_000);
    await tokens.mint("c");
    expect(fake.callsTo("POST", ATT)).toHaveLength(2);
  });

  it("deadline: default six hours, never under a minute", () => {
    expect(deadlineFor(0, undefined)).toBe(6 * 3600_000 - 600_000);
    expect(deadlineFor(0, 0)).toBe(6 * 3600_000 - 600_000);
    expect(deadlineFor(0, 300)).toBe(60_000);
  });

  it("a null integrity token fails the mint and the next mint starts over", async () => {
    fake.on("POST", ATT, json({ bgChallenge: challengeJson() }));
    fake.on("POST", GENERATE, [json([null]), json(["it", 3600])]);
    const tokens = new ContentTokens(env);
    await expect(tokens.mint("a")).rejects.toThrow("no integrity token");
    expect(await tokens.mint("a")).toBe("po-a");
    expect(fake.callsTo("POST", ATT)).toHaveLength(2);
  });

  it("a protocol-relative interpreter URL is fetched through main as https", async () => {
    fake.on(
      "POST",
      ATT,
      json({
        bgChallenge: challengeJson({
          interpreterJavascript: undefined,
          interpreterUrl: {
            privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: "//www.google.com/js/th/abc.js",
          },
        }),
      }),
    );
    fake.on("POST", GENERATE, json(["it", 3600]));
    await new ContentTokens(env).mint("a");
    expect(loaded).toEqual(["https://www.google.com/js/th/abc.js"]);
    expect(botguard.snapshots[0].interpreter).toBe("/* downloaded */");
  });

  it("ten concurrent first mints fetch one challenge", async () => {
    fake.on("POST", ATT, json({ bgChallenge: challengeJson() }));
    fake.on("POST", GENERATE, json(["it", 3600]));
    const tokens = new ContentTokens(env);
    await Promise.all(Array.from({ length: 10 }, (_, i) => tokens.mint(`id${i}`)));
    expect(fake.callsTo("POST", ATT)).toHaveLength(1);
  });
});

describe("TV identity", () => {
  const tvPage = (withId = true) =>
    `<script>ytcfg.set({${withId ? `"LIVING_ROOM_PO_TOKEN_ID":"lr-123",` : ""}"visitorData":"CgtABCDEFGHIJKLMNOPQRSTU\\u003d","INNERTUBE_CLIENT_VERSION":"7.20260101.01.00"});</script><script src="/s/player/tvpl4yer/tv-player-ias.vflset/tv-player-ias.js"></script>`;
  const rJson = JSON.stringify({ bgChallenge: challengeJson() });
  const tvConfig = `)]}'\n{"webPlayerContextConfig":{},"challengeRequestKey":"TVKEY","challengeParams":{"R":${JSON.stringify(rJson)},"T":1}}`;

  it("reads the page fields, unescapes, mints for the living-room id, with the Cobalt agent", async () => {
    fake.on("GET", "https://www.youtube.com/tv", text(tvPage()));
    fake.on("GET", "https://www.youtube.com/tv_config?action_get_config=true&client=lb4&theme=cl", text(tvConfig));
    fake.on("POST", GENERATE, json(["it", 3600]));
    const identity = await new TvIdentities(env, async () => 20000).get();
    expect(identity).toEqual({
      token: "po-lr-123",
      livingRoomId: "lr-123",
      visitor: "CgtABCDEFGHIJKLMNOPQRSTU=",
      version: "7.20260101.01.00",
      scriptId: "tvpl4yer",
      signatureTimestamp: 20000,
    });
    expect(fake.callsTo("POST", GENERATE)[0].json()).toEqual(["TVKEY", "BG_RESPONSE"]);
    for (const call of fake.calls.filter((c) => c.method === "GET")) expect(call.headers["x-nuvo-ua"]).toContain("Cobalt");
  });

  it("a page without the living-room id names the missing field", async () => {
    fake.on("GET", "https://www.youtube.com/tv", text(tvPage(false)));
    await expect(new TvIdentities(env, async () => 1).get()).rejects.toThrow("LIVING_ROOM_PO_TOKEN_ID");
  });
});
