import { describe, expect, it, vi, afterEach } from "vitest";
import { json, FakeFetch, text } from "./youtube/test/fakeFetch";
import { swBody, VISITOR } from "./youtube/test/harness";
import { bootYoutube, getYoutube } from "./youtubeBoot";

function daemon(offerSignIn: boolean) {
  const fake = new FakeFetch();
  fake.on(
    "GET",
    "nuvo-core://local/v1/youtube/account",
    json({
      session: null,
      preferences: { playThroughAccount: true, offerSignIn, showAccountPlaylists: true },
    }),
  );
  fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(VISITOR)));
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.nuvoShell;
});

describe("bootYoutube", () => {
  it("the engine's YouTube port reaches the worker through window.nuvoShell", async () => {
    vi.stubGlobal("fetch", daemon(false).fetch);
    const youtubeCall = vi.fn(async () => {
      throw new Error("Error invoking remote method 'nuvo-yt:call': Error: worker-start");
    });
    window.nuvoShell = { youtubeCall, onNetworkChanged: () => () => undefined } as unknown as NonNullable<typeof window.nuvoShell>;
    const { youtube, ports } = bootYoutube(() => undefined);
    expect(getYoutube()).toBe(youtube);
    await youtube.ready;
    await ports.youtube
      .resolve({ id: "vidAAAAAAA1" } as never, { progressive: false, quality: "normal" } as never, new AbortController().signal)
      .catch(() => undefined);
    expect(youtubeCall).toHaveBeenCalledWith("content-token", { identifier: "vidAAAAAAA1" });
    youtube.dispose();
  });

  it("the sign-in offer follows the preference and the signed-in state", async () => {
    vi.stubGlobal("fetch", daemon(false).fetch);
    const off = bootYoutube(() => undefined);
    await off.youtube.ready;
    expect(off.ports.offerSignIn()).toBe(false);
    off.ports.askForSignIn();
    expect(off.offer.state.phase).toBe("closed");

    vi.stubGlobal("fetch", daemon(true).fetch);
    const on = bootYoutube(() => undefined);
    await on.youtube.ready;
    expect(on.ports.offerSignIn()).toBe(true);
  });

  it("dispose releases the online listener, and a second boot disposes the first", async () => {
    vi.stubGlobal("fetch", daemon(false).fetch);
    const removed = vi.spyOn(window, "removeEventListener");
    const first = bootYoutube(() => undefined);
    const second = bootYoutube(() => undefined);
    expect(removed).toHaveBeenCalledWith("online", expect.any(Function));
    expect(getYoutube()).toBe(second.youtube);
    removed.mockClear();
    second.dispose();
    expect(removed).toHaveBeenCalledWith("online", expect.any(Function));
    expect(() => getYoutube()).toThrow("has not run");
    first.dispose();
    removed.mockRestore();
  });
});
