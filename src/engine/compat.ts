/**
 * Player names over the engine, for callers still on the old import paths (UI ports, the karaoke
 * view, legacy screens). Shrinks as callers move to `@/engine`; deleted when the last one has moved.
 */
import { create } from "zustand";
import { clock, nextRepeat, outputs, player, soundBus } from "./index";
import { gainFromSlider, sliderFromGain } from "./tempo";
import type { SpectrumListener } from "./audio/spectrum";
import { fallbackHover, sourceLabel } from "./stateLine";
import { streamFormat } from "./streamFormat";
import { isStation, type PlayerView, type RepeatMode, type Track, type TuningState } from "./types";

/** What old callers read: a play count on every track. */
type LegacyTrack = Track & { playCount: number };

export type { RepeatMode };

/** Old callers speak the shared Track (play count always set, artist ids optional). One object per engine track keeps React identities stable. */
const legacyTracks = new WeakMap<Track, LegacyTrack>();
function toLegacy(track: Track): LegacyTrack {
  let legacy = legacyTracks.get(track);
  if (!legacy) {
    legacy = { ...track, playCount: track.playCount ?? 0 };
    legacyTracks.set(track, legacy);
  }
  return legacy;
}
function fromLegacy(track: Track): Track {
  return { ...track, artistList: track.artistList?.map((artist) => ({ id: artist.id ?? "", name: artist.name })) };
}

export type TrackDoubleClickBehavior = "play" | "queue";
const DOUBLE_CLICK_KEY = "nuvo.ui.trackDoubleClick";
const OLD_PLAYER_KEY = "nuvo_player_session_v2";

/** A UI setting that left the player: its own key, first seeded from the old player store. */
function loadDoubleClick(): TrackDoubleClickBehavior {
  try {
    const own = localStorage.getItem(DOUBLE_CLICK_KEY);
    const old = (JSON.parse(localStorage.getItem(OLD_PLAYER_KEY) ?? "null") as { state?: { trackDoubleClickBehavior?: unknown } } | null)?.state
      ?.trackDoubleClickBehavior;
    const value = own ?? old;
    return value === "queue" ? "queue" : "play";
  } catch {
    return "play";
  }
}

export interface PlayerState extends TuningState {
  currentTrack: LegacyTrack | null;
  status: PlayerView["status"];
  positionMs: number;
  durationMs: number;
  queue: LegacyTrack[];
  currentIndex: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  playbackContext: string | null;
  playbackContextCover: string | null;
  /** Index of the first continuation entry; null while the queue has none. */
  autoplayFrom: number | null;
  /** Continuation is unconditional; kept for readers. */
  autoplaySimilar: boolean;
  setAutoplaySimilar(on: boolean): void;
  bestQuality: boolean;
  /** The chosen device id, null for the system default. */
  outputChosen: string | null;
  /** The chosen device's name while it plays; null when the default plays. */
  outputLabel: string | null;
  /** Why the playing track is not heard, when Nuvo knows. */
  outputSilent: "system_muted" | "output_stopped" | null;
  /** Engine preferences under their old names. */
  pauseOnDeviceChange: boolean;
  setPauseOnDeviceChange(on: boolean): void;
  defaultPlaybackContext: "resume" | "empty";
  setDefaultPlaybackContext(value: "resume" | "empty"): void;
  /** UI state that used to live in the player store. */
  isFullscreen: boolean;
  fullscreen: boolean;
  setFullscreen(on: boolean): void;
  trackDoubleClickBehavior: TrackDoubleClickBehavior;
  setTrackDoubleClickBehavior(value: TrackDoubleClickBehavior): void;
}

type Mirrored = Omit<
  PlayerState,
  | "isFullscreen"
  | "fullscreen"
  | "setFullscreen"
  | "trackDoubleClickBehavior"
  | "setTrackDoubleClickBehavior"
  | "setAutoplaySimilar"
  | "setPauseOnDeviceChange"
  | "setDefaultPlaybackContext"
  | "pauseOnDeviceChange"
  | "defaultPlaybackContext"
>;

// The entries array only changes with the queue; progress publishes four times a second and must not remap it.
let mappedEntries: PlayerView["entries"] | null = null;
let mappedQueue: LegacyTrack[] = [];
let mappedAutoplayFrom = -1;

