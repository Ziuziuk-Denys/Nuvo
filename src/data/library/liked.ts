import { createStore, type StoreApi } from "zustand/vanilla";
import type { Track } from "@/engine/types";
import type { LibraryClient } from "./client";

/** Liked tracks: paged list, the liked id set and optimistic like and unlike. */
export const LIKED_PAGE = 100;

export interface LikedState {
  ids: ReadonlySet<string>;
  tracks: readonly Track[];
  next: string | null;
  status: "idle" | "loading" | "ready" | "error";
  refreshing: boolean;
}

interface LikedDeps {
  client: Pick<LibraryClient, "likedPage" | "likedIds" | "like" | "unlike">;
  onError(error: unknown): void;
  onChange(): void;
}

/** What the user last asked for one id, kept while a write is in flight and until every read that began before it has landed. */
interface Intent {
  liked: boolean;
  track: Track | undefined;
  /** What the daemon holds, as far as we know: the state before the first write, then each confirmed write. */
  confirmed: boolean;
  /** Where the track sat before the first write, to put it back on a rollback. */
  index: number;
  pending: number;
  doneAt: number;
}

export function createLiked({ client, onError, onChange }: LikedDeps) {
  const store: StoreApi<LikedState> = createStore<LikedState>(() => ({ ids: new Set(), tracks: [], next: null, status: "idle", refreshing: false }));
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

  /** Intents a read that began at `since` may have missed: still in flight, or finished after it began. */
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
      // only the last press decides the end state, and that is whatever the daemon really holds
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

  async function readFirst(): Promise<void> {
    const since = clock;
    const [page, ids] = await Promise.all([client.likedPage(LIKED_PAGE), client.likedIds()]);
    const merged = withIntents(page.tracks, new Set(ids), since);
    store.setState({ tracks: merged.tracks, next: page.next, ids: merged.ids, status: "ready" });
  }

  return {
    store,
    async load(): Promise<void> {
      store.setState({ status: "loading" });
      try {
        await readFirst();
      } catch (error) {
        store.setState({ status: "error" });
        onError(error);
      }
    },
    async loadMore(): Promise<void> {
      const { next, status } = store.getState();
      if (!next || status !== "ready") return;
      const since = clock;
      const page = await client.likedPage(LIKED_PAGE, next);
      const seen = new Set(store.getState().tracks.map((t) => t.id));
      const dropped = new Set(
        openIntents(since)
          .filter(([, intent]) => !intent.liked)
          .map(([id]) => id),
      );
      const added = page.tracks.filter((t) => !seen.has(t.id) && !dropped.has(t.id));
      store.setState({ tracks: [...store.getState().tracks, ...added], next: page.next });
    },
    /** A change notice after load: reread in the background, never back to "loading". */
    async refresh(): Promise<void> {
      if (store.getState().status !== "ready") return this.load();
      store.setState({ refreshing: true });
      try {
        await readFirst();
      } catch (error) {
        onError(error);
      } finally {
        store.setState({ refreshing: false });
      }
    },
    /** Play all and shuffle: every liked track, page by page. */
    async allTracks(): Promise<Track[]> {
      const all: Track[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.likedPage(500, cursor);
        all.push(...page.tracks);
        cursor = page.next ?? undefined;
      } while (cursor);
      return all;
    },
    like: (track: Track) => write(track.id, true, track, () => client.like(track)),
    unlike: (id: string) => write(id, false, undefined, () => client.unlike(id)),
    isLiked: (id: string) => store.getState().ids.has(id),
  };
}

export type Liked = ReturnType<typeof createLiked>;
