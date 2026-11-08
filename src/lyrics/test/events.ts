import type { Track } from "@/engine/types";
import type { StreamEvent } from "../types";

export const LRC_TWO = "[00:01.00]Morning light\n[00:04.50]Over the hill";
export const PLAIN_TWO = "Morning light\nOver the hill";
export const ENHANCED = "[00:01.00]<00:01.00>Morning <00:01.60>light\n[00:04.50]<00:04.50>Over <00:05.00>the <00:05.40>hill";

export const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artists: "Nova",
  coverUrl: "",
  durationMs: 200_000,
  ...extra,
});

export function found(
  provider: string,
  content = LRC_TWO,
  options: { quality?: number; syncLevel?: string; format?: string; topPriority?: boolean } = {},
): StreamEvent {
  const format = options.format ?? "lrc";
  const syncLevel = options.syncLevel ?? (format === "plain" ? "plain" : "line_level");
  return {
    type: "provider",
    provider,
    status: "found",
    syncLevel,
    candidate: {
      provider,
      syncLevel,
      quality: { total: options.quality ?? 0.8 },
      lyrics: { format, content },
      ...(options.topPriority ? { topPriority: true } : {}),
    },
  };
}

export const notFound = (provider: string): StreamEvent => ({ type: "provider", provider, status: "not_found" });
export const meta = (id: string, offsetMs = 0): StreamEvent => ({ type: "metadata", track: { id }, offsetMs });
export const done = (status?: string): StreamEvent => ({ type: "done", cached: false, ...(status ? { status } : {}) });
