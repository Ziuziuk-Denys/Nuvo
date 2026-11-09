import type { StreamInfo } from "./types";

export function streamFormat(stream: StreamInfo | null): { codec: string; bitrate: number } | null {
  if (!stream || stream.fromCache) return null;
  return { codec: stream.codec, bitrate: stream.bitrateKbps * 1000 };
}
