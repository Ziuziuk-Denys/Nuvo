import { describe, expect, it } from "vitest";
import { MAX_CONTINUATIONS, Pages, isNoise, parseCount, playlistPage, radio, trackPage } from "./pages";
import { json } from "../test/fakeFetch";
import { harness, searchFor, signal } from "../test/harness";
import {
  ART,
  SEP,
  albumRun,
  artistRun,
  browsePage,
  browseRow,
  carousel,
  channelRun,
  continuationPage,
  nextResponse,
  queueRow,
  responsiveHeader,
  run,
  runs,
  searchResponse,
  shelf,
  songRow,
  thumb,
  twoRowItem,
} from "../test/shapes";

const BROWSE = "https://music.youtube.com/youtubei/v1/browse";
const byBrowseId = (id: string) => (body: Record<string, unknown>) => body.browseId === id;
const byToken = (token: string) => (body: Record<string, unknown>) => body.continuation === token;

describe("track", () => {
  it("next-selected: the selected row gives title, artist and year", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "next",
      json(
        nextResponse(
          queueRow({
            id: "vidOTHER001",
            title: "Other",
            byline: [artistRun("X", "UCx")],
          }),
          queueRow({
            id: "vidSELECTED",
            title: "Chosen",
            byline: [artistRun("Artist", "UCa"), SEP, albumRun("Album", "MPREb_1"), SEP, run("2019")],
            selected: true,
          }),
        ),
      ),
    );
    const page = await trackPage(yt, "vidSELECTED", signal());
    expect(page).toMatchObject({
      id: "vidSELECTED",
      title: "Chosen",
      artists: [{ id: "UCa", name: "Artist" }],
      year: 2019,
      album: { id: "MPREb_1" },
    });
  });

  it("falls back to a songs search, else not-found", async () => {
    const { fake, yt } = harness();
    fake.innertube("next", json({}, 500));
    fake.innertube(
      "search",
      json(
        searchResponse(
          shelf(
            songRow({
              id: "vidWANTED01",
              title: "Found",
              artists: [["A", "UCa"]],
            }),
          ),
        ),
      ),
      searchFor("track"),
    );
    expect((await trackPage(yt, "vidWANTED01", signal())).title).toBe("Found");
    await expect(trackPage(yt, "vidMISSING1", signal())).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("album", () => {
  const albumFixture = browsePage(
    responsiveHeader({
      title: "The Album",
      strapline: [artistRun("Artist", "UCa")],
      subtitle: [run("Album"), SEP, run("2021")],
      secondSubtitle: "1,024 tracks • 70 hours",
      thumbnail: thumb(ART(544), 544, 544),
    }),
    [songRow({ id: "vidTRACK001", title: "One" }), songRow({ id: "vidTRACK002", title: "Two" }), songRow({ id: "vidTRACK001", title: "One again" })],
  );

  it("album-olak then album-mpreb; the id mapping is memoised (10.2.3)", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json({ contents: { header: { link: "browse MPREb_abc here" } } }), byBrowseId("VLOLAK5uy_x"));
    fake.innertube("browse", json(albumFixture), byBrowseId("MPREb_abc"));
    const pages = new Pages(yt);
    const album = await pages.album("OLAK5uy_x", signal());
    const browses = fake.callsTo("POST", BROWSE);
    expect(browses[1].json<{ browseId: string }>().browseId).toBe("MPREb_abc");
    expect(album.tracks.map((track) => track.id)).toEqual(["vidTRACK001", "vidTRACK002"]);
    for (const track of album.tracks) {
      expect(track.album).toEqual({ id: "MPREb_abc", title: "The Album" });
      expect(track.cover).toEqual(album.cover);
      expect(track.artists).toEqual([{ id: "UCa", name: "Artist" }]);
    }
    await pages.album("OLAK5uy_x", signal());
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(3);
  });

  it("a header without artists is not-found", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(browsePage(responsiveHeader({ title: "No Artist" }), [])));
    await expect(new Pages(yt).album("MPREb_1", signal())).rejects.toMatchObject({ code: "not-found" });
  });

  it("the track count drops group commas", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(albumFixture));
    expect((await new Pages(yt).album("MPREb_1", signal())).trackCount).toBe(1024);
  });
});

