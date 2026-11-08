/** One report per play. Pure accumulator; the outbox posts the body and keeps it until the daemon took it. */
import type { KeyValue } from "./persist";
import { toSnapshot, type TrackSnapshot } from "./snapshot";
import { isStation, splitContext, type QueueEntry, type SourceKind, type Track } from "./types";

export const SESSION_TIMEOUT_MS = 30 * 60_000;
export const STOP_FLOOR_MS = 3000;
export const SKIP_BELOW_MS = 30_000;
export const SEEK_FLAG_MS = 3000;
/** A gap longer than this between two observations while playing is not counted (machine sleep). */
export const MAX_OBSERVATION_GAP_MS = 5000;
export const OUTBOX_KEY = "nuvo.player.reports.v1";
export const OPEN_PLAY_KEY = "nuvo.player.open-play.v1";
const OUTBOX_LIMIT = 200;
const CHECKPOINT_MS = 5000;

export type EndReason = "complete" | "skip" | "next" | "seek" | "error" | "stop";

export interface PlaybackEventBody {
  listeningSessionId: string;
  trackId: string;
  trackSnapshot: TrackSnapshot;
  playedDurationMs: number;
  trackDurationMs?: number;
  completed: boolean;
  skipped: boolean;
  loopCount: number;
  hasSeekBackward: boolean;
  seekForwardMs: number;
  context?: { type: string; id?: string };
  endReason: EndReason;
  positionInSession: number;
  startedAt: number;
  tzOffsetMin: number;
  completionRate: number;
  source?: SourceKind;
  fallbackReason?: string;
}

interface Play {
  track: Track;
  context: string | null;
  startedAt: number;
  positionInSession: number;
  playedMs: number;
  last: { at: number; playing: boolean } | null;
  loops: number;
  completed: boolean;
  hasSeekBackward: boolean;
  seekForwardMs: number;
  source?: SourceKind;
  fallbackReason?: string;
}

export class PlayTracker {
  private sessionId: string | null = null;
  private lastActivity = -Infinity;
  private plays = 0;
  private play: Play | null = null;

  constructor(
    private readonly now: () => number,
    private readonly newId: () => string,
  ) {}

  get active(): boolean {
    return this.play !== null;
  }

  /** The listening session the reports carry; null before the first play. */
  get session(): string | null {
    return this.sessionId;
  }

  begin(entry: QueueEntry, context: string | null): void {
    const now = this.now();
    if (!this.sessionId || now - this.lastActivity > SESSION_TIMEOUT_MS) {
      this.sessionId = this.newId();
      this.plays = 0;
    }
    this.lastActivity = now;
    this.plays += 1;
    this.play = {
      track: entry.track,
      context: entry.origin === "continuation" ? continuationContext(context) : context,
      startedAt: now,
      positionInSession: this.plays,
      playedMs: 0,
      last: null,
      loops: 0,
      completed: false,
      hasSeekBackward: false,
      seekForwardMs: 0,
    };
  }

  /** Called with every position update and status change. */
  observe(playing: boolean): void {
    const play = this.play;
    if (!play) return;
    const now = this.now();
    if (play.last?.playing) {
      const gap = now - play.last.at;
      if (gap > 0 && gap <= MAX_OBSERVATION_GAP_MS) play.playedMs += gap;
    }
    play.last = { at: now, playing };
    this.lastActivity = now;
  }

  seek(fromMs: number, toMs: number): void {
    const play = this.play;
    if (!play) return;
    if (toMs < fromMs - SEEK_FLAG_MS) play.hasSeekBackward = true;
    if (toMs > fromMs + SEEK_FLAG_MS) play.seekForwardMs += toMs - fromMs;
  }

  /** Natural end or switch to a prepared deck. `loop` is true when repeat-one replays the same entry. */
  complete(loop = false): void {
    if (!this.play) return;
    this.play.completed = true;
    if (loop) this.play.loops += 1;
  }

  setSource(source: SourceKind, fallbackReason?: string): void {
    if (!this.play) return;
    this.play.source = source;
    this.play.fallbackReason = fallbackReason;
  }

  /** Ends the play. Returns the body to send, or null when this play is not reported. */
  end(kind: "change" | "error" | "stop"): PlaybackEventBody | null {
    const play = this.play;
    if (!play || !this.sessionId) return null;
    this.observe(false);
    this.play = null;
    return this.report(play, this.sessionId, kind);
  }

  /** The running play as a quit would report it, for when the app dies before it ends. */
  peek(): PlaybackEventBody | null {
    return this.play && this.sessionId ? this.report(this.play, this.sessionId, "stop") : null;
  }

