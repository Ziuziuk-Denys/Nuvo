import type { StreamInfo } from "./types";

/** The shape of the stream format: codec and bit/s of the stream playing now, null for a cached file or while nothing streams. */
export function streamFormat(stream: StreamInfo | null): { codec: string; bitrate: number } | null {
  if (!stream || stream.fromCache) return null;
  return { codec: stream.codec, bitrate: stream.bitrateKbps * 1000 };
}