describe("playlist", () => {
  it("browse ids get VL unless they already carry a known prefix", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(browsePage(responsiveHeader({ title: "List" }), [])));
    const page = await playlistPage(yt, "PLx", signal());
    expect(page.id).toBe("PLx");
    await playlistPage(yt, "VLPLx", signal());
    await playlistPage(yt, "MPREb_1", signal());
    expect(fake.callsTo("POST", BROWSE).map((call) => call.json<{ browseId: string }>().browseId)).toEqual(["VLPLx", "VLPLx", "MPREb_1"]);
  });

  it("author from a channel link, or from the first non-noise part", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "browse",
      json(
        browsePage(
          responsiveHeader({
            title: "A",
            strapline: [channelRun("Owner", "UCo")],
            subtitle: [run("Playlist"), SEP, run("2024"), SEP, run("50 songs")],
          }),
          [],
        ),
      ),
      byBrowseId("VLPL1"),
    );
    fake.innertube(
      "browse",
      json(
        browsePage(
          responsiveHeader({
            title: "B",
            subtitle: [run("Playlist"), SEP, run("Owner"), SEP, run("Chill mix")],
          }),
          [],
        ),
      ),
      byBrowseId("VLPL2"),
    );
    const linked = await playlistPage(yt, "PL1", signal());
    expect([linked.author, linked.year, linked.description]).toEqual(["Owner", 2024, undefined]);
    const plain = await playlistPage(yt, "PL2", signal());
    expect([plain.author, plain.description]).toEqual(["Owner", "Chill mix"]);
  });

  it("follows continuations in order", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "browse",
      json(browsePage(responsiveHeader({ title: "Long" }), [songRow({ id: "vidPAGE1001", title: "1" })], "tok1")),
      byBrowseId("VLPLlong"),
    );
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidPAGE2001", title: "2" }), songRow({ id: "vidPAGE2002", title: "3" })])), byToken("tok1"));
    const page = await playlistPage(yt, "PLlong", signal());
    const rest = await page.more!(signal());
    expect([...page.tracks, ...rest].map((track) => track.id)).toEqual(["vidPAGE1001", "vidPAGE2001", "vidPAGE2002"]);
  });

  it("review focus: pages that repeat the same rows with fresh tokens stop", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(browsePage(responsiveHeader({ title: "Loop" }), [songRow({ id: "vidLOOP0001", title: "1" })], "t0")), byBrowseId("VLPLloop"));
    let page = 0;
    fake.innertube(
      "browse",
      () => json(continuationPage([songRow({ id: "vidLOOP0001", title: "1" })], `t${++page}`)),
      (body) => typeof body.continuation === "string",
    );
    const loop = await playlistPage(yt, "PLloop", signal());
    expect(await loop.more!(signal())).toEqual([]);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(2);
  });

  it("a private playlist (no header, no rows) is not-found", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json({ contents: {} }));
    await expect(playlistPage(yt, "PLprivate", signal())).rejects.toMatchObject({ code: "not-found" });
  });

  it("an account playlist is served from the account when signed in", async () => {
    const { fake, yt } = harness();
    const account = {
      isAccountPlaylist: (id: string) => id === "LM",
      accountPlaylist: async (id: string) => ({
        id,
        title: "Liked",
        tracks: [],
      }),
    };
    expect((await playlistPage(yt, "LM", signal(), account)).title).toBe("Liked");
    expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
});

