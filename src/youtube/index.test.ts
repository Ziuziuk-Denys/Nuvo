import { describe, expect, it, vi } from "vitest";
import { json, FakeFetch, text } from "./test/fakeFetch";
import { swBody, VISITOR } from "./test/harness";

const state = vi.hoisted(() => ({ playbackLoaded: false }));

vi.mock("./playback", async (importOriginal) => {
  state.playbackLoaded = true;
  return importOriginal();
});

const { createYoutube, noWorker } = await import("./index");

function daemonAndYoutube() {
  const fake = new FakeFetch();
  fake.on(
    "GET",
    "nuvo-core://local/v1/youtube/account",
    json({
      session: null,
      preferences: {
        playThroughAccount: true,
        offerSignIn: false,
        showAccountPlaylists: true,
      },
    }),
  );
  fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(VISITOR)));
  return fake;
}

describe("front door", () => {
  it("catalog and account work without loading playback; the first stream request loads it", async () => {
    const fake = daemonAndYoutube();
    fake.innertube("search", json({}));
    const youtube = createYoutube({
      fetch: fake.fetch,
      worker: noWorker,
      daemonBase: "nuvo-core://local",
    });
    await youtube.ready;
    await youtube.catalog.searchFiltered("q", "track", new AbortController().signal);
    expect(youtube.account.status()).toBe(false);
    expect(youtube.catalog.parseUrl("https://youtu.be/abcDEF12_-x")).toEqual({
      videoId: "abcDEF12_-x",
    });
    expect(state.playbackLoaded).toBe(false);
    await youtube.playback.resolve({ id: "bad" }, { progressive: true }, new AbortController().signal).catch(() => undefined);
    expect(state.playbackLoaded).toBe(true);
  });

  it("the old renderer keys are migrated before the account loads", async () => {
    const fake = daemonAndYoutube();
    fake.on("PUT", "nuvo-core://local/v1/youtube/account/session", new Response(null, { status: 204 }));
    const values = new Map([["nuvo_youtube_tv_session", JSON.stringify({ accessToken: "A", refreshToken: "R", expiresAt: 5 })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
    };
    const youtube = createYoutube({
      fetch: fake.fetch,
      worker: noWorker,
      daemonBase: "nuvo-core://local",
      storage,
    });
    await youtube.ready;
    expect(fake.calls.map((call) => `${call.method} ${call.url}`).slice(0, 2)).toEqual([
      "PUT nuvo-core://local/v1/youtube/account/session",
      "GET nuvo-core://local/v1/youtube/account",
    ]);
    expect(values.size).toBe(0);
  });
});
