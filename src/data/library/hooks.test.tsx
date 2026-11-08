import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const like = vi.hoisted(() => vi.fn(async () => undefined));
const changed = vi.hoisted(() => vi.fn());
const playlistsState = vi.hoisted(() => ({ store: null as null | { setState(state: { status: string }): void } }));
vi.mock("./changes", () => ({ notifyLibraryChanged: changed, onLibraryChange: () => () => undefined }));
vi.mock("./library", async () => {
  const { createLiked } = await import("./liked");
  const { createStore } = await import("zustand/vanilla");
  const liked = createLiked({
    client: { likedPage: async () => ({ tracks: [], next: null }), likedIds: async () => ["a"], like, unlike: async () => undefined },
    onError: () => undefined,
    onChange: () => undefined,
  });
  await liked.load();
  const playlists = createStore(() => ({ items: [], status: "ready" }));
  playlistsState.store = playlists;
  const slot = { items: [], loaded: true };
  const saved = createStore(() => ({ album: slot, artist: slot, playlist: slot }));
  return { library: () => ({ liked, collections: { playlists, saved } }), startLibrary: () => undefined };
});

import { useIsTrackLiked, useLikeTrack, usePlaylistsList } from "./hooks";

describe("library hooks", () => {
  it("like takes the track and the heart follows the id set", async () => {
    const seen: boolean[] = [];
    let mutation: ReturnType<typeof useLikeTrack> | null = null;
    function Probe() {
      seen.push(useIsTrackLiked("b"));
      mutation = useLikeTrack();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    const onSettled = vi.fn();
    await act(async () => mutation!.mutate({ id: "b", title: "B", artists: "A", coverUrl: "", durationMs: 1 }, { onSettled }));
    expect(like).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(seen.at(-1)).toBe(true);
    expect(onSettled).toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("a screen that mounts while the playlists failed asks for a fresh read, once per mount", () => {
    playlistsState.store!.setState({ status: "error" });
    changed.mockClear();
    function Probe() {
      usePlaylistsList();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    expect(changed).toHaveBeenCalledTimes(1);
    act(() => root.render(<Probe />));
    expect(changed).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    playlistsState.store!.setState({ status: "ready" });
    const healthy = createRoot(document.createElement("div"));
    act(() => healthy.render(<Probe />));
    expect(changed).toHaveBeenCalledTimes(1);
    act(() => healthy.unmount());
  });
});
