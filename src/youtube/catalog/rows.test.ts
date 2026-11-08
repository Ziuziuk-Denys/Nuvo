import { describe, expect, it } from "vitest";
import { parseDuration, pickCover } from "./map";
import { mapCard, mapListRow, mapQueueRow, mapSearchResponse, mapTrackRow } from "./rows";
import { ART, SEP, artistRun, browseRow, card, channelRun, queueRow, run, searchResponse, shelf, songRow, thumb } from "../test/shapes";

describe("mapping primitives", () => {
  it("durations follow m:ss and h:mm:ss with range checks", () => {
    expect(parseDuration("3:45")).toBe(225_000);
    expect(parseDuration("1:02:03")).toBe(3_723_000);
    expect(parseDuration("0:00")).toBeUndefined();
    expect(parseDuration("3:75")).toBeUndefined();
    expect(parseDuration("1:75:00")).toBeUndefined();
    expect(parseDuration("2024")).toBeUndefined();
  });

  it("non-square thumbnails are taken as they are", () => {
    expect(pickCover([{ url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 360 }])).toEqual({
      url: "https://i.ytimg.com/vi/x/hq.jpg",
      width: 480,
      height: 360,
    });
  });
});

describe("search mapping", () => {
  it("search-mixed-card-track: a card whose target is a watch endpoint", () => {
    const fixture = searchResponse(
      card({
        title: "Song One",
        target: { watchEndpoint: { videoId: "vidAAAAAAA1" } },
        subtitle: [run("Song"), SEP, artistRun("Artist A", "UCa"), SEP, run("3:45")],
      }),
    );
    const [first] = mapSearchResponse(fixture);
    expect(first).toMatchObject({
      kind: "track",
      id: "vidAAAAAAA1",
      artists: [{ id: "UCa", name: "Artist A" }],
      durationMs: 225_000,
    });
  });

  it("a card without artist links takes the first plain subtitle part", () => {
    const item = mapCard(
      card({
        title: "Song",
        target: { watchEndpoint: { videoId: "vidAAAAAAA1" } },
        subtitle: [run("Song"), SEP, run("Some Artist"), SEP, run("2.1M plays")],
      }),
    );
    expect(item).toMatchObject({
      kind: "track",
      artists: [{ id: "unknown", name: "Some Artist" }],
    });
  });

  it("a song row gets album, duration and a 512 px square cover", () => {
    const track = mapTrackRow(
      songRow({
        id: "vidAAAAAAA1",
        title: "Song",
        artists: [["Artist", "UCa"]],
        album: ["Album", "MPREb_1"],
        duration: "3:10",
        thumbnail: thumb(ART(60), 60, 60),
      }),
    );
    expect(track?.cover?.url.endsWith("=w512-h512-l90-rj")).toBe(true);
    expect([track?.cover?.width, track?.cover?.height]).toEqual([512, 512]);
    expect(track?.album).toEqual({ id: "MPREb_1", title: "Album" });
    expect(track?.durationMs).toBe(190_000);
  });

  it("an artist row has an original-size cover", () => {
    const [item] = mapSearchResponse(
      searchResponse(shelf(browseRow("ARTIST", "UCa", "Artist", [run("Artist"), SEP, run("1M monthly audience")], thumb(ART(120), 120, 120)))),
    );
    expect(item.kind).toBe("artist");
    expect(item.kind === "artist" && item.cover?.url.endsWith("=s0")).toBe(true);
  });

  it("a video repeated in a card's contents and a shelf appears once, first position", () => {
    const row = songRow({
      id: "vidAAAAAAA1",
      title: "Song",
      artists: [["Artist", "UCa"]],
    });
    const other = songRow({
      id: "vidBBBBBBB2",
      title: "Other",
      artists: [["Artist", "UCa"]],
    });
    const items = mapSearchResponse(
      searchResponse(
        card({
          title: "Artist",
          target: {
            browseEndpoint: {
              browseId: "UCa",
              browseEndpointContextSupportedConfigs: {
                browseEndpointContextMusicConfig: {
                  pageType: "MUSIC_PAGE_TYPE_ARTIST",
                },
              },
            },
          },
          subtitle: [],
          contents: [row],
        }),
        shelf(other, row),
      ),
    );
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(["artist:UCa", "track:vidAAAAAAA1", "track:vidBBBBBBB2"]);
  });

  it("unknown renderer types are skipped without throwing", () => {
    const fixture = searchResponse(
      { somethingNewRenderer: { title: 1 } },
      {
        itemSectionRenderer: {
          contents: [{ messageRenderer: { text: runs("No results") } }],
        },
      },
      shelf({ weird: null }, songRow({ id: "vidAAAAAAA1", title: "Kept" })),
    );
    expect(() => mapSearchResponse(fixture)).not.toThrow();
    expect(mapSearchResponse(fixture).map((item) => item.id)).toEqual(["vidAAAAAAA1"]);
    expect(mapSearchResponse(null)).toEqual([]);
    expect(mapQueueRow({ playlistPanelVideoRenderer: { videoId: 5 } }, "radio")).toBeUndefined();
  });

  it("a row without links or text uses the placeholder artist", () => {
    const track = mapTrackRow(songRow({ id: "vidAAAAAAA1", title: "Song" }));
    expect(track?.artists).toEqual([{ id: "unknown", name: "Unknown artist" }]);
    expect(track?.cover).toEqual({
      url: "https://i.ytimg.com/vi/vidAAAAAAA1/hqdefault.jpg",
      width: 480,
      height: 360,
    });
  });

  it("queue rows in radio mode take the byline before the first separator", () => {
    const track = mapQueueRow(
      queueRow({
        id: "vidAAAAAAA1",
        title: "Song",
        byline: [run("Artist"), SEP, run("Album"), SEP, run("2019")],
        length: "4:00",
      }),
      "radio",
    );
    expect(track).toMatchObject({
      artists: [{ id: "", name: "Artist" }],
      durationMs: 240_000,
    });
  });

  it("queue row in details mode: user-channel as fallback artist, year extracted", () => {
    const track = mapQueueRow(
      queueRow({
        id: "vidAAAAAAA1",
        title: "Song",
        byline: [channelRun("Channel", "UCb"), SEP, run("2019")],
        length: "3:30",
      }),
      "details",
    );
    expect(track).toMatchObject({
      id: "vidAAAAAAA1",
      artists: [{ id: "UCb", name: "Channel" }],
      durationMs: 210_000,
      year: 2019,
    });
  });

  it("card with COUNT text in subtitle skips it as not an artist", () => {
    const item = mapCard(
      card({
        title: "Song",
        target: { watchEndpoint: { videoId: "vidAAAAAAA1" } },
        subtitle: [run("Song"), SEP, run("Artist Name"), SEP, run("1.5M plays")],
      }),
    );
    expect(item).toMatchObject({
      kind: "track",
      artists: [{ id: "unknown", name: "Artist Name" }],
    });
  });

  it("card with duration text in subtitle does not use it as artist", () => {
    const item = mapCard(
      card({
        title: "Song",
        target: { watchEndpoint: { videoId: "vidAAAAAAA1" } },
        subtitle: [run("Song"), SEP, run("3:45"), SEP, run("Artist")],
      }),
    );
    expect(item).toMatchObject({
      kind: "track",
      artists: [{ id: "unknown", name: "Artist" }],
    });
  });

  it("album card extracts artists and year from subtitle", () => {
    const item = mapCard(
      card({
        title: "Album Title",
        target: {
          browseEndpoint: {
            browseId: "MPREb_1",
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: {
                pageType: "MUSIC_PAGE_TYPE_ALBUM",
              },
            },
          },
        },
        subtitle: [artistRun("Artist", "UCa"), SEP, run("2024")],
      }),
    );
    expect(item).toMatchObject({
      kind: "album",
      id: "MPREb_1",
      title: "Album Title",
      artists: [{ id: "UCa", name: "Artist" }],
      year: 2024,
    });
  });

  it("playlist card extracts author from subtitle", () => {
    const item = mapCard(
      card({
        title: "Playlist",
        target: {
          browseEndpoint: {
            browseId: "PLABCDef",
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: {
                pageType: "MUSIC_PAGE_TYPE_PLAYLIST",
              },
            },
          },
        },
        subtitle: [run("Created by Author")],
      }),
    );
    expect(item).toMatchObject({
      kind: "playlist",
      id: "PLABCDef",
      author: "Created by Author",
    });
  });

  it("mapListRow extracts album with artists and year", () => {
    const item = mapListRow(browseRow("ALBUM", "MPREb_1", "Album", [artistRun("Artist", "UCa"), SEP, run("2023")], thumb(ART(60), 60, 60)));
    expect(item).toMatchObject({
      kind: "album",
      id: "MPREb_1",
      title: "Album",
      artists: [{ id: "UCa", name: "Artist" }],
      year: 2023,
    });
  });

  it("mapListRow extracts playlist with author", () => {
    const item = mapListRow(browseRow("PLAYLIST", "PLABCDef", "Playlist", [run("By Author")]));
    expect(item).toMatchObject({
      kind: "playlist",
      id: "PLABCDef",
      title: "Playlist",
      author: "By Author",
    });
  });

  it("artist cover on non-artwork host is scaled to minimum 1024x1024", () => {
    expect(
      pickCover(
        [
          {
            url: "https://example.com/artist.jpg",
            width: 226,
            height: 226,
          },
        ],
        true,
      ),
    ).toEqual({
      url: "https://example.com/artist.jpg",
      width: 1024,
      height: 1024,
    });
  });

  it("square cover on artwork host is resized to =w512-h512-l90-rj", () => {
    expect(pickCover([{ url: ART(226), width: 226, height: 226 }])).toMatchObject({
      width: 512,
      height: 512,
      url: expect.stringContaining("=w512-h512-l90-rj"),
    });
  });

  it("h:mm:ss duration is parsed from a track row", () => {
    const track = mapTrackRow(
      songRow({
        id: "vidAAAAAAA1",
        title: "Song",
        duration: "1:23:45",
      }),
    );
    expect(track?.durationMs).toBe(5025000);
  });

  it("explicit badge is detected in a row", () => {
    const track = mapTrackRow(
      songRow({
        id: "vidAAAAAAA1",
        title: "Song",
        explicit: true,
      }),
    );
    expect(track?.explicit).toBe(true);
  });

  it("userChannel (MUSIC_PAGE_TYPE_USER_CHANNEL) is accepted as artist", () => {
    const [item] = mapSearchResponse(searchResponse(shelf(browseRow("USER_CHANNEL", "UCb", "Channel", [run("Creator"), SEP, run("1M subscribers")]))));
    expect(item).toMatchObject({
      kind: "artist",
      id: "UCb",
      name: "Channel",
    });
  });

  it("Cyrillic text is preserved unchanged", () => {
    const track = mapTrackRow(
      songRow({
        id: "vidAAAAAAA1",
        title: "Русская песня",
        artists: [["Артист", "UCa"]],
      }),
    );
    expect(track?.title).toBe("Русская песня");
    expect(track?.artists[0].name).toBe("Артист");
  });

  it("RTL text is preserved unchanged", () => {
    const track = mapTrackRow(
      songRow({
        id: "vidAAAAAAA1",
        title: "שיר בעברית",
        artists: [["אמן", "UCa"]],
      }),
    );
    expect(track?.title).toBe("שיר בעברית");
    expect(track?.artists[0].name).toBe("אמן");
  });

  it("card with non-array contents does not throw", () => {
    expect(() =>
      mapSearchResponse(
        searchResponse(
          card({
            title: "Song",
            target: { watchEndpoint: { videoId: "vidAAAAAAA1" } },
            subtitle: [run("Song"), SEP, run("Artist")],
            contents: { broken: "not an array" } as any,
          }),
        ),
      ),
    ).not.toThrow();
  });
});

function runs(text: string) {
  return { runs: [{ text }] };
}
