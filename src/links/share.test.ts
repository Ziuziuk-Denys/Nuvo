// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LINK_BUDGET,
  SHARE_PREFIX,
  buildShareLink,
  catalogTrackOf,
  shareImportRows,
  shareMessage,
  songLine,
  sourceUrl,
  textList,
  toShareTrack,
  youtubeListUrl,
  type ShareItem,
} from "./share";
import { decodeShare, type Share } from "./shareCodec";
import { randomShare, seeded } from "./shareFixtures";

function itemsOf(share: Share): ShareItem[] {
  return share.tracks.map((track, index) => ({
    id: track.source === "youtube" ? (track.id as string) : track.source === "soundcloud" ? `sc:${track.id}` : `local:${index}`,
    title: track.title ?? "",
    artist: track.artist ?? "",
    durationMs: (track.durationSec ?? 0) * 1000,
  }));
}

async function decodedLink(link: string): Promise<Share> {
  return decodeShare(link.slice(SHARE_PREFIX.length));
}

describe("lean links keep names for ids that cannot be packed", () => {
  it("sends such songs as text with their names", async () => {
    const built = await buildShareLink(
      "Mixed",
      [
        { id: "dQw4w9WgXcR", title: "Odd id", artist: "A", durationMs: 1000 },
        { id: "sc:9007199254740993", title: "Big id", artist: "B" },
        { id: "dQw4w9WgXcQ", title: "Fine", artist: "C" },
      ],
      0,
    );
    expect(built?.density).toBe("lean");
    const decoded = await decodedLink(built?.link as string);
    expect(decoded.tracks).toEqual([
      { source: "text", artist: "A", title: "Odd id", durationSec: 1 },
      { source: "text", artist: "B", title: "Big id" },
      { source: "youtube", id: "dQw4w9WgXcQ" },
    ]);
  });
});

describe("what goes into a link", () => {
  it("maps ids to sources and leaves out songs with nothing to match by", () => {
    expect(
      toShareTrack({
        id: "dQw4w9WgXcQ",
        title: "T",
        artist: "A",
        durationMs: 213_400,
      }),
    ).toEqual({
      source: "youtube",
      id: "dQw4w9WgXcQ",
      artist: "A",
      title: "T",
      durationSec: 213,
    });
    expect(toShareTrack({ id: "sc:123456", title: "T", artist: "A" })?.source).toBe("soundcloud");
    expect(toShareTrack({ id: "local:1", title: "Группа крови", artist: "Кино" })?.source).toBe("text");
    expect(toShareTrack({ id: "local:2", title: " \t ", artist: "Кино" })).toBeNull();
  });

  it("never carries a local path, play count or account data", async () => {
    const built = await buildShareLink("Mine", [
      {
        id: "local:/home/denys/Music/secret.flac",
        title: "Song",
        artist: "Band",
        durationMs: 200_000,
      },
      {
        id: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        artist: "Rick Astley",
      },
    ]);
    const decoded = await decodedLink(built?.link as string);
    expect(JSON.stringify(decoded)).not.toContain("/home");
    expect(decoded.tracks[0]).toEqual({
      source: "text",
      artist: "Band",
      title: "Song",
      durationSec: 200,
    });
  });

  it("counts skipped songs and refuses an empty share", async () => {
    expect(await buildShareLink("x", [{ id: "local:1", title: "", artist: "A" }])).toBeNull();
    const built = await buildShareLink("x", [
      { id: "local:1", title: "", artist: "A" },
      { id: "dQw4w9WgXcQ", title: "T", artist: "A" },
    ]);
    expect(built?.skipped).toBe(1);
    expect(built?.trackCount).toBe(1);
  });
});

describe("densities and the budget", () => {
  it("a 40-song playlist is a full link under 1,800 characters", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const built = await buildShareLink("Вечерний плейлист", itemsOf(randomShare(seeded(seed), 40, "")));
      expect(built?.density).toBe("full");
      expect(built?.link?.length).toBeLessThanOrEqual(LINK_BUDGET);
    }
  });

  it("a 200-song playlist falls back to lean and says it is over budget", async () => {
    const items = itemsOf(randomShare(seeded(3), 200, ""));
    const built = await buildShareLink("Big", items);
    expect(built).toMatchObject({
      density: "lean",
      overBudget: true,
      copyAllowed: true,
    });
    const decoded = await decodedLink(built?.link as string);
    expect(decoded.tracks.filter((track) => track.source !== "text").every((track) => track.title === undefined)).toBe(true);
    expect(decoded.tracks.filter((track) => track.source === "text").every((track) => track.title !== undefined)).toBe(true);
  });

  it("refuses copying above 60,000 characters and linking above 5,000 songs", async () => {
    const huge = await buildShareLink("Huge", itemsOf(randomShare(seeded(4), 5_000, "")));
    expect(huge).toMatchObject({ density: "lean", copyAllowed: false });
    const tooMany = await buildShareLink("Too many", itemsOf(randomShare(seeded(4), 5_001, "")));
    expect(tooMany).toMatchObject({ link: null, copyAllowed: false });
  }, 30_000);

  // Link lengths measured with this encoder and seed 2026; a link may not grow by more than 5 %
  const BASELINE = [
    { tracks: 1, lean: 79, full: 120 },
    { tracks: 10, lean: 315, full: 495 },
    { tracks: 50, lean: 1058, full: 1694 },
    { tracks: 200, lean: 3284, full: 5391 },
    { tracks: 1000, lean: 14536, full: 22743 },
  ];

  it.each(BASELINE)("$tracks songs stay within 5 % of the measured lengths", async ({ tracks, lean, full }) => {
    const items = itemsOf(randomShare(seeded(2026), tracks, ""));
    const fullLink = await buildShareLink("Вечерний плейлист", items, Number.MAX_SAFE_INTEGER);
    const leanLink = await buildShareLink("Вечерний плейлист", items, 0);
    expect(fullLink?.density).toBe("full");
    expect(leanLink?.density).toBe("lean");
    expect(fullLink?.link?.length).toBeLessThanOrEqual(Math.ceil(full * 1.05));
    expect(leanLink?.link?.length).toBeLessThanOrEqual(Math.ceil(lean * 1.05));
  });
});

