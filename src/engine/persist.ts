/** Preferences, the saved session and the one-time migration from the old key. */
import { clampRate, clampSemitones, clampVolume } from "./tempo";
import type { OutputDevice, QueueEntry, RepeatMode, Track } from "./types";

export const PREFS_KEY = "nuvo.player.prefs.v3";
export const SESSION_KEY = "nuvo.player.session.v3";
/** The current entry's position, written apart so progress never rewrites the whole queue. */
export const POSITION_KEY = "nuvo.player.session.v3.position";
export const MIGRATED_KEY = "nuvo.player.migrated";
export const LEGACY_KEY = "nuvo_player_session_v2";
/** Entries kept around the current one when a full session does not fit. */
export const TRIMMED_ENTRIES = 500;
export const SESSION_WRITE_INTERVAL_MS = 1000;

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Prefs {
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  rate: number;
  semitones: number;
  linked: boolean;
  keepTempo: boolean;
  reverbOn: boolean;
  reverbLevel: number;
  pauseOnDeviceLoss: boolean;
  restoreSession: boolean;
  output: OutputDevice | null;
  /** Best quality: the hi-fi YouTube format and the better of YouTube and SoundCloud. */
  bestQuality: boolean;
  crossfadeSeconds: number;
}

export const DEFAULT_PREFS: Prefs = {
  volume: 1,
  repeat: "off",
  shuffle: false,
  rate: 1,
  semitones: 0,
  linked: true,
  keepTempo: true,
  reverbOn: false,
  reverbLevel: 0.35,
  pauseOnDeviceLoss: true,
  restoreSession: true,
  output: null,
  bestQuality: false,
  crossfadeSeconds: 0,
};

export interface SavedSession {
  entries: QueueEntry[];
  index: number;
  positionMs: number;
  durationMs: number;
  context: string | null;
  listCover: string | null;
}

function parse(storage: KeyValue, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

function repairPrefs(raw: Record<string, unknown>): Prefs {
  const repeat = raw.repeat === "all" || raw.repeat === "one" ? raw.repeat : "off";
  const output = raw.output as OutputDevice | null | undefined;
  const validOutput = output && typeof output.id === "string" && typeof output.label === "string" ? { id: output.id, label: output.label } : null;
  return {
    volume: clampVolume(num(raw.volume, 1)),
    repeat,
    shuffle: bool(raw.shuffle, false),
    rate: clampRate(num(raw.rate, 1)),
    semitones: clampSemitones(num(raw.semitones, 0)),
    linked: bool(raw.linked, true),
    keepTempo: bool(raw.keepTempo, true),
    reverbOn: bool(raw.reverbOn, false),
    reverbLevel: Math.min(1, Math.max(0, num(raw.reverbLevel, 0.35))),
    pauseOnDeviceLoss: bool(raw.pauseOnDeviceLoss, true),
    restoreSession: bool(raw.restoreSession, true),
    output: validOutput,
    bestQuality: bool(raw.bestQuality, false),
    crossfadeSeconds: Math.round(Math.min(12, Math.max(0, num(raw.crossfadeSeconds, 0)))),
  };
}

export function loadPrefs(storage: KeyValue): Prefs {
  const raw = parse(storage, PREFS_KEY);
  return raw && typeof raw === "object" ? repairPrefs(raw as Record<string, unknown>) : { ...DEFAULT_PREFS };
}

export function savePrefs(storage: KeyValue, prefs: Prefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota or a blocked storage: preferences stay in memory for this run
  }
}

/** Compact snapshot: the fields the queue and the reports need. */
function compact(track: Track): Track {
  const { playCount: _playCount, releaseDate: _releaseDate, ...rest } = track;
  return rest;
}

function isTrack(value: unknown): value is Track {
  const t = value as Track;
  return Boolean(t) && typeof t.id === "string" && typeof t.title === "string";
}

function normaliseTrack(value: Track): Track {
  return {
    ...value,
    artists: typeof value.artists === "string" ? value.artists : "",
    coverUrl: typeof value.coverUrl === "string" ? value.coverUrl : "",
    durationMs: num(value.durationMs, 0),
  };
}

