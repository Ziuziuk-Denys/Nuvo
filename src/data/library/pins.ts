import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { debouncedStorage } from "@/data/platform/debouncedStorage";
import { coreRequest } from "@/data/core/request";
import { log } from "@/data/platform/log";

export type HomePinKind = "playlist" | "album" | "artist";

export interface HomePin {
  kind: HomePinKind;
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  href: string;
  trackCount?: number;
}

interface HomePinsState {
  pins: HomePin[];
  pin: (item: HomePin) => void;
  unpin: (kind: HomePinKind, id: string) => void;
  isPinned: (kind: HomePinKind, id: string) => boolean;
  pruneOwnPlaylists: (ownPlaylistIds: string[]) => void;
}

interface Flag {
  kind: string;
  id: string;
  pinned: boolean;
  snapshot?: Partial<HomePin> | null;
}

/** Where pins lived before the daemon kept them; read once to move them, then removed. */
export const LEGACY_PINS_KEY = "nuvo_home_pins_v1";
const MAX_RAIL_PINS = 6;
const OWN_PLAYLIST_HREF = "/library/playlist";
const KINDS: HomePinKind[] = ["playlist", "album", "artist"];
const enc = encodeURIComponent;

const samePin = (kind: HomePinKind, id: string) => (pin: HomePin) => pin.kind === kind && pin.id === id;
const warn = (error: unknown) => log("warn", "pins", error instanceof Error ? error.message : String(error));

/** What a pin shows on Home rides along as the flag's snapshot. */
function putPin(pin: HomePin): Promise<unknown> {
  const { kind, id, ...snapshot } = pin;
  return coreRequest("PUT", `/v1/me/flags/${kind}/${enc(id)}`, { pinned: true, snapshot });
}

const unpinFlag = (kind: HomePinKind, id: string) => coreRequest("PUT", `/v1/me/flags/${kind}/${enc(id)}`, { pinned: false });
const saveOrder = (pins: HomePin[]) => coreRequest("POST", "/v1/me/flags/pin-order", { items: pins.map(({ kind, id }) => ({ kind, id })) });

function fromFlag(flag: Flag): HomePin[] {
  const kind = KINDS.find((known) => known === flag.kind);
  const snapshot = flag.snapshot ?? {};
  if (!flag.pinned || !kind || typeof snapshot.href !== "string") return [];
  return [{ ...snapshot, kind, id: flag.id, title: typeof snapshot.title === "string" ? snapshot.title : "", href: snapshot.href }];
}

/** The pins an older version kept in this browser, newest first. */
function legacyPins(storage: Pick<Storage, "getItem">): HomePin[] {
  try {
    const pins = (JSON.parse(storage.getItem(LEGACY_PINS_KEY) ?? "null") as { state?: { pins?: unknown } } | null)?.state?.pins;
    return Array.isArray(pins) ? (pins as HomePin[]).filter((pin) => KINDS.includes(pin?.kind) && typeof pin.id === "string") : [];
  } catch {
    return [];
  }
}

/** Pins live in the daemon's library flags, so they survive a cleared browser store; the list is newest first, with no cap. */
export const useHomePinsStore = create<HomePinsState>()((set, get) => ({
  pins: [],
  pin: (item) => {
    set((state) => ({ pins: [item, ...state.pins.filter((p) => !samePin(item.kind, item.id)(p))] }));
    // the daemon appends a new pin; the order call puts it first as the list shows it
    void putPin(item)
      .then(() => saveOrder(get().pins))
      .catch(warn);
  },
  unpin: (kind, id) => {
    set((state) => ({ pins: state.pins.filter((p) => !samePin(kind, id)(p)) }));
    void unpinFlag(kind, id).catch(warn);
  },
  isPinned: (kind, id) => get().pins.some(samePin(kind, id)),
  pruneOwnPlaylists: (ownPlaylistIds) => {
    const pins = get().pins;
    const kept = livePins(pins, ownPlaylistIds);
    if (kept.length === pins.length) return;
    set({ pins: kept });
    for (const pin of pins) if (!kept.includes(pin)) void unpinFlag(pin.kind, pin.id).catch(warn);
  },
}));

/** Reads the pins from the daemon. Pins an older version kept in this browser move there first, ahead of the rest; the old copy goes only once they are in. */
export async function loadPins(storage: Pick<Storage, "getItem" | "removeItem"> = localStorage): Promise<void> {
  const legacy = legacyPins(storage);
  if (legacy.length > 0) {
    for (const pin of legacy) await putPin(pin);
    await saveOrder(legacy);
    storage.removeItem(LEGACY_PINS_KEY);
  }
  const flags = await coreRequest<{ items: Flag[] }>("GET", "/v1/me/flags");
  useHomePinsStore.setState({ pins: flags.items.flatMap(fromFlag) });
}

/** A pinned list kept in local storage under `name`, newest first, at most `max`. */
const pinsStore = (name: string, max: number) =>
  create<HomePinsState>()(
    persist(
      (set, get) => ({
        pins: [],
        pin: (item) =>
          set((state) => ({
            pins: [item, ...state.pins.filter((p) => !samePin(item.kind, item.id)(p))].slice(0, max),
          })),
        unpin: (kind, id) => set((state) => ({ pins: state.pins.filter((p) => !samePin(kind, id)(p)) })),
        isPinned: (kind, id) => get().pins.some(samePin(kind, id)),
        pruneOwnPlaylists: (ownPlaylistIds) => {
          const pins = get().pins;
          const kept = livePins(pins, ownPlaylistIds);
          if (kept.length !== pins.length) set({ pins: kept });
        },
      }),
      {
        name,
        storage: createJSONStorage(() => debouncedStorage),
        partialize: (state) => ({ pins: state.pins }),
      },
    ),
  );

/** The playlists, albums and artists pinned to the navigation rail. */
export const useRailPinsStore = pinsStore("nuvo_rail_pins_v1", MAX_RAIL_PINS);

// Own playlists can be deleted; saved albums, artists and external playlists keep their pages.
export function livePins(pins: HomePin[], ownPlaylistIds: string[] | null): HomePin[] {
  if (!ownPlaylistIds) return pins;
  return pins.filter((pin) => pin.kind !== "playlist" || !pin.href.startsWith(OWN_PLAYLIST_HREF) || ownPlaylistIds.includes(pin.id));
}
