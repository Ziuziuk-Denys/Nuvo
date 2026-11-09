import { player } from "./engine";
import { FRAME_MS, LyricsEngine, lyrics, migrateLegacyLyrics, putOffset, putOffsets, readLyricsStream, setLyrics, streamUrl } from "./lyrics";

export function bootLyrics(): LyricsEngine {
  const engine = new LyricsEngine({
    stream: (track, signal) => readLyricsStream((input, init) => fetch(input, init), streamUrl(track), signal),
    saveOffset: (trackId, offsetMs) => putOffset((input, init) => fetch(input, init), trackId, offsetMs),
    requestFrame: (callback) => window.setTimeout(callback, FRAME_MS),
    cancelFrame: (id) => window.clearTimeout(id),
    now: () => performance.now(),
  });
  setLyrics(engine);
  try {
    if (localStorage.getItem("nuvo.e2e") === "1") (window as unknown as { __nuvoLyrics: unknown }).__nuvoLyrics = engine;
  } catch {}
  return engine;
}

export function linkLyricsToPlayer(): void {
  lyrics().connectAudio({
    // the engine's live position: a paused restore holds no deck yet, and the deck clock would read 0
    positionMs: () => player().livePositionMs(),
    playing: () => player().getView().status === "playing",
    rate: () => player().getView().tempo.rate,
    audioTime: () => player().audioTime(),
    subscribe: (listener) => player().subscribe(listener),
  });
  void migrateLegacyLyrics(localStorage, (offsets) => putOffsets((input, init) => fetch(input, init), offsets));
}
