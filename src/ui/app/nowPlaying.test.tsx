import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../ports/player";
import { useNowPlayingReport } from "./nowPlaying";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
let root: Root;

function Probe() {
  useNowPlayingReport();
  return null;
}

function play(id: string, status: "loading" | "playing" | "paused") {
  act(() => usePlayerStore.setState({ currentTrack: { id, title: `Song ${id}`, artists: "Nova", durationMs: 180_000 } as never, status }));
}

function sent() {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as { trackId: string; trackSnapshot: { title: string } } }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  usePlayerStore.setState({ currentTrack: null, status: "idle" });
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  fetchMock.mockClear();
  vi.unstubAllGlobals();
});

describe("useNowPlayingReport", () => {
  it("reports each track once, when it starts playing", () => {
    play("t1", "loading");
    expect(fetchMock).not.toHaveBeenCalled();
    play("t1", "playing");
    play("t1", "paused");
    play("t1", "playing");
    play("t2", "playing");
    expect(sent()).toEqual([
      { url: "nuvo-core://local/v1/me/playback/now-playing", body: { trackId: "t1", trackSnapshot: expect.objectContaining({ title: "Song t1" }) } },
      { url: "nuvo-core://local/v1/me/playback/now-playing", body: { trackId: "t2", trackSnapshot: expect.objectContaining({ title: "Song t2" }) } },
    ]);
  });
});
