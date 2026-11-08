// @vitest-environment node
/**
 * Live smoke tests against YouTube. Skipped unless
 * NUVO_YT_LIVE=1; never part of the gate. The worker mint and WEB_REMIX need Electron and run by hand.
 */
import { resolveObjectURL } from "node:buffer";
import { Worker as NodeWorker } from "node:worker_threads";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PlayerTransforms } from "../../electron/youtube/worker/transform";
import { createYoutubeiSolver } from "../../electron/youtube/worker/solver";
import { createCatalog } from "./catalog";
import { ANDROID_VR, PLAYER_PATH, VISIONOS, WWW_ORIGIN } from "./constants";
import { Innertube, VisitorData, type FetchLike } from "./http";
import { fallbackAttempt } from "./playback/attempts";
import { PlayerScript, probe } from "./playback/player";
import { noWorker } from "./playback/worker";

const LIVE = process.env.NUVO_YT_LIVE === "1";
const QUERY = process.env.NUVO_YT_QUERY ?? "daft punk one more time";

/** What Electron main does for the renderer: `x-nuvo-ua` becomes `User-Agent`, origin headers follow the host. */
const shellFetch: FetchLike = (url, init = {}) => {
  const headers = new Headers(init.headers);
  const agent = headers.get("x-nuvo-ua");
  headers.delete("x-nuvo-ua");
  if (agent) headers.set("user-agent", agent);
  const host = new URL(url).hostname;
  if (host.endsWith(".youtube.com") || host.endsWith(".googlevideo.com")) {
    const origin = host === "www.youtube.com" ? WWW_ORIGIN : "https://music.youtube.com";
    headers.set("origin", origin);
    headers.set("referer", `${origin}/`);
  }
  return fetch(url, { ...init, headers });
};

/** Node has no Web Worker; the solver's per-call thread runs on a `worker_threads` stand-in here. */
class NodeWebWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  private readonly thread: Promise<NodeWorker>;

  constructor(url: string) {
    this.thread = resolveObjectURL(url)!
      .text()
      .then((source) => {
        const thread = new NodeWorker(
          `const { parentPort } = require("node:worker_threads");
          globalThis.postMessage = (data) => parentPort.postMessage(data);
          parentPort.on("message", (data) => globalThis.onmessage({ data }));
          ${source}`,
          { eval: true },
        );
        thread.on("message", (data) => this.onmessage?.({ data }));
        thread.on("error", (error) => this.onerror?.({ message: String(error) }));
        return thread;
      });
  }

  postMessage(data: unknown) {
    void this.thread.then((thread) => thread.postMessage(data));
  }

  terminate() {
    void this.thread.then((thread) => thread.terminate());
  }
}

describe.skipIf(!LIVE)("live YouTube (on demand)", () => {
  beforeAll(() => vi.stubGlobal("Worker", NodeWebWorker));
  const yt = new Innertube(shellFetch, new VisitorData(shellFetch));
  const signal = () => AbortSignal.timeout(30_000);

  it("search finds tracks", async () => {
    const items = await createCatalog({ yt, fetch: shellFetch }).search(QUERY, "track", signal());
    expect(items.filter((item) => item.kind === "track").length).toBeGreaterThan(0);
  }, 40_000);

  it.each([VISIONOS, ANDROID_VR])(
    "$clientName resolves a probed stream without the worker",
    async (client) => {
      const [first] = await createCatalog({
        yt,
        fetch: shellFetch,
      }).searchFiltered(QUERY, "track", signal());
      const deps = {
        yt,
        fetch: shellFetch,
        worker: noWorker,
        player: new PlayerScript(shellFetch, noWorker),
      };
      const hit = await fallbackAttempt(deps, client, first.id, { quality: "normal" }, signal());
      expect(hit.url).toContain("googlevideo.com");
      await probe(shellFetch, hit.url, Number(hit.format.contentLength) || undefined, signal());
    },
    60_000,
  );

  it("the youtubei.js solver transforms n with the current TV player script", async () => {
    const page = await (await shellFetch(`${WWW_ORIGIN}/iframe_api`)).text();
    const playerId = page.match(PLAYER_PATH)![1];
    const transforms = new PlayerTransforms(shellFetch, createYoutubeiSolver);
    const scrambled = "AOq0QJ8wRQIhAKzTestSignatureValue0123456789abcdefghijklmnopqrstuvwxyz";
    const result = await transforms.transform(playerId, ["abcdefghijklmnopq"], [scrambled]);
    expect(result.signatureTimestamp).toBeGreaterThan(10_000);
    expect(result.n[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.n[0]).not.toBe("abcdefghijklmnopq");
    expect(result.sig[0]).not.toBe(scrambled);
  }, 60_000);
});