describe("artist", () => {
  const artistFull = (topSongsBrowse = true) => ({
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        title: runs(
                          topSongsBrowse
                            ? run("Top songs", {
                                browseId: "VLtop",
                                params: "ggMx",
                              })
                            : run("Top songs"),
                        ),
                        contents: [
                          songRow({
                            id: "vidINLINE01",
                            title: "Inline",
                            artists: [["Artist", "UCa"]],
                          }),
                        ],
                      },
                    },
                    carousel("Albums", [
                      twoRowItem({
                        title: "LP One",
                        id: "MPREb_a1",
                        subtitle: ["Album", "2019"],
                        thumbnail: thumb(ART(226), 226, 226),
                      }),
                      twoRowItem({
                        title: "LP Two",
                        id: "MPREb_a2",
                        subtitle: ["Album", "2021"],
                        explicit: true,
                      }),
                    ]),
                    carousel("Singles & EPs", [
                      twoRowItem({
                        title: "Short",
                        id: "MPREb_e1",
                        subtitle: ["EP", "2022"],
                      }),
                      twoRowItem({
                        title: "Hit",
                        id: "MPREb_s1",
                        subtitle: ["Single", "2023"],
                      }),
                    ]),
                    carousel("Fans might also like", [
                      twoRowItem({
                        title: "Friend",
                        id: "UCf",
                        pageType: "ARTIST",
                        subtitle: ["Artist"],
                      }),
                    ]),
                  ],
                },
              },
            },
          },
        ],
      },
    },
    header: {
      musicImmersiveHeaderRenderer: {
        title: runs(run("Artist")),
        monthlyListenerCount: runs(run("1.2M monthly audience")),
        thumbnail: thumb(ART(900), 900, 900),
      },
    },
  });

  it("artist-full: verified, releases typed, tracks from the top songs browse", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(artistFull()), byBrowseId("UCa"));
    fake.innertube(
      "browse",
      json(browsePage(undefined, [songRow({ id: "vidTOP00001", title: "Top 1" }), songRow({ id: "vidTOP00002", title: "Top 2" })])),
      byBrowseId("VLtop"),
    );
    const page = await new Pages(yt).artist("UCa", signal());
    expect(page.verified).toBe(true);
    expect(page.listenersText).toBe("1.2M monthly audience");
    expect(page.albums.map((album) => album.id)).toEqual(["MPREb_a1", "MPREb_a2"]);
    expect(page.albums[1].explicit).toBe(true);
    expect(page.singles.map((single) => [single.id, single.releaseKind])).toEqual([
      ["MPREb_e1", "ep"],
      ["MPREb_s1", "single"],
    ]);
    expect(page.tracks.map((track) => track.id)).toEqual(["vidTOP00001", "vidTOP00002"]);
    expect(page.tracks[0].artists).toEqual([{ id: "UCa", name: "Artist" }]);
    expect(fake.calls.at(-1)!.json<{ params: string }>().params).toBe("ggMx");
  });

  it("a failing top songs browse keeps the inline tracks", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(artistFull()), byBrowseId("UCa"));
    fake.innertube("browse", json({}, 500), byBrowseId("VLtop"));
    expect((await new Pages(yt).artist("UCa", signal())).tracks.map((track) => track.id)).toEqual(["vidINLINE01"]);
  });

  it("listener counts in Russian and with space groups", () => {
    expect(parseCount("1,2 млн слушателей за месяц")).toBe(1_200_000);
    expect(parseCount("12 345 monthly listeners")).toBe(12_345);
    expect(parseCount("12,345")).toBe(12_345);
    expect(parseCount("12.345")).toBe(12_345);
    expect(parseCount("3 thousand")).toBe(3000);
    expect(parseCount("2,5 тыс")).toBe(2500);
  });

  it("listener text found in the subtitle sets verified", async () => {
    const { fake, yt } = harness();
    const header = (subtitle: string) =>
      json({
        header: {
          musicVisualHeaderRenderer: {
            title: runs(run("Artist")),
            subtitle: runs(run(subtitle)),
          },
        },
      });
    fake.innertube("browse", header("1,2 млн слушателей за месяц"), byBrowseId("UCru"));
    fake.innertube("browse", header("12 345 monthly listeners"), byBrowseId("UCsmall"));
    const ru = await new Pages(yt).artist("UCru", signal());
    expect([ru.listenersText, ru.verified]).toEqual(["1,2 млн слушателей за месяц", true]);
    expect((await new Pages(yt).artist("UCsmall", signal())).verified).toBe(false);
  });

  it("a renamed channel is found through an artist search", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json({}, 404), byBrowseId("UCold"));
    fake.innertube("search", json(searchResponse(shelf(browseRow("ARTIST", "UCother", "Artist")))), searchFor("artist"));
    fake.innertube(
      "browse",
      json({
        header: {
          musicImmersiveHeaderRenderer: { title: runs(run("Artist")) },
        },
      }),
      byBrowseId("UCother"),
    );
    expect((await new Pages(yt).artist("UCold", signal())).id).toBe("UCother");
  });

  it("artistImage reuses the session's artist page and never throws (10.2.3)", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "browse",
      json({
        header: {
          musicImmersiveHeaderRenderer: {
            title: runs(run("Artist")),
            thumbnail: thumb(ART(900), 900, 900),
          },
        },
      }),
      byBrowseId("UCa"),
    );
    const pages = new Pages(yt);
    await pages.artist("UCa", signal());
    expect((await pages.artistImage("UCa", signal()))?.url.endsWith("=s0")).toBe(true);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(1);
    fake.innertube("browse", json({}, 500), byBrowseId("UCbroken"));
    fake.innertube("search", json({}, 500), searchFor("artist"));
    expect(await pages.artistImage("UCbroken", signal())).toBeUndefined();
  });
});

