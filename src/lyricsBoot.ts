/** Builds the app's lyrics engine and links it to the player engine. */
import { player } from "./engine";
import { FRAME_MS, LyricsEngine, lyrics, migrateLegacyLyrics, putOffset, putOffsets, readLyricsStream, setLyrics, streamUrl } from "./lyrics";

/** Before the player boots: the player takes this engine as its lyrics port. */
export function bootLyrics(): LyricsEngine {
  const engine = new LyricsEngine({
    stream: (track, signal) => readLyricsStream((input, init) => fetch(input, init), streamUrl(track), signal),
    saveOffset: (trackId, offsetMs) => putOffset((input, init) => fetch(input, init), trackId, offsetMs),
    requestFrame: (callback) => window.setTimeout(callback, FRAME_MS),
    cancelFrame: (id) => window.clearTimeout(id),
    now: () => performance.now(),
  });
  setLyrics(engine);
  // e2e only, like the player's handle: the shell tests read the lyrics state through it
  try {
    if (localStorage.getItem("nuvo.e2e") === "1") (window as unknown as { __nuvoLyrics: unknown }).__nuvoLyrics = engine;
  } catch {
    // storage blocked: no handle
  }
  return engine;
}

/** After the player boots: position, play state, tempo and seeks come from the player engine. */
export function linkLyricsToPlayer(): void {
  lyrics().connectAudio({
    // the engine's live position: a paused restore holds no deck yet, and the deck clock would read 0
    positionMs: () => player().livePositionMs(),
    playing: () => player().getView().status === "playing",
    rate: () => player().getView().tempo.rate,
    audioTime: () => player().audioTime(),
    subscribe: (listener) => player().subscribe(listener),
  });
  // the legacy offsets need the daemon; a refusal leaves them for the next start
  void migrateLegacyLyrics(localStorage, (offsets) => putOffsets((input, init) => fetch(input, init), offsets));
}
