import { describe, expect, it } from "vitest";
import { isJunk, matchesWell, queryTokens, search, searchFiltered } from "./search";
import { json } from "../test/fakeFetch";
import { harness, searchFor, signal } from "../test/harness";
import { SEP, artistRun, browse, browseRow, card, run, searchResponse, shelf, songRow } from "../test/shapes";
import type { YtTrack } from "../types";

const song = (id: string, title: string, artist = "Artist", duration = "3:00") => songRow({ id, title, artists: [[artist, "UCartist"]], duration });
const track = (title: string, artist = "Artist"): YtTrack => ({
  id: "x",
  title,
  artists: [{ id: "", name: artist }],
  durationMs: 0,
  explicit: false,
});
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("query matching", () => {
  it("a rude word or a Cyrillic title is searched like any other", async () => {
    const rude = { id: "yt:a", title: "Worlds a Fuck", artists: [{ name: "Nova" }], durationMs: 1 } as unknown as YtTrack;
    expect(matchesWell(rude, queryTokens("worlds a fuck"))).toBe(true);
    const cyrillic = { ...rude, title: "Группа крови", artists: [{ name: "Кино" }] } as unknown as YtTrack;
    expect(matchesWell(cyrillic, queryTokens("группа крови"))).toBe(true);
  });

  it("three of four tokens match, two do not", () => {
    const tokens = queryTokens("alpha bravo charlie delta");
    expect(tokens).toHaveLength(4);
    expect(matchesWell(track("alpha bravo charlie"), tokens)).toBe(true);
    expect(matchesWell(track("alpha bravo"), tokens)).toBe(false);
  });

  it("stop words and stylised names normalise away", () => {
    expect(queryTokens("The Song (Official Video) feat. Someone")).toEqual(["song", "someone"]);
    expect(matchesWell(track("Ke$ha Song"), queryTokens("kesha song"))).toBe(true);
  });

  it("modified audio is junk unless the query asks for it", () => {
    expect(isJunk(track("song (slowed + reverb)"), "song slowed")).toBe(false);
    expect(isJunk(track("song (slowed + reverb)"), "song")).toBe(true);
  });
});

