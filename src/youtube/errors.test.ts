/** Errors from the real front door, mapped by the engine's own youtubeCause. */
import { describe, expect, it } from "vitest";
import { youtubeCause } from "../engine/sources/ports";
import { createYoutube } from "./index";
import { FakeFetch, json, text } from "./test/fakeFetch";
import { STREAM_HOST, format, fromClient, playerResponse } from "./test/formats";
import { swBody, VISITOR } from "./test/harness";
import { FakeWorker, streamRoutes } from "./test/playback";
import { YtError } from "./types";

const WWW = "https://www.youtube.com";
const ID = "vidAAAAAAA1";

function setup() {
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
  fake.on("GET", `${WWW}/sw.js_data`, text(swBody(VISITOR)));
  streamRoutes(fake);
  const youtube = createYoutube({
    fetch: fake.fetch,
    worker: new FakeWorker(),
    daemonBase: "nuvo-core://local",
  });
  return { fake, youtube };
}

function everyClient(fake: FakeFetch, status: string) {
  const reply = json(playerResponse({ status, reason: "no" }));
  fake.innertube("player", reply);
  fake.innertube("player", reply, undefined, WWW);
}

async function failure(youtube: ReturnType<typeof setup>["youtube"]) {
  const error = await youtube.playback.resolve({ id: ID }, { progressive: true }, new AbortController().signal).then(
    () => {
      throw new Error("expected a failure");
    },
    (caught) => caught,
  );
  return youtubeCause(error, true);
}

describe("error mapping through the front door", () => {
  it("a bot check on every client is sign_in_required", async () => {
    const { fake, youtube } = setup();
    everyClient(fake, "LOGIN_REQUIRED");
    const cause = await failure(youtube);
    expect([cause.cause, cause.detail.botCheck]).toEqual(["sign_in_required", true]);
  });

  it("sign-in-required is sign_in_required", () => {
    expect(youtubeCause(new YtError("sign-in-required"), true).cause).toBe("sign_in_required");
  });

  it("all clients failing with a 403 is blocked", async () => {
    const { fake, youtube } = setup();
    everyClient(fake, "UNPLAYABLE");
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251 })] })), fromClient("WEB_REMIX"));
    fake.on("GET", (url) => url.startsWith(STREAM_HOST), text("", 403));
    const cause = await failure(youtube);
    expect([cause.cause, cause.detail.httpStatus]).toEqual(["blocked", 403]);
  });

  it("all clients failing with a 429 is rate_limited", async () => {
    const { fake, youtube } = setup();
    everyClient(fake, "UNPLAYABLE");
    fake.innertube("player", json(playerResponse({ formats: [format({ itag: 251 })] })), fromClient("WEB_REMIX"));
    fake.on("GET", (url) => url.startsWith(STREAM_HOST), text("", 429));
    expect((await failure(youtube)).cause).toBe("rate_limited");
  });
});
