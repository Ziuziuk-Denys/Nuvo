import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { bootEngine, fullyCachedCheck, type BootDeps } from "./boot";
import { player, startEngine, stopEngine, usePlayerView } from "./index";
import { FakeContext, FakeElement } from "./test/fakeAudio";
import { FakeYoutube, MemoryStorage } from "./test/harness";

const deps = (): BootDeps => ({
  youtube: new FakeYoutube(),
  catalog: { searchFiltered: async () => [], radio: async () => [] },
  library: {
    isLiked: () => false,
    onLikedChange: () => () => undefined,
    like: async () => undefined,
    unlike: async () => undefined,
  } as unknown as BootDeps["library"],
  lyrics: { follow: () => undefined, prefetch: () => undefined },
  covers: { warm: () => undefined, drawn: (url) => url },
  notify: () => undefined,
  askForSignIn: () => undefined,
  offerSignIn: () => false,
  network: { checkSoon: () => undefined },
  eqBands: [],
  transitionContext: () => ({
    crossfadeSeconds: 0,
    albumInOrder: false,
    repeat: "off",
    abLoop: false,
    sleepAtTrackEnd: false,
    reverbCurrent: null,
    reverbNext: null,
  }),
});

describe("bootEngine", () => {
  const contexts: FakeContext[] = [];

  beforeEach(() => {
    contexts.length = 0;
    delete (globalThis as { __nuvoAudio?: unknown }).__nuvoAudio;
    vi.stubGlobal("Audio", FakeElement);
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          contexts.push(this);
        }
        async close() {
          this.state = "closed";
        }
      },
    );
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("navigator", {
      onLine: true,
      mediaDevices: { enumerateDevices: async () => [], addEventListener: () => undefined, removeEventListener: () => undefined },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("a second boot after dispose builds its graph on a fresh context and fresh elements", () => {
    const first = bootEngine(deps());
    first.decks.rebuildGraph();
    const firstElements = first.decks.clock.activeElement();
    expect(first.decks.audioContext).toBe(contexts[0]);
    first.dispose();
    expect(contexts[0].state).toBe("closed");

    const second = bootEngine(deps());
    second.decks.rebuildGraph();
    expect(contexts).toHaveLength(2);
    expect(second.decks.audioContext).toBe(contexts[1]);
    expect(contexts[1].state).toBe("running");
    expect(contexts[1].ofType("gain").length).toBeGreaterThan(0);
    expect(second.decks.clock.activeElement()).not.toBe(firstElements);
    second.dispose();
  });

  it("dispose releases the decks and the pre-cache exactly once", () => {
    const booted = bootEngine(deps());
    const decks = vi.spyOn(booted.decks, "dispose");
    const precache = vi.spyOn(booted.precache, "dispose");
    booted.dispose();
    booted.dispose();
    expect(decks).toHaveBeenCalledTimes(1);
    expect(precache).toHaveBeenCalledTimes(1);
  });

  it("usePlayerView subscribes once however often the component renders", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    startEngine(deps());
    const subscribe = vi.spyOn(player(), "subscribe");
    const Probe = ({ tick }: { tick: number }) => createElement("span", null, `${usePlayerView((view) => view.status)}${tick}`);
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe, { tick: 0 })));
    act(() => root.render(createElement(Probe, { tick: 1 })));
    act(() => root.render(createElement(Probe, { tick: 2 })));
    expect(subscribe).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    stopEngine();
  });
});

describe("fullyCachedCheck", () => {
  const daemon = (local: number, cached: boolean) => ({
    probeLocal: async () =>
      local === 206 ? { ok: true as const, probe: { codec: "flac", bitrateKbps: null, mime: "audio/flac" } } : { ok: false as const, status: local },
    probeCache: async () => (cached ? { codec: "opus", bitrateKbps: 128, mime: "audio/webm" } : null),
  });
  const resolver = { isKnownCached: () => false };
  const localId = `local:${"a".repeat(32)}`;

  it("a readable local file is ready to preload for a gapless start, a missing or undecodable one is not", async () => {
    expect(await fullyCachedCheck(daemon(206, false), resolver)(localId)).toBe(true);
    expect(await fullyCachedCheck(daemon(404, false), resolver)(localId)).toBe(false);
    expect(await fullyCachedCheck(daemon(415, false), resolver)(localId)).toBe(false);
  });

  it("a cached stream after a local file, and a local file after a cached stream, both preload", async () => {
    const check = fullyCachedCheck(daemon(206, true), resolver);
    expect(await check("dQw4w9WgXcQ")).toBe(true);
    expect(await check(localId)).toBe(true);
    expect(await fullyCachedCheck(daemon(206, false), resolver)("dQw4w9WgXcQ")).toBe(false);
  });
});