  private report(play: Play, sessionId: string, kind: "change" | "error" | "stop"): PlaybackEventBody | null {
    const reason: EndReason = play.completed
      ? "complete"
      : kind === "error"
        ? "error"
        : kind === "stop"
          ? "stop"
          : play.playedMs < SKIP_BELOW_MS
            ? "skip"
            : "next";
    if (reason === "stop" && play.playedMs < STOP_FLOOR_MS) return null;
    const durationMs = play.track.durationMs > 0 ? play.track.durationMs : 0;
    const rate = durationMs > 0 ? Math.min(1, Math.max(0, play.playedMs / durationMs)) : play.completed ? 1 : 0;
    return {
      listeningSessionId: sessionId,
      trackId: play.track.id,
      trackSnapshot: toSnapshot(play.track),
      playedDurationMs: Math.round(play.playedMs),
      ...(durationMs > 0 ? { trackDurationMs: durationMs } : {}),
      completed: play.completed,
      skipped: !play.completed && play.playedMs < SKIP_BELOW_MS,
      loopCount: play.loops,
      hasSeekBackward: play.hasSeekBackward,
      seekForwardMs: Math.round(play.seekForwardMs),
      ...(play.context ? { context: splitContext(play.context)! } : {}),
      endReason: reason,
      positionInSession: play.positionInSession,
      startedAt: play.startedAt,
      tzOffsetMin: new Date(play.startedAt).getTimezoneOffset(),
      completionRate: Number(rate.toFixed(4)),
      ...(play.source ? { source: play.source } : {}),
      ...(play.fallbackReason ? { fallbackReason: play.fallbackReason } : {}),
    };
  }

  reset(): void {
    this.play = null;
  }
}

/** Autoplay after a list is `continue:<list>`, as the refill asks for it; a station stays a station. */
function continuationContext(context: string | null): string {
  if (isStation(context)) return context!;
  const id = context ? (context.includes(":") ? context.slice(context.indexOf(":") + 1) : context) : "queue";
  return `continue:${id}`;
}

const sameReport = (a: PlaybackEventBody, b: PlaybackEventBody): boolean =>
  a.trackId === b.trackId && a.listeningSessionId === b.listeningSessionId && a.startedAt === b.startedAt;

/**
 * A report stays in storage until the daemon took it, so a daemon that is down or busy loses no play. The running play
 * is written every few seconds, so a crash, a kill or a reload loses seconds and not the play; the daemon drops a repeat.
 */
export class ReportOutbox {
  private lastCheckpoint = -Infinity;

  constructor(
    private readonly storage: KeyValue,
    private readonly post: (body: PlaybackEventBody) => Promise<void>,
    private readonly now: () => number,
    private readonly log: (message: string, error?: unknown) => void,
  ) {}

  private read(key: string): PlaybackEventBody[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(key) ?? "[]");
      return Array.isArray(value) ? (value as PlaybackEventBody[]) : [];
    } catch {
      return [];
    }
  }

  private write(key: string, reports: PlaybackEventBody[]): void {
    try {
      if (reports.length === 0) this.storage.removeItem(key);
      else this.storage.setItem(key, JSON.stringify(reports.slice(-OUTBOX_LIMIT)));
    } catch (error) {
      this.log("play report not kept", error);
    }
  }

  checkpoint(open: PlaybackEventBody | null): void {
    if (open && this.now() - this.lastCheckpoint < CHECKPOINT_MS) return;
    this.lastCheckpoint = open ? this.now() : -Infinity;
    this.write(OPEN_PLAY_KEY, open ? [open] : []);
  }

  private async deliver(report: PlaybackEventBody): Promise<void> {
    await this.post(report);
    this.write(
      OUTBOX_KEY,
      this.read(OUTBOX_KEY).filter((kept) => !sameReport(kept, report)),
    );
  }

  /** The finished play replaces its checkpoint. */
  send(report: PlaybackEventBody): Promise<void> {
    this.write(OUTBOX_KEY, [...this.read(OUTBOX_KEY), report]);
    this.checkpoint(null);
    return this.deliver(report).catch((error: unknown) => this.log("play report failed", error));
  }

  /** On start: what the last run did not get to deliver, the play it died in included. */
  async flush(): Promise<void> {
    const left = [...this.read(OUTBOX_KEY), ...this.read(OPEN_PLAY_KEY)];
    this.write(OUTBOX_KEY, left);
    this.write(OPEN_PLAY_KEY, []);
    for (const report of left) await this.deliver(report).catch((error: unknown) => this.log("play report failed", error));
  }
}
