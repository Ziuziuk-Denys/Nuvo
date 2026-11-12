import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../ports/search";
import type { Track } from "../../ports/player";
import { groupResults, isEmpty, localResults, withLocalFiles, withSoundCloud } from "./searchModel";

const hit = (kind: SearchResult["kind"], id: string): SearchResult => ({ kind, id, title: id, subtitle: "", cover: "" });
const many = (kind: SearchResult["kind"], count: number) => Array.from({ length: count }, (_, index) => hit(kind, `${kind}${index}`));

const track = (id: string, title: string, artists: string, album?: string): Track => ({
  id,
  title,
  artists,
  coverUrl: "",
  durationMs: 1000,
  playCount: 0,
  album: album ? { id: `al-${id}`, title: album } : undefined,
});

describe("groupResults", () => {
  const all = [hit("artist", "top"), ...many("song", 10), ...many("album", 7), ...many("artist", 5), ...many("playlist", 9)];

  it("caps every group under All and keeps the top result out of its group", () => {
    const groups = groupResults(all, "all");
    expect(groups.top?.id).toBe("top");
    expect(groups.songs).toHaveLength(6);
    expect(groups.albums).toHaveLength(4);
    expect(groups.artists).toHaveLength(4);
    expect(groups.artists.some((result) => result.id === "top")).toBe(false);
    expect(groups.playlists).toHaveLength(4);
  });

  it("shows one group uncapped for a filter, with no top result", () => {
    const groups = groupResults(all, "songs");
    expect(groups.top).toBeUndefined();
    expect(groups.songs).toHaveLength(10);
    expect(groups.albums).toHaveLength(0);
    expect(groupResults(all, "playlists").playlists).toHaveLength(9);
  });

  it("is empty for no results", () => {
    expect(isEmpty(groupResults([], "all"))).toBe(true);
    expect(isEmpty(groupResults(many("album", 2), "songs"))).toBe(true);
  });
});

describe("localResults", () => {
  const liked = [track("1", "Ёлка", "Звери"), track("2", "Bohemian Rhapsody", "Queen", "A Night at the Opera"), track("3", "Rain", "Мурашки")];
  const playlists = [
    { id: "p1", title: "Зелёный вечер", trackCount: 3, coverUrl: "" },
    { id: "p2", title: "Road", trackCount: 1, coverUrl: "" },
  ];

  it("matches liked songs by title and by artist, folding ё into е", () => {
    expect(localResults("елка", liked, playlists).map((result) => result.id)).toEqual(["1"]);
    expect(localResults("queen", liked, playlists).map((result) => result.id)).toEqual(["2"]);
    expect(localResults("мурашки rain", liked, playlists).map((result) => result.id)).toEqual(["3"]);
  });

  it("keeps the track on song results and links playlists to your library", () => {
    const [song] = localResults("bohemian", liked, playlists);
    expect(song.kind).toBe("song");
    expect(song.track).toBe(liked[1]);
    const [list] = localResults("зеленый", liked, playlists);
    expect(list).toMatchObject({ kind: "playlist", id: "p1", href: "/library/playlist?id=p1" });
  });

  it("returns nothing for a blank query", () => {
    expect(localResults("  ", liked, playlists)).toEqual([]);
  });
});

describe("withLocalFiles", () => {
  const song = (id: string) => ({ kind: "song" as const, id, title: id, subtitle: "", cover: "" });
  it("puts matching files first among songs, once each, and nowhere else", () => {
    const results = [song("yt"), song("local:x"), { ...song("al"), kind: "album" as const }];
    expect(withLocalFiles(results, [song("local:x")], "all").map((r) => r.id)).toEqual(["local:x", "yt", "al"]);
    expect(withLocalFiles(results, [song("local:x")], "songs").map((r) => r.id)).toEqual(["local:x", "yt", "al"]);
    expect(withLocalFiles(results, [song("local:x")], "albums")).toEqual(results);
    expect(withLocalFiles(results, [], "all")).toEqual(results);
  });

  const named = (id: string, title: string, artists: string) => ({ kind: "song" as const, id, title, subtitle: artists, cover: "" });

  it("drops the streamed copy of a song the user has as a file", () => {
    const streamed = [named("yt1", "Утро (Official Video)", "Кино"), named("yt2", "Утро", "Кино"), named("yt3", "Evening", "Kino")];
    const files = [named("local:a", "Утро", "Кино, Другой")];
    const got = withLocalFiles(streamed, files, "songs", "утро").map((r) => r.id);
    expect(got).toContain("local:a");
    expect(got).not.toContain("yt2");
    expect(got).toContain("yt3");
  });

  it("ranks songs by how well they match the query, a file first only when it ties", () => {
    const streamed = [named("yt1", "Harbor Lights", "Band"), named("yt2", "Harbor", "Band")];
    const files = [named("local:a", "Old Harbor Song", "Band"), named("local:b", "Harbor", "Other")];
    const got = withLocalFiles(streamed, files, "songs", "harbor").map((r) => r.id);
    expect(got).toEqual(["local:b", "yt2", "yt1", "local:a"]);
  });

  it("leaves a leading artist or album result where it was", () => {
    const results = [{ ...named("ar", "Band", ""), kind: "artist" as const }, named("yt1", "Band Song", "Band")];
    const got = withLocalFiles(results, [named("local:a", "Band", "Band")], "all", "band").map((r) => r.id);
    expect(got[0]).toBe("ar");
  });
});

describe("withSoundCloud", () => {
  const found = many("song", 9).map((result) => ({ ...result, id: `sc:${result.id}` }));

  it("adds a SoundCloud group capped like songs under All and whole under Songs", () => {
    expect(withSoundCloud(groupResults([], "all"), found, "all").soundcloud).toHaveLength(6);
    expect(withSoundCloud(groupResults([], "songs"), found, "songs").soundcloud).toHaveLength(9);
    expect(isEmpty(withSoundCloud(groupResults([], "all"), found, "all"))).toBe(false);
  });

  it("stays out of the album, artist and playlist views", () => {
    expect(withSoundCloud(groupResults([], "albums"), found, "albums").soundcloud).toBeUndefined();
  });
});
