import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/engine/types";
import { deleteUserLyrics, editableLyrics, putUserLyrics } from "./stream";

const TRACK: Track = { id: "t", title: "Song", artists: "A", coverUrl: "", durationMs: 200_000 };
const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
const found = (provider: string, format: string, content: string, topPriority = false) => ({
  type: "provider",
  provider,
  status: "found",
  candidate: {
    provider,
    syncLevel: format === "lrc" ? "line_level" : "plain",
    quality: { total: 0.5 },
    lyrics: { format, content },
    ...(topPriority ? { topPriority } : {}),
  },
});

describe("user lyrics client", () => {
  it("writes and drops the user's text on the track's route", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await putUserLyrics(fetcher, "a/b", { format: "plain", content: "line" });
    expect(fetcher).toHaveBeenCalledWith(
      "nuvo-core://local/v1/tracks/a%2Fb/lyrics/user",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ format: "plain", content: "line" }) }),
    );
    await deleteUserLyrics(fetcher, "a/b");
    expect(fetcher).toHaveBeenLastCalledWith("nuvo-core://local/v1/tracks/a%2Fb/lyrics/user", { method: "DELETE" });
  });

  it("a refused save throws", async () => {
    await expect(putUserLyrics(async () => new Response("{}", { status: 400 }), "t", { format: "lrc", content: "x" })).rejects.toThrow();
  });

  it("the editor starts from the user's text, else synced, else plain", async () => {
    const body = sse({ type: "metadata", track: { id: "t" } }, found("lrclib", "plain", "plain"), found("user", "lrc", "[00:01.00] mine", true), {
      type: "done",
      cached: false,
    });
    const fetcher = async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    expect(await editableLyrics(fetcher, TRACK, new AbortController().signal)).toEqual({ format: "lrc", content: "[00:01.00] mine" });
    const none = async () =>
      new Response(sse({ type: "metadata", track: { id: "t" } }, { type: "done", cached: false }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    expect(await editableLyrics(none, TRACK, new AbortController().signal)).toBeNull();
  });
});
