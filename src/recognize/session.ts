import type { ListenVia, RecognizeEvent } from "@/links/core";

export type RecognizeInput = "microphone" | "system" | "file" | "link";

export interface RecognizedSong {
  title: string;
  artist: string;
  album?: string;
  released?: string;
  genre?: string;
  coverUrl?: string;
  offsetMs?: number;
  appleMusicUrl?: string;
  via: ListenVia | "system";
  input: { kind: RecognizeInput; label: string };
}

export type Session =
  | { phase: "idle" }
  | {
      phase: "listening";
      input: RecognizeInput;
      step: "capture" | "check" | "wait";
      detail?: string;
      attempt: number;
      of: number;
      voiceRemoved: boolean;
      peaks: number[];
      seconds: number;
    }
  | { phase: "found"; id: string; song: RecognizedSong }
  | { phase: "not_found"; input: RecognizeInput; more: boolean }
  | { phase: "failed"; input: RecognizeInput; code: string };

export const IDLE: Session = { phase: "idle" };

export function listening(input: RecognizeInput): Session {
  return { phase: "listening", input, step: "capture", attempt: 0, of: 0, voiceRemoved: false, peaks: [], seconds: 0 };
}

export function advance(session: Session, event: RecognizeEvent): Session {
  if (session.phase !== "listening") return session;
  if (event.type === "stage" && event.name === "fetching") return { ...session, step: "capture", detail: event.detail };
  if (event.type === "stage" && event.name === "listening") {
    return {
      ...session,
      step: "check",
      attempt: event.attempt ?? session.attempt,
      of: event.of ?? session.of,
      voiceRemoved: event.via === "side",
      peaks: event.envelope ?? session.peaks,
    };
  }
  if (event.type === "stage" && event.name === "waiting") return { ...session, step: "wait", seconds: event.seconds ?? 0 };
  if (event.type === "result" && event.track) return { phase: "found", id: event.id ?? "", song: event.track as unknown as RecognizedSong };
  if (event.type === "notFound") return { phase: "not_found", input: session.input, more: event.more === true };
  if (event.type === "error") return { phase: "failed", input: session.input, code: event.code ?? "network" };
  return session;
}

export function songFacts(song: Pick<RecognizedSong, "album" | "released" | "genre">): string {
  return [song.album, song.released, song.genre].filter(Boolean).join(" · ");
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(iso: string, now: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsed = now - Date.parse(iso);
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return format.format(0, "second");
}