function fromView(view: PlayerView): Mirrored {
  if (view.entries !== mappedEntries) {
    mappedEntries = view.entries;
    mappedQueue = view.entries.map((e) => toLegacy(e.track));
    mappedAutoplayFrom = view.entries.findIndex((entry) => entry.origin === "continuation");
  }
  const autoplayFrom = mappedAutoplayFrom;
  return {
    currentTrack: view.current ? toLegacy(view.current.track) : null,
    status: view.status,
    positionMs: view.positionMs,
    durationMs: view.durationMs,
    queue: mappedQueue,
    currentIndex: view.index,
    volume: view.volume,
    repeat: view.repeat,
    shuffle: view.shuffle,
    playbackRate: view.tempo.rate,
    pitchSemitones: view.tempo.semitones,
    isPitchLinked: view.tempo.linked,
    keepSpeedAcrossTracks: view.tempo.keepAcrossTracks,
    isReverbEnabled: view.reverb.on,
    reverbLevel: view.reverb.level,
    playbackContext: view.context,
    playbackContextCover: view.listCover,
    autoplayFrom: autoplayFrom < 0 ? null : autoplayFrom,
    autoplaySimilar: true,
    bestQuality: view.bestQuality,
    outputChosen: view.output.chosen?.id ?? null,
    outputLabel: view.output.fellBack ? null : (view.output.chosen?.label ?? null),
    outputSilent: view.output.silent ?? null,
  };
}

export const usePlayerStore = create<PlayerState>((set) => ({
  ...fromView({
    status: "idle",
    pauseReason: null,
    entries: [],
    index: -1,
    current: null,
    positionMs: 0,
    durationMs: 0,
    context: null,
    listCover: null,
    continuing: false,
    repeat: "off",
    shuffle: false,
    volume: 1,
    tempo: { rate: 1, semitones: 0, linked: true, keepAcrossTracks: true },
    reverb: { on: false, level: 0.35 },
    output: { chosen: null, active: { id: "", label: "System default" }, fellBack: false },
    bestQuality: false,
    stream: null,
    fallback: null,
    notice: null,
  }),
  isFullscreen: false,
  fullscreen: false,
  setFullscreen: (on) => set({ isFullscreen: on, fullscreen: on }),
  // Continuation is unconditional.
  setAutoplaySimilar: () => undefined,
  pauseOnDeviceChange: true,
  setPauseOnDeviceChange: (on) => {
    player().setPauseOnDeviceLoss(on);
    set({ pauseOnDeviceChange: on });
  },
  defaultPlaybackContext: "resume",
  setDefaultPlaybackContext: (value) => {
    player().setRestoreSession(value === "resume");
    set({ defaultPlaybackContext: value });
  },
  trackDoubleClickBehavior: loadDoubleClick(),
  setTrackDoubleClickBehavior: (value) => {
    try {
      localStorage.setItem(DOUBLE_CLICK_KEY, value);
    } catch {
      // storage blocked: the choice lasts this session
    }
    set({ trackDoubleClickBehavior: value });
  },
}));

/** Called once after `startEngine`. */
export function connectCompat(): () => void {
  const engine = player();
  usePlayerStore.setState({ pauseOnDeviceChange: engine.pauseOnDeviceLoss, defaultPlaybackContext: engine.restoreSession ? "resume" : "empty" });
  const mirror = () => usePlayerStore.setState(fromView(engine.getView()));
  mirror();
  return engine.subscribe(mirror);
}

export function usePlayerState(): PlayerState {
  return usePlayerStore();
}

export const isRadioContext = (context: string | null | undefined) => isStation(context ?? null);
export const nextRepeatMode = (mode: RepeatMode, station = false) => nextRepeat(mode, station);
export const toVolumeGain = gainFromSlider;
export const toVolumeLevel = sliderFromGain;