describe("radio", () => {
  const rows = (count: number, seed: string) =>
    [seed, ...Array.from({ length: count - 1 }, (_, i) => `vidRADIO${String(i).padStart(3, "0")}`)].map((id) =>
      queueRow({ id, title: id, byline: [artistRun("A", "UCa")] }),
    );

  it("limit counts new tracks; an empty RDAMVM queue retries without the playlist id", async () => {
    const { fake, yt } = harness();
    const seed = "vidSEED0001";
    fake.innertube("next", json(nextResponse(...rows(40, seed))), (body) => body.playlistId === `RDAMVM${seed}`);
    const tracks = await radio(yt, seed, { limit: 10 }, signal());
    expect(tracks).toHaveLength(10);
    expect(tracks.some((track) => track.id === seed)).toBe(false);

    const empty = harness();
    empty.fake.innertube("next", json(nextResponse()), (body) => body.playlistId === "RDAMVMvidSEED0002");
    empty.fake.innertube("next", json(nextResponse(...rows(5, "vidSEED0002"))), (body) => body.playlistId === undefined);
    expect(await radio(empty.yt, "vidSEED0002", {}, signal())).toHaveLength(4);
    expect(empty.fake.callsTo("POST", "https://music.youtube.com/youtubei/v1/next")).toHaveLength(2);
  });

  it("10.7.4 tracks already in the queue are dropped before the limit", async () => {
    const { fake, yt } = harness();
    fake.innertube("next", json(nextResponse(...rows(6, "vidSEED0003"))));
    const tracks = await radio(yt, "vidSEED0003", { limit: 3, exclude: new Set(["vidRADIO000"]) }, signal());
    expect(tracks.map((track) => track.id)).toEqual(["vidRADIO001", "vidRADIO002", "vidRADIO003"]);
  });
});

const NEXT = "https://music.youtube.com/youtubei/v1/next";
const aborted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("playlist continuations (fix round)", () => {
  const first = (token?: string, extra?: (page: any) => void) => {
    const page = browsePage(responsiveHeader({ title: "L" }), [songRow({ id: "vidFIRST001", title: "1" })], token);
    extra?.(page);
    return page;
  };

  it("more() is single-shot: repeat calls give the same result without new requests", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(first("tok1")), byBrowseId("VLPLs"));
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidSECOND01", title: "2" })])), byToken("tok1"));
    const page = await playlistPage(yt, "PLs", signal());
    const one = await page.more!(signal());
    const two = await page.more!(signal());
    expect(two.map((track) => track.id)).toEqual(["vidSECOND01"]);
    expect(two).toEqual(one);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(2);
  });

  it("an aborted more() can be retried", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(first("tok1")), byBrowseId("VLPLr"));
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidSECOND01", title: "2" })])), byToken("tok1"));
    const page = await playlistPage(yt, "PLr", signal());
    await expect(page.more!(aborted())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect((await page.more!(signal())).map((track) => track.id)).toEqual(["vidSECOND01"]);
  });

  it("a failed continuation keeps the rows and reports partial", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(first("tok1")), byBrowseId("VLPLp"));
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidSECOND01", title: "2" })], "tok2")), byToken("tok1"));
    fake.innertube("browse", json({}, 500), byToken("tok2"));
    const page = await playlistPage(yt, "PLp", signal());
    expect(page.partial).toBe(false);
    expect((await page.more!(signal())).map((track) => track.id)).toEqual(["vidSECOND01"]);
    expect(page.partial).toBe(true);
  });

  it("stops after MAX_CONTINUATIONS pages", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(first("t0")), byBrowseId("VLPLcap"));
    let count = 0;
    fake.innertube(
      "browse",
      () => {
        count += 1;
        return json(
          continuationPage(
            [
              songRow({
                id: `vidCAP${String(count).padStart(6, "0")}`,
                title: "x",
              }),
            ],
            `t${count}`,
          ),
        );
      },
      (body) => typeof body.continuation === "string",
    );
    const page = await playlistPage(yt, "PLcap", signal());
    const rest = await page.more!(signal());
    expect(rest).toHaveLength(MAX_CONTINUATIONS);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(1 + MAX_CONTINUATIONS);
  });

  it("a repeated token ends the walk after that page", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json(first("t0")), byBrowseId("VLPLsame"));
    fake.innertube("browse", json(continuationPage([songRow({ id: "vidSECOND01", title: "2" })], "t0")), byToken("t0"));
    const page = await playlistPage(yt, "PLsame", signal());
    expect(await page.more!(signal())).toHaveLength(1);
    expect(fake.callsTo("POST", BROWSE)).toHaveLength(2);
  });

  it("only the main track shelf gives tracks, suggestion shelves do not leak", async () => {
    const { fake, yt } = harness();
    const withSuggestions = first(undefined, (page) => {
      page.contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents.push({
        musicShelfRenderer: {
          title: runs(run("Suggestions")),
          contents: [songRow({ id: "vidSUGGEST01", title: "Suggested" })],
        },
      });
    });
    fake.innertube("browse", json(withSuggestions));
    const page = await playlistPage(yt, "PLsug", signal());
    expect(page.tracks.map((track) => track.id)).toEqual(["vidFIRST001"]);
  });
});

