import { firstArtist, spacedShuffle, WRAP_SHARE, type Random } from "./shuffle";
import type { Origin, QueueEntry, RankReason, RepeatMode, Track } from "./types";

export interface QueueState {
  entries: QueueEntry[];
  index: number;
}

export type NewId = () => string;

export const EMPTY_QUEUE: QueueState = { entries: [], index: -1 };

const artistKey = (entry: QueueEntry) => firstArtist(entry.track.artists);

function entry(track: Track, origin: Origin, order: number, newId: NewId): QueueEntry {
  return { entryId: newId(), track, origin, order };
}

export function current(state: QueueState): QueueEntry | null {
  return state.entries[state.index] ?? null;
}

function shuffled(entries: QueueEntry[], before: QueueEntry[], random: Random, avoidEarly?: ReadonlySet<unknown>): QueueEntry[] {
  return spacedShuffle(entries, artistKey, random, { recentArtists: before.slice(-2).map(artistKey), avoidEarly });
}

export function fromList(tracks: Track[], startAt: number, shuffle: boolean, random: Random, newId: NewId): QueueState {
  if (tracks.length === 0) return EMPTY_QUEUE;
  const index = Math.min(Math.max(0, startAt), tracks.length - 1);
  const entries = tracks.map((track, order) => entry(track, "list", order, newId));
  if (!shuffle || entries.length < 2) return { entries, index };
  const head = entries.slice(0, index + 1);
  return { entries: [...head, ...shuffled(entries.slice(index + 1), head, random)], index };
}

export function fromListShuffled(tracks: Track[], startAt: number | undefined, random: Random, newId: NewId): QueueState {
  if (tracks.length === 0) return EMPTY_QUEUE;
  const entries = tracks.map((track, order) => entry(track, "list", order, newId));
  const valid = startAt !== undefined && startAt >= 0 && startAt < entries.length;
  const first = valid ? startAt : Math.floor(random() * entries.length);
  const rest = entries.filter((_, i) => i !== first);
  return { entries: [entries[first], ...shuffled(rest, [entries[first]], random)], index: 0 };
}

function orderAfterCurrent(state: QueueState): number {
  const here = current(state);
  if (!here) return maxOrder(state) + 1;
  const larger = state.entries.map((e) => e.order).filter((order) => order > here.order);
  const bound = larger.length > 0 ? Math.min(...larger) : here.order + 1;
  return (here.order + bound) / 2;
}

function maxOrder(state: QueueState): number {
  return state.entries.reduce((max, e) => Math.max(max, e.order), -1);
}

export function insertNext(state: QueueState, track: Track, newId: NewId): QueueState {
  if (state.index < 0) return { entries: [entry(track, "list", 0, newId)], index: 0 };
  const added = entry(track, "next", orderAfterCurrent(state), newId);
  const entries = [...state.entries];
  entries.splice(state.index + 1, 0, added);
  return { entries, index: state.index };
}

export function append(state: QueueState, track: Track, newId: NewId): QueueState {
  const added = entry(track, "queued", maxOrder(state) + 1, newId);
  return { entries: [...state.entries, added], index: state.index < 0 ? 0 : state.index };
}

export function appendBatch(
  state: QueueState,
  tracks: Track[],
  shuffle: boolean,
  random: Random,
  newId: NewId,
  reasons?: ReadonlyMap<string, RankReason>,
): QueueState {
  const known = new Set(state.entries.map((e) => e.track.id));
  const fresh: QueueEntry[] = [];
  let order = maxOrder(state);
  for (const track of tracks) {
    if (known.has(track.id)) continue;
    known.add(track.id);
    const added = entry(track, "continuation", ++order, newId);
    const reason = reasons?.get(track.id);
    fresh.push(reason ? { ...added, reason } : added);
  }
  if (fresh.length === 0) return state;
  const ordered = shuffle ? shuffled(fresh, state.entries, random) : fresh;
  return { entries: [...state.entries, ...ordered], index: state.index < 0 ? 0 : state.index };
}

export function remove(state: QueueState, entryId: string): QueueState | null {
  const at = state.entries.findIndex((e) => e.entryId === entryId);
  if (at < 0 || at === state.index) return null;
  const entries = state.entries.filter((_, i) => i !== at);
  return { entries, index: at < state.index ? state.index - 1 : state.index };
}

