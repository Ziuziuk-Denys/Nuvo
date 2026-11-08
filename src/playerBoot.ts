/** Starts the player engine and links the sound module, the compat port and the legacy bridge to it. */
import { createListeners } from "./engine/listeners";
import type { CatalogPort } from "./engine/adapters";
import type { YoutubePort } from "./engine/sources/ports";
import type { Track } from "./engine/types";
import { coverUrl } from "./data/covers/coverUrl";
import { startLibrary } from "./data/library/library";
import { trimSpan } from "./data/library/trims";

const CORE = "nuvo-core://local";
/** One bucket for media surfaces: they draw the cover small, and its data URL stays far under Chromium's URL limit. */
const ARTWORK_PX = 512;

/** Liked state straight from the daemon (`/v1/me/library/tracks`), for the tray, the Notch and reports. */
function daemonLibrary() {
  const liked = new Set<string>();
  const listeners = createListeners();
  const changed = listeners.emit;
  void (async () => {
    let cursor: string | null = null;
    do {
      const response = await fetch(`${CORE}/v1/me/library/tracks?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).catch(() => null);
      if (!response?.ok) return;
      const page = (await response.json()) as { items: Array<{ track: { id: string } }>; nextCursor: string | null };
      for (const item of page.items) liked.add(item.track.id);
      cursor = page.nextCursor;
    } while (cursor);
    changed();
  })();
  return {
    isLiked: (trackId: string) => liked.has(trackId),
    onLikedChange: listeners.subscribe,
    like: (trackId: string, track?: Track) => {
      liked.add(trackId);
      changed();
      void fetch(`${CORE}/v1/me/library/tracks/${encodeURIComponent(trackId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: track ?? null }),
      }).catch(() => undefined);
    },
    unlike: (trackId: string) => {
      liked.delete(trackId);
      changed();
      void fetch(`${CORE}/v1/me/library/tracks/${encodeURIComponent(trackId)}`, { method: "DELETE" }).catch(() => undefined);
    },
    // the same "Not this recording" as the dislike button, Undo notice included
    dislike: (track: Track) => void import("./ui/recs/notInterested").then(({ songMenuNotInterested }) => songMenuNotInterested?.(track, "exact")),
  };
}

let likes: ReturnType<typeof daemonLibrary> | null = null;

/** The liked-tracks port the engine runs with, for commands outside the engine (the like shortcut); null before boot. */
export function bootedLibrary(): ReturnType<typeof daemonLibrary> | null {
  return likes;
}

export interface PlayerBootPorts {
  youtube: YoutubePort;
  catalog: CatalogPort;
  notify(notice: { kind: "error" | "info"; text: string; detail?: string }): void;
  askForSignIn(): void;
  offerSignIn(): boolean;
  lyrics: { follow(track: Track | null): void; prefetch(track: Track): void };
}

export async function bootPlayer(ports: () => Promise<PlayerBootPorts>): Promise<void> {
  const [
    { startEngine },
    { connectSound, engineSound },
    { eqBands },
    { connectCompat },
    { albumInOrder, crossfadePolicy, seamFlags },
    { useAbLoopStore },
    { useSleepStore },
  ] = await Promise.all([
    import("./engine"),
    import("./features/sound/engineLink"),
    import("./features/sound/lib/eq"),
    import("./engine/compat"),
    import("./engine/audio/transitionPolicy"),
    import("./features/sound/useAbLoop"),
    import("./features/sound/useSleepTimer"),
  ]);
  const given = await ports();
  const library = daemonLibrary();
  likes = library;
  // the YouTube module is up once the ports exist: the library reads the daemon and the account shelf
  startLibrary();
  const booted = startEngine({
    ...given,
    library,
    covers: {
      warm: (url) => {
        const image = new Image();
        image.src = url;
        void image.decode().catch(() => undefined);
      },
      drawn: (url) => coverUrl(CORE, url, ARTWORK_PX, 1),
    },
    // The network check listens for this event once it lands.
    network: { checkSoon: (cause) => window.dispatchEvent(new CustomEvent("nuvo:network-check", { detail: cause })) },
    eqBands: eqBands(),
    transitionContext: () => {
      const view = booted.engine.getView();
      return {
        crossfadeSeconds: booted.engine.crossfadeSeconds,
        albumInOrder: albumInOrder(view),
        repeat: view.repeat,
        ...seamFlags(useAbLoopStore.getState(), useSleepStore.getState()),
        reverbCurrent: null,
        reverbNext: null,
      };
    },
  });
  booted.decks.setPolicy(crossfadePolicy);
  booted.engine.setSpans(trimSpan);
  // e2e only: the shell tests drive the player through this handle (set by the test before a reload).
  try {
    if (localStorage.getItem("nuvo.e2e") === "1") (window as unknown as { __nuvoPlayer: unknown }).__nuvoPlayer = booted;
  } catch {
    // storage blocked: no handle
  }
  const link = engineSound(booted.engine, booted.decks.soundBus, () => booted.decks.clock.positionMs());
  connectSound(link.backend, link.mirror);
  connectCompat();
  if (window.nuvoShell) {
    const { installLegacyBridge } = await import("./shell/legacyBridge");
    await installLegacyBridge(window.nuvoShell);
  }
}
