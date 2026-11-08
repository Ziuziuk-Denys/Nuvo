/** Synthetic `player` answers and audio formats in the shapes the player returns. */

export const STREAM_HOST = "https://rr1---sn-test.googlevideo.com/videoplayback";

export interface FormatSpec {
  itag: number;
  mime?: string;
  bitrate?: number;
  averageBitrate?: number;
  contentLength?: string;
  url?: string | null;
  signatureCipher?: string;
  isDrc?: boolean;
  audioTrack?: { id: string; audioIsDefault: boolean };
}

const OPUS = new Set([249, 250, 251, 774]);

export function format(spec: FormatSpec): Record<string, unknown> {
  const mime = spec.mime ?? (OPUS.has(spec.itag) ? 'audio/webm; codecs="opus"' : 'audio/mp4; codecs="mp4a.40.2"');
  return {
    itag: spec.itag,
    mimeType: mime,
    bitrate: spec.bitrate ?? 160_000,
    ...(spec.averageBitrate ? { averageBitrate: spec.averageBitrate } : {}),
    contentLength: spec.contentLength ?? "4000000",
    ...(spec.url === null
      ? {}
      : {
          url: spec.url ?? `${STREAM_HOST}?itag=${spec.itag}&expire=1900000000&id=${spec.itag}${spec.isDrc ? "drc" : ""}`,
        }),
    ...(spec.signatureCipher ? { signatureCipher: spec.signatureCipher } : {}),
    ...(spec.isDrc ? { isDrc: true } : {}),
    ...(spec.audioTrack ? { audioTrack: spec.audioTrack } : {}),
  };
}

export function playerResponse(
  options: {
    status?: string;
    reason?: string;
    formats?: Record<string, unknown>[];
    extra?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    playabilityStatus: {
      status: options.status ?? "OK",
      ...(options.reason ? { reason: options.reason } : {}),
    },
    streamingData: { adaptiveFormats: options.formats ?? [] },
    ...options.extra,
  };
}

/** Body predicate for a `player` request from one client. */
export const fromClient = (name: string) => (body: Record<string, unknown>) =>
  (body.context as { client?: { clientName?: string } })?.client?.clientName === name;
