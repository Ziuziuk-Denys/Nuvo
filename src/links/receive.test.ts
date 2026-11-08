// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { importShare, lookupNames, previewRows, type ImportPorts } from "./receive";
import type { Share } from "./shareCodec";
import type { CatalogTrack } from "./types";

function track(id: string, title: string): CatalogTrack {
  return {
    id,
    title,
    artists: [{ id: "", name: "Someone" }],
    durationMs: 180_000,
  };
}

const lean: Share = {
  title: "",
  tracks: [
    { source: "youtube", id: "dQw4w9WgXcQ", durationSec: 213 },
    { source: "soundcloud", id: "42" },
    { source: "text", artist: "Кино", title: "Группа крови" },
    { source: "youtube", id: "aaaaaaaaaaA" },
  ],
};

function ports(): ImportPorts & { inFlight: number; most: number } {
  const state = { inFlight: 0, most: 0 };
  const slow = async <T>(value: T) => {
    state.inFlight++;
    state.most = Math.max(state.most, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    state.inFlight--;
    return value;
  };
  return Object.assign(state, {
    youtubeTrack: vi.fn(async (id: string) => slow(id === "aaaaaaaaaaA" ? null : track(id, `Video ${id}`))),
    soundcloudTrack: vi.fn(async (id: string) => slow(track(id, `Sound ${id}`))),
    startImport: vi.fn(async () => ({
      items: [
        {
          id: "imp1",
          label: "Shared playlist",
          targetKind: "playlist",
          targetId: "p1",
          status: "running",
          total: 3,
        },
      ],
    })),
  });
}

describe("receiving a shared playlist", () => {
  it("looks up only id-only songs, four at a time, and leaves failures out", async () => {
    const fake = ports();
    const many: Share = {
      title: "",
      tracks: Array.from({ length: 10 }, (_, i) => ({
        source: "youtube" as const,
        id: `dQw4w9WgX${String(i).padStart(2, "0")}`,
      })),
    };
    const found = await lookupNames(
      many,
      many.tracks.map((_, i) => i),
      fake,
      new AbortController().signal,
    );
    expect(found.size).toBe(10);
    expect(fake.most).toBeLessThanOrEqual(4);
    const some = await lookupNames(lean, [0, 1, 2, 3], ports(), new AbortController().signal);
    expect([...some.keys()].sort()).toEqual([0, 1]);
  });

  it("previews names from the link or the lookups and marks the missing", async () => {
    const looked = await lookupNames(lean, [0, 1, 2, 3], ports(), new AbortController().signal);
    expect(previewRows(lean, looked)).toEqual([
      {
        index: 0,
        title: "Video dQw4w9WgXcQ",
        artist: "Someone",
        durationMs: 213_000,
        missing: false,
      },
      {
        index: 1,
        title: "Sound sc:42",
        artist: "Someone",
        durationMs: 180_000,
        missing: false,
      },
      {
        index: 2,
        title: "Группа крови",
        artist: "Кино",
        durationMs: undefined,
        missing: false,
      },
      { index: 3, title: "", artist: "", durationMs: undefined, missing: true },
    ]);
    expect(previewRows(lean, looked, 2)).toHaveLength(2);
  });

  it("imports through the job with the nuvo-link source and counts the unreadable", async () => {
    const fake = ports();
    const result = await importShare(lean, { kind: "new" }, "Shared playlist", fake, new AbortController().signal);
    expect(result).toMatchObject({ unreadable: 1, summary: { id: "imp1" } });
    const body = vi.mocked(fake.startImport).mock.calls[0][0];
    expect(body).toMatchObject({
      source: "nuvo-link",
      label: "Shared playlist",
      target: { kind: "new" },
    });
    expect(body.rows.map((row) => [row.title, row.track?.id])).toEqual([
      ["Video dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["Sound sc:42", "sc:42"],
      ["Группа крови", undefined],
    ]);
  });

  it("a second import while one runs joins it instead of posting twice", async () => {
    const fake = ports();
    const start = () => importShare(lean, { kind: "new" }, "Shared playlist", fake, new AbortController().signal);
    const [one, two] = await Promise.all([start(), start()]);
    expect(two).toBe(one);
    expect(fake.startImport).toHaveBeenCalledTimes(1);
    await start();
    expect(fake.startImport).toHaveBeenCalledTimes(2);
  });

  it("posts nothing when no song can be read", async () => {
    const fake = ports();
    const gone: Share = {
      title: "Gone",
      tracks: [{ source: "youtube", id: "aaaaaaaaaaA" }],
    };
    expect(await importShare(gone, { kind: "liked" }, "x", fake, new AbortController().signal)).toEqual({ summary: null, unreadable: 1 });
    expect(fake.startImport).not.toHaveBeenCalled();
  });
});