export const playerEngine = {
  /** The external-store pair, over the mirrored state. */
  subscribe: (listener: () => void) => usePlayerStore.subscribe(listener),
  getSnapshot: () => usePlayerStore.getState(),
  // The decks resume their audio context when playback starts, so there is nothing to prime.
  primeUserGesture: () => undefined,
  togglePlayPause: () => player().toggle(),
  pause: () => player().pause(),
  resume: () => player().play(),
  skipNext: () => player().next(),
  skipPrevious: () => player().previous(),
  seek: (positionMs: number) => player().seekTo(positionMs),
  setVolume: (gain: number) => player().changeVolume(gain),
  setShuffle: (on: boolean) => player().setShuffle(on),
  setRepeat: (mode: RepeatMode) => player().setRepeat(mode),
  startRadioStation: (track: Track) => player().startRadio(fromLegacy(track)),
  addToQueue: (track: Track) => player().append(fromLegacy(track)),
  playNext: (track: Track) => player().insertNext(fromLegacy(track)),
  playShuffled: (tracks: Track[], context?: string | null, cover?: string | null) =>
    player().playList(tracks.map(fromLegacy), { shuffled: true, context: context ?? null, listCover: cover ?? null }),
  clearQueue: () => player().trimToCurrent(),
  playQueueIndex: (index: number) => {
    const entry = player().getView().entries[index];
    if (entry) player().playEntry(entry.entryId);
  },
  removeQueueIndex: (index: number) => {
    const entry = player().getView().entries[index];
    if (entry) player().remove(entry.entryId);
  },
  reorderQueue: (from: number, to: number) => {
    const entry = player().getView().entries[from];
    if (entry) player().move(entry.entryId, to);
  },
  /** Old call shape: track, queue, context, cover, index, preserveQueue. */
  playTrack: (legacyTrack: Track, legacyQueue?: Track[], context?: string | null, cover?: string | null, index?: number, preserveQueue?: boolean) => {
    const engine = player();
    const track = fromLegacy(legacyTrack);
    const queue = legacyQueue?.map(fromLegacy);
    const view = engine.getView();
    if (preserveQueue) {
      const at = index ?? view.entries.findIndex((e) => e.track.id === track.id);
      const entry = view.entries[at];
      if (entry && entry.track.id === track.id) return engine.playEntry(entry.entryId);
    }
    const list = queue && queue.length > 0 ? queue : [track];
    const startAt =
      index ??
      Math.max(
        0,
        list.findIndex((t) => t.id === track.id),
      );
    engine.playList(list, { startAt, context: context ?? null, listCover: cover ?? null });
  },
  setPlaybackRate: (rate: number) => player().setTempo({ rate }),
  setPitchSemitones: (semitones: number) => player().setTempo({ semitones }),
  setIsPitchLinked: (linked: boolean) => player().setTempo({ linked }),
  setKeepSpeedAcrossTracks: (on: boolean) => player().setKeepTempo(on),
  setIsReverbEnabled: (on: boolean) => player().setReverb({ on }),
  setReverbLevel: (level: number) => player().setReverb({ level }),
  setBestQuality: (on: boolean) => player().setBestQuality(on),
  setCrossfade: (seconds: number) => player().setCrossfade(seconds),
  crossfadeSeconds: () => player().crossfadeSeconds,
  resetSpeedAndPitch: () => {
    player().setTempo({ linked: true });
    player().setTempo({ rate: 1 });
  },
};

export const playerRuntime = {
  getCurrentTimeMs: () => clock().positionMs(),
  currentStreamFormat: () => streamFormat(player().getView().stream),
  keepVersion: () => player().keepVersion(),
  rejectVersion: (trackId: string) => player().rejectAlternative(trackId),
  /** The quiet line and its hover when another source stands in for the track; null otherwise. */
  currentFallback: () => {
    const fallback = player().getView().fallback;
    return fallback ? { source: sourceLabel(fallback.usedSource), restarted: fallback.restarted, hover: fallbackHover(fallback) } : null;
  },
  setSleepFade: (multiplier: number) => soundBus().setSleepLevel(multiplier),
  applyPlaybackRateAndPitch: () => undefined,
  /** Replays the current track from a position (the sign-in flow); a fresh load resolves the source again. */
  loadAndPlay: async (_track: Track, positionMs: number) => player().seekTo(positionMs, { andPlay: true }),
  // The engine's pre-cache scheduler owns preloading.
  preloadTrack: async (..._args: unknown[]) => undefined,
};

export const pitchShifter = {
  getAnalyser: () => soundBus().analyser(),
  subscribeSpectrum: (listener: SpectrumListener) => soundBus().subscribeSpectrum(listener),
  setEq: (state: Parameters<ReturnType<typeof soundBus>["shapeEq"]>[0]) => soundBus().shapeEq(state),
  setNormalizationDb: (db: number) => {
    const id = player().getView().current?.track.id;
    if (id) soundBus().setTrackGainDb(id, db);
  },
  seekWithDip: (seek: () => void) => seek(),
  needsGraph: () => false,
  isAttached: () => true,
  resumeContext: () => undefined,
};

export const playerOutputs = {
  list: () => outputs().list(),
  choose: (id: string | null) => outputs().choose(id),
  unmute: () => outputs().unmute(),
};
