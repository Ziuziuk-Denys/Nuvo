import { createStore, type StoreApi } from "zustand/vanilla";
import type { Track } from "@/engine/types";
import type { LibraryClient } from "./client";

export const LIKED_PAGE = 500;

export interface LikedState {
  ids: ReadonlySet<string>;
  tracks: readonly Track[];
  status: "idle" | "loading" | "ready" | "error";
  refreshing: boolean;
}

interface LikedDeps {
  client: Pick<LibraryClient, "likedPage" | "likedIds" | "like" | "unlike">;
  onError(error: unknown): void;
  onChange(): void;
}

interface Intent {
  liked: boolean;
  track: Track | undefined;
  confirmed: boolean;
  index: number;
  pending: number;
  doneAt: number;
}

export function createLiked({ client, onError, onChange }: LikedDeps) {
  const store: StoreApi<LikedState> = createStore<LikedState>(() => ({ ids: new Set(), tracks: [], status: "idle", refreshing: false }));
  const latestAction = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  const intents = new Map<string, Intent>();
  let actions = 0;
  /** Counts write starts and ends; a read that began before a write ended may not have seen it. */
  let clock = 0;

  // writes for one id reach the daemon one after another, so its final state is the last press
  function queue(id: string, write: () => Promise<void>): Promise<void> {
    const run = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(write);
    chains.set(id, run);
    void run
      .catch(() => undefined)
      .finally(() => {
        if (chains.get(id) === run) chains.delete(id);
      });
    return run;
  }

  function place(id: string, liked: boolean, track?: Track, index = 0): void {
    const { ids, tracks } = store.getState();
    const nextIds = new Set(ids);
    const rest = tracks.filter((t) => t.id !== id);
    if (liked) {
      nextIds.add(id);
      if (track) rest.splice(Math.min(index, rest.length), 0, track);
    } else {
      nextIds.delete(id);
    }
    store.setState({ ids: nextIds, tracks: rest });
  }

  function intentFor(id: string): Intent {
    const known = intents.get(id);
    if (known) return known;
    const { ids, tracks } = store.getState();
    const index = tracks.findIndex((t) => t.id === id);
    const fresh: Intent = {
      liked: ids.has(id),
      track: index >= 0 ? tracks[index] : undefined,
      confirmed: ids.has(id),
      index: Math.max(0, index),
      pending: 0,
      doneAt: 0,
    };
    intents.set(id, fresh);
    return fresh;
  }

  function openIntents(since: number): [string, Intent][] {
    for (const [id, intent] of intents) {
      if (intent.pending === 0 && intent.doneAt <= since) intents.delete(id);
    }
    return [...intents];
  }

  function withIntents(tracks: readonly Track[], ids: ReadonlySet<string>, since: number): { tracks: Track[]; ids: Set<string> } {
    let merged = [...tracks];
    const mergedIds = new Set(ids);
    for (const [id, intent] of openIntents(since)) {
      if (intent.liked) {
        mergedIds.add(id);
        if (intent.track && !merged.some((t) => t.id === id)) merged.unshift(intent.track);
      } else {
        mergedIds.delete(id);
        merged = merged.filter((t) => t.id !== id);
      }
    }
    return { tracks: merged, ids: mergedIds };
  }

  async function write(id: string, liked: boolean, track: Track | undefined, send: () => Promise<void>): Promise<void> {
    actions += 1;
    const mine = actions;
    latestAction.set(id, mine);
    const intent = intentFor(id);
    intent.liked = liked;
    intent.track = track ?? intent.track;
    intent.pending += 1;
    clock += 1;
    place(id, liked, intent.track, 0);
    try {
      await queue(id, send);
      intent.confirmed = liked;
      onChange();
    } catch (error) {
      if (latestAction.get(id) === mine) {
        intent.liked = intent.confirmed;
        place(id, intent.confirmed, intent.track, intent.index);
      }
      onError(error);
      throw error;
    } finally {
      intent.pending -= 1;
      clock += 1;
      intent.doneAt = clock;
    }
  }

  async function readAll(): Promise<Track[]> {
    const all: Track[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.likedPage(LIKED_PAGE, cursor);
      all.push(...page.tracks);
      cursor = page.next ?? undefined;
    } while (cursor);
    return all;
  }

  async function read(): Promise<void> {
    const since = clock;
    const [tracks, ids] = await Promise.all([readAll(), client.likedIds()]);
    const merged = withIntents(tracks, new Set(ids), since);
    store.setState({ tracks: merged.tracks, ids: merged.ids, status: "ready" });
  }

  return {
    store,
    async load(): Promise<void> {
      store.setState({ status: "loading" });
      try {
        await read();
      } catch (error) {
        store.setState({ status: "error" });
        onError(error);
      }
    },
    async refresh(): Promise<void> {
      if (store.getState().status !== "ready") return this.load();
      store.setState({ refreshing: true });
      try {
        await read();
      } catch (error) {
        onError(error);
      } finally {
        store.setState({ refreshing: false });
      }
    },
    allTracks: readAll,
    like: (track: Track) => write(track.id, true, track, () => client.like(track)),
    unlike: (id: string) => write(id, false, undefined, () => client.unlike(id)),
    isLiked: (id: string) => store.getState().ids.has(id),
  };
}

export type Liked = ReturnType<typeof createLiked>;
