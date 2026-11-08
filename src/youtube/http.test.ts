import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Innertube, VisitorData, parseVisitorData } from "./http";
import { FakeFetch, json, text } from "./test/fakeFetch";
import { YtError } from "./types";

const V1 = "CgsAAAAAAAAAAAAAAAAAAAAAAAA%3D%3D";
const V2 = "CgtBBBBBBBBBBBBBBBBBBBBBBBB%3D%3D";
const swBody = (value: string) =>
  `)]}'\n${JSON.stringify([[null, null, [[[null, null, null, null, null, null, null, null, null, null, null, null, null, value]]]]])}`;
const BROWSE = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";

let fake: FakeFetch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  fake = new FakeFetch();
});

afterEach(() => {
  vi.useRealTimers();
});

const client = () => new Innertube(fake.fetch, new VisitorData(fake.fetch));

describe("visitor data", () => {
  it("reads the value at its JSON path after the anti-JSON prefix", () => {
    expect(parseVisitorData(swBody("CgsXXXXXXXXXXXXXXXXXXXXXXXX"))).toBe("CgsXXXXXXXXXXXXXXXXXXXXXXXX");
  });

  it("keeps URL-encoded padding", () => {
    expect(parseVisitorData(swBody(V1))).toBe(V1);
  });

  it("finds the token by pattern when the shape changed", () => {
    expect(parseVisitorData(`{"other":{"deep":"CgtYYYYYYYYYYYYYYYYYYYYYYYY=="}}`)).toBe("CgtYYYYYYYYYYYYYYYYYYYYYYYY==");
  });

  it("is valid for 5.5 hours", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", json({}));
    const yt = client();
    await yt.call("browse", { browseId: "x" });
    vi.setSystemTime(5 * 3600_000);
    await yt.call("browse", { browseId: "x" });
    vi.setSystemTime(5.6 * 3600_000);
    await yt.call("browse", { browseId: "x" });
    expect(fake.callsTo("GET", "https://www.youtube.com/sw.js_data")).toHaveLength(2);
    fake.assertClean();
  });

  it("concurrent callers share one fetch", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", json({}));
    const yt = client();
    await Promise.all(Array.from({ length: 10 }, () => yt.call("browse", {})));
    expect(fake.callsTo("GET", "https://www.youtube.com/sw.js_data")).toHaveLength(1);
  });

  it("a failed refresh keeps the stale value; with none the request goes without it", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", [text(swBody(V1)), text("", 500)]);
    fake.innertube("browse", json({}));
    const yt = client();
    await yt.call("browse", {});
    vi.setSystemTime(6 * 3600_000);
    await yt.call("browse", {});
    expect(fake.calls.at(-1)!.headers["x-goog-visitor-id"]).toBe(V1);

    const bare = new FakeFetch();
    bare.on("GET", "https://www.youtube.com/sw.js_data", text("", 500));
    bare.innertube("browse", json({}));
    await new Innertube(bare.fetch, new VisitorData(bare.fetch)).call("browse", {});
    const call = bare.calls.at(-1)!;
    expect(call.headers["x-goog-visitor-id"]).toBeUndefined();
    expect(call.json<{ context: { client: Record<string, unknown> } }>().context.client.visitorData).toBeUndefined();
  });
});

describe("request rules", () => {
  it("a 403 resets visitor data and retries once", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", [text(swBody(V1)), text(swBody(V2))]);
    fake.innertube("browse", [json({}, 403), json({ ok: true })]);
    const result = await client().call<{ ok: boolean }>("browse", {
      browseId: "MPREb_1",
    });
    expect(result.ok).toBe(true);
    const browses = fake.callsTo("POST", BROWSE);
    expect(browses).toHaveLength(2);
    expect(browses[1].headers["x-goog-visitor-id"]).toBe(V2);
  });

  it("a second 403 is an http error", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", json({}, 403));
    const error = (await client()
      .call("browse", {})
      .catch((e) => e)) as YtError;
    expect(error).toBeInstanceOf(YtError);
    expect([error.code, error.status]).toEqual(["http", 403]);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(2);
  });

  it("a 500 is not retried", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", json({}, 500));
    await expect(client().call("browse", {})).rejects.toMatchObject({
      code: "http",
      status: 500,
    });
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(1);
  });

  it("network failure is unreachable; an abort stays an AbortError", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client().call("browse", {})).rejects.toMatchObject({
      code: "unreachable",
      status: 0,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client().call("browse", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("an HTML body is bad-json", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("browse", text("<html></html>"));
    await expect(client().call("browse", {})).rejects.toMatchObject({
      code: "bad-json",
      status: 502,
    });
  });

  it("WEB_REMIX requests carry the fixed context and headers", async () => {
    fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(V1)));
    fake.innertube("search", json({}));
    await client().call("search", { query: "q" });
    const call = fake.calls.at(-1)!;
    expect(call.url).toBe("https://music.youtube.com/youtubei/v1/search?prettyPrint=false");
    const body = call.json<{
      query: string;
      context: {
        client: Record<string, unknown>;
        user: Record<string, unknown>;
      };
    }>();
    expect(body.query).toBe("q");
    expect(body.context.client).toMatchObject({
      clientName: "WEB_REMIX",
      hl: "en",
      gl: "US",
      visitorData: V1,
    });
    expect(body.context.user.lockedSafetyMode).toBe(false);
    expect(call.headers["x-youtube-client-name"]).toBe("67");
    expect(call.headers["x-youtube-client-version"]).toBe(body.context.client.clientVersion);
  });
});