describe("texts for people without Nuvo", () => {
  const song: ShareItem = {
    id: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    artist: "Rick Astley",
  };

  it("builds the three-line song message", () => {
    expect(shareMessage(songLine(song.artist, song.title), "Open in Nuvo", "nuvo://share?id=EQ", sourceUrl(song))).toBe(
      "Rick Astley - Never Gonna Give You Up\nOpen in Nuvo: nuvo://share?id=EQ\nhttps://youtu.be/dQw4w9WgXcQ",
    );
    expect(shareMessage("Кино - Группа крови", "Открыть в Nuvo", "nuvo://share?id=EQ", null).split("\n")).toHaveLength(2);
  });

  it("uses a SoundCloud permalink only when it is one", () => {
    expect(
      sourceUrl({
        id: "sc:1",
        title: "t",
        artist: "a",
        permalinkUrl: "https://soundcloud.com/a/t",
      }),
    ).toBe("https://soundcloud.com/a/t");
    expect(
      sourceUrl({
        id: "sc:1",
        title: "t",
        artist: "a",
        permalinkUrl: "javascript:alert(1)",
      }),
    ).toBeNull();
    expect(sourceUrl({ id: "local:1", title: "t", artist: "a" })).toBeNull();
  });

  it("lists the first 50 YouTube songs in order for watch_videos", () => {
    const items: ShareItem[] = Array.from({ length: 60 }, (_, i) => ({
      id: `dQw4w9WgX${String(i).padStart(2, "0")}`,
      title: "t",
      artist: "a",
    }));
    items.splice(3, 0, { id: "sc:5", title: "t", artist: "a" });
    const list = youtubeListUrl(items);
    expect(list?.total).toBe(60);
    expect(list?.url.length).toBe(646);
    expect(list?.url.startsWith("https://www.youtube.com/watch_videos?video_ids=dQw4w9WgX00,dQw4w9WgX01,dQw4w9WgX02,dQw4w9WgX03")).toBe(true);
    expect(youtubeListUrl([{ id: "sc:5", title: "t", artist: "a" }])).toBeNull();
  });

  it("numbers the text list and drops an empty artist", () => {
    expect(textList([song, { id: "local:1", title: "Intro", artist: "" }])).toBe("1. Rick Astley - Never Gonna Give You Up\n2. Intro");
  });
});

describe("import rows for the receiver", () => {
  const share: Share = {
    title: "Mix",
    tracks: [
      {
        source: "youtube",
        id: "dQw4w9WgXcQ",
        artist: "Rick Astley",
        title: "Never Gonna Give You Up",
        durationSec: 213,
      },
      { source: "soundcloud", id: "42", durationSec: 100 },
      { source: "text", artist: "Кино", title: "Группа крови" },
      { source: "youtube", id: "aaaaaaaaaaA" },
    ],
  };

  it("posts id tracks as Exact rows and text tracks as metadata rows", () => {
    const looked = new Map([
      [
        1,
        {
          id: "sc:42",
          title: "Looked up",
          artists: [{ id: "u", name: "Someone" }],
          durationMs: 99_000,
        },
      ],
    ]);
    const { rows, unreadable } = shareImportRows(share, looked);
    expect(unreadable).toBe(1);
    expect(rows).toEqual([
      {
        title: "Never Gonna Give You Up",
        artists: ["Rick Astley"],
        durationMs: 213_000,
        track: catalogTrackOf(share.tracks[0]),
      },
      {
        title: "Looked up",
        artists: ["Someone"],
        durationMs: 100_000,
        track: looked.get(1),
      },
      { title: "Группа крови", artists: ["Кино"], durationMs: undefined },
    ]);
    expect(rows[0].track?.cover?.url).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
});