export function restore(state: QueueState, removed: QueueEntry, index: number): QueueState {
  if (state.entries.some((e) => e.entryId === removed.entryId)) return state;
  const at = Math.min(Math.max(0, index), state.entries.length);
  const entries = [...state.entries];
  entries.splice(at, 0, removed);
  const shifted = state.index >= 0 && at <= state.index ? state.index + 1 : state.index;
  return { entries, index: state.index < 0 ? 0 : shifted };
}

export function move(state: QueueState, entryId: string, target: number): QueueState | null {
  const from = state.entries.findIndex((e) => e.entryId === entryId);
  if (from < 0 || target < 0 || target >= state.entries.length || target === from) return null;
  const playing = current(state);
  const entries = [...state.entries];
  const [moved] = entries.splice(from, 1);
  entries.splice(target, 0, moved);
  return { entries, index: playing ? entries.indexOf(playing) : state.index };
}

export function trimToCurrent(state: QueueState): QueueState {
  const here = current(state);
  return here ? { entries: [here], index: 0 } : EMPTY_QUEUE;
}

export function shuffleUpcoming(state: QueueState, random: Random): QueueState {
  const head = state.entries.slice(0, state.index + 1);
  return { entries: [...head, ...shuffled(state.entries.slice(state.index + 1), head, random)], index: state.index };
}

export function unshuffleUpcoming(state: QueueState): QueueState {
  const head = state.entries.slice(0, state.index + 1);
  const upcoming = [...state.entries.slice(state.index + 1)].sort((a, b) => a.order - b.order);
  return { entries: [...head, ...upcoming], index: state.index };
}

export function reshuffleForWrap(state: QueueState, random: Random): QueueState {
  const tailSize = Math.ceil(state.entries.length * WRAP_SHARE);
  const avoid = new Set(state.entries.slice(state.entries.length - tailSize));
  return { entries: shuffled(state.entries, [], random, avoid), index: 0 };
}

export type NextStep = { kind: "index"; index: number } | { kind: "wrap" } | { kind: "more" } | { kind: "none" };

export function nextStep(state: QueueState, repeat: RepeatMode, station: boolean, natural: boolean): NextStep {
  if (state.index < 0) return { kind: "none" };
  if (natural && repeat === "one") return { kind: "index", index: state.index };
  if (state.index + 1 < state.entries.length) return { kind: "index", index: state.index + 1 };
  if (station) return { kind: "more" };
  if (repeat === "all" || (repeat === "one" && !natural)) return { kind: "wrap" };
  return { kind: "more" };
}

export function candidateAfter(state: QueueState, repeat: RepeatMode, station: boolean): QueueEntry | null {
  const step = nextStep(state, repeat, station, true);
  if (step.kind === "index") return state.entries[step.index] ?? null;
  if (step.kind === "wrap") return state.entries[0] ?? null;
  return null;
}

export class PlayHistory {
  private ids: string[] = [];
  private at = -1;

  started(entryId: string): void {
    if (this.ids[this.at] === entryId) return;
    this.ids = this.ids.slice(0, this.at + 1);
    this.ids.push(entryId);
    this.at = this.ids.length - 1;
  }

  back(state: QueueState): number | null {
    for (let i = this.at - 1; i >= 0; i--) {
      const index = state.entries.findIndex((e) => e.entryId === this.ids[i]);
      if (index >= 0) {
        this.at = i;
        return index;
      }
    }
    return null;
  }

  clear(): void {
    this.ids = [];
    this.at = -1;
  }
}

export const PREVIOUS_RESTART_MS = 3000;

export type PreviousStep = { kind: "restart" } | { kind: "index"; index: number };

export function previousStep(state: QueueState, history: PlayHistory, positionMs: number, repeat: RepeatMode, station: boolean): PreviousStep | null {
  if (state.index < 0) return null;
  if (positionMs > PREVIOUS_RESTART_MS) return { kind: "restart" };
  const fromHistory = history.back(state);
  if (fromHistory !== null) return { kind: "index", index: fromHistory };
  if (state.index > 0) return { kind: "index", index: state.index - 1 };
  if (repeat === "all" && !station && state.entries.length > 1) return { kind: "index", index: state.entries.length - 1 };
  return { kind: "restart" };
}

export function upcoming(state: QueueState): QueueEntry[] {
  return state.entries.slice(state.index + 1);
}
