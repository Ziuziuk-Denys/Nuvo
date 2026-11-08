import { describe, expect, it, vi, beforeEach } from "vitest";
import { FakeFetch, json, text } from "./test/fakeFetch";
import { swBody, VISITOR } from "./test/harness";

const state = vi.hoisted(() => ({
  failNext: 0,
  created: [] as Array<{
    resolve: ReturnType<typeof vi.fn>;
    fetchWhole: ReturnType<typeof vi.fn>;
    warmUp: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("./playback", () => ({
  createPlayback: () => {
    if (state.failNext > 0) {
      state.failNext -= 1;
      throw new Error("chunk failed to load");
    }
    const instance = {
      resolve: vi.fn(async () => ({ url: "https://x" })),
      fetchWhole: vi.fn(async () => new Blob(["w"])),
      warmUp: vi.fn(),
      reset: vi.fn(),
    };
    state.created.push(instance);
    return instance;
  },
}));

const { createYoutube, noWorker } = await import("./index");
const { createRuntime } = await import("./runtime");

const ACCOUNT = "nuvo-core://local/v1/youtube/account";
const PREFERENCES = {
  playThroughAccount: true,
  offerSignIn: false,
  showAccountPlaylists: true,
};
const signal = () => new AbortController().signal;

function fakeFetch() {
  const fake = new FakeFetch();
  fake.on("GET", ACCOUNT, json({ session: null, preferences: PREFERENCES }));
  fake.on("PATCH", `${ACCOUNT}/preferences`, json({ ...PREFERENCES, playThroughAccount: false }));
  fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(VISITOR)));
  return fake;
}

const deps = (fake: FakeFetch, extra = {}) => ({
  fetch: fake.fetch,
  worker: noWorker,
  daemonBase: "nuvo-core://local",
  ...extra,
});

beforeEach(() => {
  state.failNext = 0;
  state.created.length = 0;
});

describe("runtime", () => {
  it("loads playback once and shares it", async () => {
    const runtime = createRuntime(deps(fakeFetch()));
    const [a, b] = await Promise.all([runtime.loadPlayback(), runtime.loadPlayback()]);
    expect(a).toBe(b);
    expect(await runtime.loadPlayback()).toBe(a);
    expect(state.created).toHaveLength(1);
  });

  it("a failed load is retried by the next request", async () => {
    const runtime = createRuntime(deps(fakeFetch()));
    state.failNext = 1;
    await expect(runtime.loadPlayback()).rejects.toThrow("chunk failed");
    await expect(runtime.loadPlayback()).resolves.toBeDefined();
    expect(state.created).toHaveLength(1);
  });

  it("reset never loads playback; warmUp and resolve do", async () => {
    const youtube = createYoutube(deps(fakeFetch()));
    youtube.playback.reset();
    await youtube.ready;
    expect(state.created).toHaveLength(0);
    youtube.playback.warmUp();
    await vi.waitFor(() => expect(state.created[0]?.warmUp).toHaveBeenCalled());
    youtube.playback.reset();
    await vi.waitFor(() => expect(state.created[0].reset).toHaveBeenCalled());
    await youtube.playback.resolve({ id: "x" }, { progressive: true }, signal());
    expect(state.created[0].resolve).toHaveBeenCalledTimes(1);
  });

  it("fetchWhole is passed to the loaded playback", async () => {
    const youtube = createYoutube(deps(fakeFetch()));
    const blob = await youtube.playback.fetchWhole({ url: "https://x", mimeType: "audio/webm" }, signal());
    expect(await blob.text()).toBe("w");
  });

  it("an account change resets the loaded playback", async () => {
    const runtime = createRuntime(deps(fakeFetch()));
    await runtime.loadPlayback();
    expect(state.created[0].reset).not.toHaveBeenCalled();
    await runtime.account.preferences.set({ playThroughAccount: false });
    expect(state.created[0].reset).toHaveBeenCalledTimes(1);
  });

  it("a failed migration is logged and the account still loads", async () => {
    const fake = fakeFetch();
    fake.on("PUT", `${ACCOUNT}/session`, new Response(null, { status: 500 }));
    const values = new Map([["nuvo_youtube_tv_session", JSON.stringify({ accessToken: "A", refreshToken: "R", expiresAt: 5 })]]);
    const log = vi.fn();
    const youtube = createYoutube(
      deps(fake, {
        log,
        storage: {
          getItem: (key: string) => values.get(key) ?? null,
          removeItem: (key: string) => void values.delete(key),
        },
      }),
    );
    await youtube.ready;
    expect(log.mock.calls.flat().join("\n")).toMatch(/migration deferred/);
    expect(youtube.account.preferences.get().playThroughAccount).toBe(true);
    expect(values.size).toBe(1);
  });

  it("dispose stops the account listener, resets playback, closes the worker, and is idempotent", async () => {
    const close = vi.fn();
    const runtime = createRuntime(deps(fakeFetch(), { worker: { ...noWorker, close } }));
    await runtime.loadPlayback();
    runtime.dispose();
    runtime.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(state.created[0].reset).toHaveBeenCalledTimes(1));
    await runtime.account.preferences.set({ playThroughAccount: false });
    expect(state.created[0].reset).toHaveBeenCalledTimes(1);
    await expect(runtime.loadPlayback()).rejects.toThrow("disposed");
  });

  it("dispose before playback loads creates nothing", async () => {
    const runtime = createRuntime(deps(fakeFetch()));
    runtime.dispose();
    await expect(runtime.loadPlayback()).rejects.toThrow("disposed");
    expect(state.created).toHaveLength(0);
  });
});