describe("search", () => {
  it("kind all: a non-track top result comes first, then matching songs", async () => {
    const { fake, yt } = harness();
    const artistCard = card({
      title: "Artist",
      target: browse("UCartist", "ARTIST"),
      subtitle: [run("Artist")],
    });
    fake.innertube("search", json(searchResponse(artistCard, shelf(song("vidMIXED001", "Other thing")))), searchFor());
    fake.innertube("search", json(searchResponse(shelf(song("vidSONG0001", "Artist Hit")))), searchFor("track"));
    fake.innertube("search", json(searchResponse()), searchFor("video"));
    const items = await search(yt, "artist hit", "all", signal());
    expect(items.slice(0, 2).map((item) => `${item.kind}:${item.id}`)).toEqual(["artist:UCartist", "track:vidSONG0001"]);
    fake.assertClean();
  });

  it("kind track: matching song, good video, weak song; the reaction is gone", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse()), searchFor());
    fake.innertube(
      "search",
      json(searchResponse(shelf(song("vidSTUDIO01", "Song", "Artist"), song("vidWEAK0001", "Unrelated", "Someone")))),
      searchFor("track"),
    );
    fake.innertube(
      "search",
      json(searchResponse(shelf(song("vidREACT001", "artist song (reaction)", "Channel"), song("vidOFFICIAL", "artist song (official video)", "Channel")))),
      searchFor("video"),
    );
    const items = await search(yt, "artist song", "track", signal());
    expect(ids(items)).toEqual(["vidSTUDIO01", "vidOFFICIAL", "vidWEAK0001"]);
  });

  it("10.2.1 three well-matching songs skip the videos request", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse()), searchFor());
    fake.innertube(
      "search",
      json(searchResponse(shelf(song("vidA0000001", "Song"), song("vidB0000001", "Song live"), song("vidC0000001", "Song remix")))),
      searchFor("track"),
    );
    await search(yt, "artist song", "track", signal());
    expect(fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/search")).toHaveLength(2);
    fake.assertClean();
  });

  it("a slowed video is kept only for a slowed query", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse()), searchFor());
    fake.innertube("search", json(searchResponse()), searchFor("track"));
    fake.innertube("search", json(searchResponse(shelf(song("vidSLOWED01", "song (slowed + reverb)", "Channel")))), searchFor("video"));
    expect(ids(await search(yt, "song slowed", "track", signal()))).toEqual(["vidSLOWED01"]);
    expect(ids(await search(yt, "song", "track", signal()))).toEqual([]);
  });

  it("a track without duration takes the richer copy", async () => {
    const { fake, yt } = harness();
    const bare = songRow({
      id: "vidSAME0001",
      title: "Other",
      artists: [["Artist", "UCartist"]],
    });
    fake.innertube("search", json(searchResponse(shelf(bare))), searchFor());
    fake.innertube(
      "search",
      json(
        searchResponse(
          shelf(
            songRow({
              id: "vidSAME0001",
              title: "Other",
              artists: [["Artist", "UCartist"]],
              duration: "3:20",
            }),
          ),
        ),
      ),
      searchFor("track"),
    );
    fake.innertube("search", json(searchResponse()), searchFor("video"));
    const items = await search(yt, "zzz", "all", signal());
    expect(items.find((item) => item.id === "vidSAME0001")).toMatchObject({
      durationMs: 200_000,
    });
  });

  it("rejects with the first failure only when every request failed", async () => {
    const failing = harness();
    failing.fake.innertube("search", json({}, 500));
    await expect(search(failing.yt, "q", "all", signal())).rejects.toMatchObject({ code: "http", status: 500 });

    const partial = harness();
    partial.fake.innertube("search", json({}, 500));
    partial.fake.innertube("search", json(searchResponse(shelf(song("vidONLY0001", "Q")))), searchFor("track"));
    expect(ids(await search(partial.yt, "q", "all", signal()))).toEqual(["vidONLY0001"]);
  });

  it("kind album: two requests, the filtered one with the album params, albums only", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse(shelf(song("vidX0000001", "Song")))), searchFor());
    fake.innertube(
      "search",
      json(searchResponse(shelf(browseRow("ALBUM", "MPREb_1", "Album", [run("Album"), SEP, artistRun("Artist", "UCa"), SEP, run("2020")])))),
      searchFor("album"),
    );
    const items = await search(yt, "album", "album", signal());
    expect(items).toEqual([
      expect.objectContaining({
        kind: "album",
        id: "MPREb_1",
        year: 2020,
        artists: [{ id: "UCa", name: "Artist" }],
      }),
    ]);
    expect(fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/search")).toHaveLength(2);
  });

  it("the video filter sends its params value exactly", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse()));
    await searchFiltered(yt, "q", "video", signal());
    expect(fake.calls.at(-1)!.json<{ params: string }>().params).toBe("EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D");
  });

  it("full all ordering: non-tracks first, good songs, mixed, good videos, weak", async () => {
    const { fake, yt } = harness();
    const artistCard = card({
      title: "A",
      target: browse("UC1", "ARTIST"),
      subtitle: [run("A")],
    });
    fake.innertube("search", json(searchResponse(artistCard, shelf(song("vidWEAK001", "Unrelated")))), searchFor());
    fake.innertube("search", json(searchResponse(shelf(song("vidGOOD01", "Song Good")))), searchFor("track"));
    fake.innertube("search", json(searchResponse(shelf(song("vidVID01", "Song Good")))), searchFor("video"));
    const items = await search(yt, "song good", "all", signal());
    expect(items.map((i) => i.id)).toEqual(["UC1", "vidGOOD01", "vidWEAK001", "vidVID01"]);
  });

  it("track mixed-top branch: track from mixed goes in if matches", async () => {
    const { fake, yt } = harness();
    fake.innertube("search", json(searchResponse(shelf(song("vidTOP0001", "Song Good")))), searchFor());
    fake.innertube("search", json(searchResponse()), searchFor("track"));
    fake.innertube("search", json(searchResponse()), searchFor("video"));
    const items = await search(yt, "song good", "track", signal());
    expect(ids(items)).toEqual(["vidTOP0001"]);
  });

  it("artist top-first: from unfiltered comes first", async () => {
    const { fake, yt } = harness();
    const artistCard = card({
      title: "Main",
      target: browse("UCA", "ARTIST"),
      subtitle: [run("Main")],
    });
    const otherCard = card({
      title: "Other",
      target: browse("UCB", "ARTIST"),
      subtitle: [run("Other")],
    });
    fake.innertube("search", json(searchResponse(artistCard)), searchFor());
    fake.innertube("search", json(searchResponse(otherCard)), searchFor("artist"));
    const items = await search(yt, "main", "artist", signal());
    expect(items[0]).toMatchObject({ id: "UCA", kind: "artist" });
  });

  it("playlist top-first: from unfiltered comes first", async () => {
    const { fake, yt } = harness();
    const playlistCard = card({
      title: "My",
      target: browse("PLmain", "PLAYLIST"),
      subtitle: [run("My")],
    });
    const otherCard = card({
      title: "Other",
      target: browse("PLother", "PLAYLIST"),
      subtitle: [run("Other")],
    });
    fake.innertube("search", json(searchResponse(playlistCard)), searchFor());
    fake.innertube("search", json(searchResponse(otherCard)), searchFor("playlist"));
    const items = await search(yt, "my", "playlist", signal());
    expect(items[0]).toMatchObject({ id: "PLmain", kind: "playlist" });
  });

  it("75% rounding: 4 tokens, 3 hits is good, 2 hits is not", () => {
    const tokens = queryTokens("one two three four");
    expect(tokens).toHaveLength(4);
    expect(matchesWell(track("one two three"), tokens)).toBe(true);
    expect(matchesWell(track("one two"), tokens)).toBe(false);
  });

  it("1-2 token strictness: one needs match, two needs both", () => {
    const one = queryTokens("alpha");
    const two = queryTokens("alpha bravo");
    expect(matchesWell(track("alpha beta"), one)).toBe(true);
    expect(matchesWell(track("beta gamma"), one)).toBe(false);
    expect(matchesWell(track("alpha bravo"), two)).toBe(true);
    expect(matchesWell(track("alpha"), two)).toBe(false);
  });

  it("junk categories: tutorial, lesson, cover, unboxing, review, etc.", () => {
    expect(isJunk(track("song tutorial"), "song")).toBe(true);
    expect(isJunk(track("song lesson"), "song")).toBe(true);
    expect(isJunk(track("song piano cover"), "song")).toBe(true);
    expect(isJunk(track("song dance cover"), "song")).toBe(true);
    expect(isJunk(track("song unboxing"), "song")).toBe(true);
    expect(isJunk(track("song review"), "song")).toBe(true);
    expect(isJunk(track("song podcast"), "song")).toBe(true);
    expect(isJunk(track("song 10 hours"), "song")).toBe(true);
    expect(isJunk(track("song top 10"), "song")).toBe(true);
    expect(isJunk(track("song discography"), "song")).toBe(true);
  });

  it("abort signal checked after allSettled", async () => {
    const { fake, yt } = harness();
    const ctrl = new AbortController();
    fake.innertube(
      "search",
      () => {
        ctrl.abort();
        throw new DOMException("Aborted", "AbortError");
      },
      searchFor(),
    );
    fake.innertube("search", json(searchResponse()), searchFor("track"));
    await expect(search(yt, "q", "all", ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("empty query returns empty without request", async () => {
    const { fake, yt } = harness();
    const result = await searchFiltered(yt, "   ", undefined, signal());
    expect(result).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("query capped at 200 characters", async () => {
    const { fake, yt } = harness();
    const long = "a".repeat(300);
    fake.innertube("search", json(searchResponse()));
    await searchFiltered(yt, long, undefined, signal());
    const lastCall = fake.calls.at(-1);
    expect(lastCall).toBeDefined();
    const payload = lastCall!.json<{ query: string }>();
    expect(payload.query).toHaveLength(200);
    expect(payload.query).toBe("a".repeat(200));
  });
});
