/** Audio format choice and what the source reports. Pure. */

export interface AudioFormat {
  itag: number;
  mimeType: string;
  url?: string;
  signatureCipher?: string;
  bitrate?: number;
  averageBitrate?: number;
  contentLength?: string;
  approxDurationMs?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  loudnessDb?: number;
  isDrc?: boolean;
  xtags?: string;
  audioTrack?: { id?: string; displayName?: string; audioIsDefault?: boolean };
}

export type Quality = "normal" | "hifi";
export type CodecPreference = "opus" | "aac";

export interface FormatChoice {
  quality: Quality;
  codec?: CodecPreference;
  allowDrc?: boolean;
}

export function audioFormats(streamingData: unknown): AudioFormat[] {
  const list = (streamingData as { adaptiveFormats?: unknown } | undefined)?.adaptiveFormats;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (format): format is AudioFormat => typeof format?.itag === "number" && typeof format?.mimeType === "string" && format.mimeType.startsWith("audio/"),
  );
}

const isDrc = (format: AudioFormat) => format.isDrc === true || /(^|:)drc=1\b/.test(format.xtags ?? "");
const isOpus = (format: AudioFormat) => /opus|webm/.test(format.mimeType);
const average = (format: AudioFormat) => format.averageBitrate ?? format.bitrate ?? 0;

const ORDER_OPUS = [251, 140, 250, 249, 139];
const ORDER_AAC = [140, 139, 251, 250, 249];

export function chooseFormat(formats: AudioFormat[], choice: FormatChoice): AudioFormat | undefined {
  const plain = formats.filter((format) => !isDrc(format));
  // A DRC-only upload still plays: music never stops for a format preference.
  let pool = choice.allowDrc || plain.length === 0 ? formats : plain;
  if (pool.some((format) => format.audioTrack)) {
    const defaults = pool.filter((format) => !format.audioTrack || format.audioTrack.audioIsDefault);
    if (defaults.length > 0) pool = defaults;
  }
  if (pool.length === 0) return undefined;
  if (choice.quality === "hifi") {
    return pool.reduce((best, format) => {
      const difference = average(format) - average(best);
      return difference > 0 || (difference === 0 && isOpus(format) && !isOpus(best)) ? format : best;
    });
  }
  for (const itag of choice.codec === "aac" ? ORDER_AAC : ORDER_OPUS) {
    const match = pool.find((format) => format.itag === itag);
    if (match) return match;
  }
  return pool.reduce((best, format) => ((format.bitrate ?? 0) > (best.bitrate ?? 0) ? format : best));
}

export interface ReportedFormat {
  mimeType: string;
  codec: CodecPreference;
  bitrate: number;
  sampleRate?: number;
  channels?: number;
  sizeBytes?: number;
  loudnessDb?: number;
  itag: number;
}

export function report(format: AudioFormat): ReportedFormat {
  const size = Number(format.contentLength);
  const rate = Number(format.audioSampleRate);
  return {
    mimeType: format.mimeType.split(";")[0].trim() || "audio/webm",
    codec: isOpus(format) ? "opus" : "aac",
    bitrate: format.averageBitrate ?? format.bitrate ?? 160_000,
    sampleRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
    channels: format.audioChannels,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined,
    loudnessDb: format.loudnessDb,
    itag: format.itag,
  };
}

/** `expire` (Unix seconds) as Unix milliseconds, or null. */
export function validUntilMs(url: string): number | null {
  try {
    const expire = Number(new URL(url).searchParams.get("expire"));
    return Number.isFinite(expire) && expire > 0 ? expire * 1000 : null;
  } catch {
    return null;
  }
}