describe("aborts reject", () => {
  it("every page function rejects an aborted signal", async () => {
    const { yt } = harness();
    const pages = new Pages(yt);
    const calls = [
      trackPage(yt, "vidABORT001", aborted()),
      pages.album("MPREb_1", aborted()),
      pages.artist("UCa", aborted()),
      playlistPage(yt, "PLa", aborted()),
      radio(yt, "vidABORT001", {}, aborted()),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("page fallbacks", () => {
  it("trackPage uses the row with the matching id when none is selected", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "next",
      json(
        nextResponse(
          queueRow({ id: "vidOTHER001", title: "Other", byline: [] }),
          queueRow({
            id: "vidMATCH001",
            title: "Match",
            byline: [artistRun("A", "UCa")],
          }),
        ),
      ),
    );
    expect((await trackPage(yt, "vidMATCH001", signal())).title).toBe("Match");
  });

  it("a renamed fallback artist is cached under both ids", async () => {
    const { fake, yt } = harness();
    fake.innertube("browse", json({}, 404), byBrowseId("UCold"));
    fake.innertube("search", json(searchResponse(shelf(browseRow("ARTIST", "UCnew", "Artist")))), searchFor("artist"));
    fake.innertube(
      "browse",
      json({
        header: {
          musicImmersiveHeaderRenderer: {
            title: runs(run("Artist")),
            thumbnail: thumb(ART(900), 900, 900),
          },
        },
      }),
      byBrowseId("UCnew"),
    );
    const pages = new Pages(yt);
    await pages.artist("UCold", signal());
    const before = fake.calls.length;
    expect(await pages.artistImage("UCold", signal())).toBeDefined();
    expect(fake.calls.length).toBe(before);
  });

  it("an artist page without shelves has empty sections", async () => {
    const { fake, yt } = harness();
    fake.innertube(
      "browse",
      json({
        header: {
          musicImmersiveHeaderRenderer: { title: runs(run("Artist")) },
        },
      }),
    );
    const page = await new Pages(yt).artist("UCa", signal());
    expect([page.tracks, page.albums, page.singles]).toEqual([[], [], []]);
  });

  it("releases follow the subtitle word first, the shelf title only as a hint", async () => {
    const { fake, yt } = harness();
    const response = {
      header: {
        musicImmersiveHeaderRenderer: { title: runs(run("Artist")) },
      },
      contents: {
        sectionListRenderer: {
          contents: [
            carousel("Albums", [
              twoRowItem({
                title: "Odd",
                id: "MPREb_odd",
                subtitle: ["Compilation", "2018"],
              }),
              twoRowItem({
                title: "Real EP",
                id: "MPREb_ep",
                subtitle: ["EP", "2019"],
              }),
            ]),
            carousel("Singles", [
              twoRowItem({
                title: "Remix",
                id: "MPREb_rmx",
                subtitle: ["Remix", "2020"],
              }),
            ]),
            carousel("Playlists for you", [
              twoRowItem({
                title: "Stray",
                id: "MPREb_stray",
                subtitle: ["Compilation", "2021"],
              }),
            ]),
          ],
        },
      },
    };
    fake.innertube("browse", json(response));
    const page = await new Pages(yt).artist("UCa", signal());
    expect(page.albums.map((album) => album.id)).toEqual(["MPREb_odd"]);
    expect(page.singles.map((single) => [single.id, single.releaseKind])).toEqual([
      ["MPREb_ep", "ep"],
      ["MPREb_rmx", "single"],
    ]);
  });
});

describe("isNoise", () => {
  it("knows Ukrainian kind words and counts", () => {
    for (const part of ["Мікс", "Збірка", "12 пісень", "1 пісня", "30 треків"]) expect(isNoise(part)).toBe(true);
    expect(isNoise("Chill mix")).toBe(false);
  });
});

describe("radio with no queue", () => {
  it("returns an empty list after both requests", async () => {
    const { fake, yt } = harness();
    fake.innertube("next", json(nextResponse()));
    expect(await radio(yt, "vidEMPTY001", {}, signal())).toEqual([]);
    expect(fake.callsTo("POST", NEXT)).toHaveLength(2);
  });
});
