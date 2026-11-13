import { describe, expect, it } from "vitest";
import { toPlayerTrack } from "@/links/playerTrack";
import { songResult, soundCloudResult, type SearchResult } from "../../ports/search";
import recorded from "./fixtures/recorded-searches.json";
import { rankSongs } from "./rank";

// YouTube Music and SoundCloud answers recorded on 2026-11-13, first ten songs of each
interface Recorded {
  id: string;
  title: string;
  artists: Array<{ id: string; name: string }>;
  durationMs: number;
  album?: { id: string; title: string };
  preview?: boolean;
  plays?: number;
  verified?: boolean;
}

const SEARCHES = recorded as Record<string, { youtube: Recorded[]; soundcloud: Recorded[] }>;

function youtube(row: Recorded): SearchResult {
  return songResult({ ...toPlayerTrack(row), ...(row.album ? { album: row.album } : {}) });
}

function soundcloud(row: Recorded): SearchResult {
  return soundCloudResult({ track: toPlayerTrack(row), preview: row.preview === true, plays: row.plays, verified: row.verified });
}

function ranked(query: string): string[] {
  const found = SEARCHES[query];
  return rankSongs(query, [...found.youtube.map(youtube), ...found.soundcloud.map(soundcloud)]).map((result) => result.id);
}

describe("rankSongs on recorded searches", () => {
  it.each([
    ["daft punk get lucky", ["4D7u5KF7SP8", "sc:88335161", "sc:131973578"]],
    ["billie eilish bad guy", ["ZD6rXLXZOEI", "RYs-hL3fNJU", "sc:597923712"]],
    ["the weeknd blinding lights", ["J7p4bzqLvCw", "A6xjfv1hHUs", "sc:2403985545"]],
    ["linkin park numb", ["5qZQEq_C3vc", "sc:1799046727", "sc:1066092496"]],
    ["imagine dragons believer", ["Kx7B-XvmFtE", "sc:555584253", "sc:572567274"]],
    ["кино группа крови", ["xtxjm7ciwmc", "EByofhvVRco", "sc:2112676515"]],
    ["земфира искала", ["eN_YiZ4uBe8", "sc:1434480934", "g2ECOFD2Ij8"]],
    ["макс корж мотылек", ["J7C_lyRbs7k", "Hws-ud5ylhY", "sc:296280603"]],
    ["kino gruppa krovi", ["Ncfm6Fphhlo", "sc:331371017", "0RVAxf2KO3I"]],
    ["ptvabhf bcrfkf", ["eN_YiZ4uBe8", "iz6S2a94Gy4", "i5PA9DQMIPY"]],
    ["скриптонит положение", ["k7jB3lo7ogw", "sc:2124930756", "Yetd31aA1ow"]],
    ["miyagi i got love", ["YkY4X_OaF6o", "hQWVfGAYaBY", "dP1nPxTYGuo"]],
  ])("%s", (query, top) => {
    expect(ranked(query).slice(0, 3)).toEqual(top);
  });

  it("keeps one copy of a song both sources carry", () => {
    const numb = ranked("linkin park numb");
    expect(numb).toContain("5qZQEq_C3vc");
    expect(numb).not.toContain("sc:255824765");
    const love = ranked("miyagi i got love");
    expect(love).toContain("YkY4X_OaF6o");
    expect(love).not.toContain("sc:1659350931");
    expect(love).not.toContain("sc:303470054");
  });

  it("puts 30-second previews after full songs and remixes after the record", () => {
    const lucky = ranked("daft punk get lucky");
    expect(lucky.indexOf("sc:254111945")).toBeGreaterThan(lucky.indexOf("sc:88335161"));
    expect(lucky.indexOf("sc:250790590")).toBeGreaterThan(lucky.indexOf("sc:131973578"));
    const numb = ranked("linkin park numb");
    expect(numb.indexOf("sc:2196784679")).toBeGreaterThan(numb.indexOf("sc:1799046727"));
  });
});

describe("rankSongs", () => {
  const song = (id: string, title: string, artist: string, durationMs = 200_000): SearchResult =>
    songResult({ id, title, artists: artist, coverUrl: "", durationMs });

  it("matches a query typed in the wrong keyboard layout", () => {
    const songs = [song("sc:1", "Другая песня", "Кто-то"), song("sc:2", "Искала", "Земфира")];
    expect(rankSongs("ptvabhf bcrfkf", songs).map((result) => result.id)).toEqual(["sc:2", "sc:1"]);
  });

  it("matches a transliterated query", () => {
    const songs = [song("sc:1", "Пачка сигарет", "Кино"), song("sc:2", "Группа крови", "Кино")];
    expect(rankSongs("kino gruppa krovi", songs)[0].id).toBe("sc:2");
  });

  it("keeps the order while the last word is still being typed", () => {
    const full = ranked("linkin park numb").slice(0, 3);
    const found = SEARCHES["linkin park numb"];
    const typing = rankSongs("linkin park nu", [...found.youtube.map(youtube), ...found.soundcloud.map(soundcloud)]).map((result) => result.id);
    expect(typing.slice(0, 3)).toEqual(full);
  });

  it("keeps the given order between equal matches", () => {
    const songs = [song("a1", "Song", "Nova"), song("a2", "Song", "Nova", 260_000)];
    expect(rankSongs("nova song", songs).map((result) => result.id)).toEqual(["a1", "a2"]);
  });
});
