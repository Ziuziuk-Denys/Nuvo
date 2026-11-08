import { describe, expect, it } from "vitest";
import { createPlayback } from ".";
import { text } from "../test/fakeFetch";
import { harness, signal } from "../test/harness";
import { FakeWorker, streamRoutes } from "../test/playback";

function setup() {
  const h = harness();
  const playback = createPlayback({
    yt: h.yt,
    fetch: h.fake.fetch,
    worker: new FakeWorker(),
    account: { status: () => false } as never,
    playThroughAccount: () => false,
  });
  return { ...h, playback };
}

const base = { mimeType: "audio/webm" };

describe("fetchWhole", () => {
  it("returns ready bytes without a request", async () => {
    const { fake, playback } = setup();
    const bytes = new Blob(["a"]);
    expect(await playback.fetchWhole({ ...base, bytes }, signal())).toBe(bytes);
    expect(fake.calls).toHaveLength(0);
  });

  it("waits for the progressive whole", async () => {
    const { playback } = setup();
    const whole = Promise.resolve(new Blob(["b"]));
    const result = await playback.fetchWhole({ ...base, progressive: { whole } as never }, signal());
    expect(await result.text()).toBe("b");
  });

  it("downloads a plain URL", async () => {
    const { fake, playback } = setup();
    fake.on("GET", "https://example.test/a", text("hello"));
    const result = await playback.fetchWhole({ ...base, url: "https://example.test/a" }, signal());
    expect(await result.text()).toBe("hello");
  });

  it("rejects without a URL, and when the download is not cacheable", async () => {
    const { fake, playback } = setup();
    await expect(playback.fetchWhole({ ...base }, signal())).rejects.toMatchObject({ code: "rejected-stream" });
    fake.on("GET", "https://example.test/b", text("", 404));
    await expect(playback.fetchWhole({ ...base, url: "https://example.test/b" }, signal())).rejects.toMatchObject({ code: "rejected-stream" });
  });
});

describe("warmUp and reset", () => {
  it("warmUp fetches visitor data and swallows failures; reset forgets it", async () => {
    const { fake, yt, playback } = setup();
    const visitorCalls = () => fake.callsTo("GET", "https://www.youtube.com/sw.js_data").length;
    playback.warmUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visitorCalls()).toBe(1);
    playback.reset();
    await yt.visitor.get();
    expect(visitorCalls()).toBe(2);
  });

  it("warmUp reads the player id but never starts the worker", async () => {
    const h = harness();
    streamRoutes(h.fake);
    const worker = new FakeWorker();
    const playback = createPlayback({
      yt: h.yt,
      fetch: h.fake.fetch,
      worker,
      account: { status: () => false } as never,
      playThroughAccount: () => false,
    });
    playback.warmUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fake.callsTo("GET", "https://www.youtube.com/iframe_api")).toHaveLength(1);
    expect([worker.tokens, worker.transforms, worker.identities]).toEqual([[], [], 0]);
  });
});