export function loadSession(storage: KeyValue): SavedSession | null {
  const raw = parse(storage, SESSION_KEY) as SavedSession | null;
  if (!raw || !Array.isArray(raw.entries)) return null;
  const entries = raw.entries.filter((e) => e && typeof e.entryId === "string" && isTrack(e.track)).map((e) => ({ ...e, track: normaliseTrack(e.track) }));
  if (entries.length === 0) return null;
  const index = Math.min(Math.max(0, num(raw.index, 0)), entries.length - 1);
  const saved = parse(storage, POSITION_KEY) as Partial<SavedPosition> | null;
  const position = saved?.entryId === entries[index].entryId ? saved : raw;
  return {
    entries,
    index,
    positionMs: Math.max(0, num(position.positionMs, 0)),
    durationMs: Math.max(0, num(position.durationMs, 0)),
    context: typeof raw.context === "string" ? raw.context : null,
    listCover: typeof raw.listCover === "string" ? raw.listCover : null,
  };
}

export interface SavedPosition {
  entryId: string;
  positionMs: number;
  durationMs: number;
}

export function savePosition(storage: KeyValue, position: SavedPosition): void {
  try {
    storage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // the queue's own position stays
  }
}

/** Writes the session; on a quota error keeps the 500 entries around the current one and logs once. */
export function saveSession(storage: KeyValue, session: SavedSession | null, log: (message: string) => void): void {
  storage.removeItem(POSITION_KEY);
  if (!session || session.entries.length === 0) {
    storage.removeItem(SESSION_KEY);
    return;
  }
  const entries = session.entries.map((e) => ({ ...e, track: compact(e.track) }));
  try {
    storage.setItem(SESSION_KEY, JSON.stringify({ ...session, entries }));
    return;
  } catch {
    log("session too large, keeping the 500 entries around the current one");
  }
  const start = Math.max(0, Math.min(session.index - Math.floor(TRIMMED_ENTRIES / 2), entries.length - TRIMMED_ENTRIES));
  const kept = entries.slice(start, start + TRIMMED_ENTRIES);
  try {
    storage.setItem(SESSION_KEY, JSON.stringify({ ...session, entries: kept, index: session.index - start }));
  } catch {
    storage.removeItem(SESSION_KEY);
  }
}

export interface Migration {
  /** UI settings that leave the engine, handed on untouched. */
  uiSettings: Record<string, unknown>;
}

/** One-time copy of the old zustand-persist key; the old key stays for one release, marked migrated. */
export function migrateLegacy(storage: KeyValue, newId: () => string): Migration | null {
  if (storage.getItem(MIGRATED_KEY)) return null;
  const legacy = parse(storage, LEGACY_KEY) as { state?: Record<string, unknown> } | null;
  const state = legacy?.state;
  if (!state || typeof state !== "object") return null;

  const prefs = repairPrefs({
    volume: state.volume,
    repeat: state.repeat,
    shuffle: state.shuffle,
    rate: state.playbackRate,
    semitones: state.pitchSemitones,
    linked: state.isPitchLinked,
    keepTempo: state.keepSpeedAcrossTracks,
    reverbOn: state.isReverbEnabled,
    reverbLevel: state.reverbLevel,
    pauseOnDeviceLoss: state.pauseOnDeviceChange,
    restoreSession: state.defaultPlaybackContext !== "empty",
  });
  savePrefs(storage, prefs);

  const queue = Array.isArray(state.queue) ? (state.queue as unknown[]).filter(isTrack) : [];
  if (prefs.restoreSession && queue.length > 0) {
    const index = Math.min(Math.max(0, num(state.currentIndex, 0)), queue.length - 1);
    saveSession(
      storage,
      {
        entries: queue.map((track, order) => ({ entryId: newId(), track: normaliseTrack(track), origin: "list", order })),
        index,
        positionMs: Math.max(0, num(state.positionMs, 0)),
        durationMs: Math.max(0, num(state.durationMs, 0)),
        context: typeof state.playbackContext === "string" ? state.playbackContext : null,
        listCover: typeof state.playbackContextCover === "string" ? state.playbackContextCover : null,
      },
      () => undefined,
    );
  }
  storage.setItem(MIGRATED_KEY, "1");
  const uiSettings: Record<string, unknown> = {};
  for (const key of ["miniPlayerStyle", "accentVariant", "trackDoubleClickBehavior"]) {
    if (key in state) uiSettings[key] = state[key];
  }
  return { uiSettings };
}

/** At most one session write per second while it changes; `flush` writes at once. */
export class SessionWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWrite = -Infinity;

  constructor(
    private readonly write: () => void,
    private readonly now: () => number,
  ) {}

  changed(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastWrite + SESSION_WRITE_INTERVAL_MS - this.now());
    this.timer = setTimeout(() => this.flush(), wait);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastWrite = this.now();
    this.write();
  }
}
