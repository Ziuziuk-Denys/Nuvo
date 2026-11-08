import { describe, expect, it } from "vitest";
import { YtAccount } from "./index";
import { createCatalog } from "../catalog";
import { json } from "../test/fakeFetch";
import { harness, signal } from "../test/harness";
import { MemoryStore } from "../test/memoryStore";

const WWW = "https://www.youtube.com";
const signedIn = {
  accessToken: "AT",
  refreshToken: "RT",
  tokenType: "Bearer",
  expiresAt: 9_999_999_999_999,
};

async function setup(session: typeof signedIn | null = signedIn) {
  const h = harness();
  const store = new MemoryStore();
  store.session = session;
  const account = new YtAccount({ fetch: h.fake.fetch, yt: h.yt, store });
  await account.init();
  return { ...h, account };
}

const text = (value: string) => ({ runs: [{ text: value }] });
const line = (...items: Array<Record<string, unknown>>) => ({
  lineRenderer: {
    items: items.map((item) => ({ lineItemRenderer: { text: item } })),
  },
});

const playlistTile = (browseId: string, title: string) => ({
  tileRenderer: {
    contentType: "TILE_CONTENT_TYPE_PLAYLIST",
    onSelectCommand: { browseEndpoint: { browseId } },
    metadata: {
      tileMetadataRenderer: {
        title: { simpleText: title },
        lines: [line(text("Owner"))],
      },
    },
    header: {
      tileHeaderRenderer: {
        thumbnail: {
          thumbnails: [{ url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 360 }],
        },
      },
    },
  },
});

const videoTile = (id: string, title: string, artist: string, duration: string) => ({
  tileRenderer: {
    contentType: "TILE_CONTENT_TYPE_VIDEO",
    contentId: id,
    metadata: {
      tileMetadataRenderer: {
        title: { simpleText: title },
        lines: [
          line({
            runs: [
              {
                text: artist,
                navigationEndpoint: {
                  browseEndpoint: { browseId: "UCartist" },
                },
              },
            ],
          }),
        ],
      },
    },
    header: {
      tileHeaderRenderer: {
        thumbnailOverlays: [
          {
            thumbnailOverlayTimeStatusRenderer: {
              text: { simpleText: duration },
            },
          },
        ],
      },
    },
  },
});

const page = (items: unknown[], token?: string, extra: Record<string, unknown> = {}) => ({
  contents: {
    tvBrowseRenderer: {
      content: {
        tvSurfaceContentRenderer: {
          content: {
            gridRenderer: {
              items,
              ...(token
                ? {
                    continuations: [{ nextContinuationData: { continuation: token } }],
                  }
                : {}),
            },
          },
        },
      },
    },
  },
  ...extra,
});

describe("account browse", () => {
  it("the selected account wins and protocol-relative photos get https", async () => {
    const { fake, account } = await setup();
    fake.innertube(
      "account/accounts_list",
      json({
        actions: [
          {
            getMultiPageMenuAction: {
              menu: {
                accountItem: {
                  accountName: text("First"),
                  isSelected: false,
                  hasChannel: false,
                },
                more: [
                  {
                    accountItem: {
                      accountName: text("Second"),
                      accountByline: text("s@example.com"),
                      channelHandle: text("@second"),
                      isSelected: true,
                      hasChannel: true,
                      accountPhoto: {
                        thumbnails: [
                          { url: "//yt3.ggpht.com/a=s48", width: 48 },
                          { url: "//yt3.ggpht.com/a=s88", width: 88 },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      }),
      undefined,
      WWW,
    );
    expect(await account.profile(signal())).toEqual({
      name: "Second",
      email: "s@example.com",
      handle: "@second",
      avatarUrl: "https://yt3.ggpht.com/a=s88",
      ownsChannel: true,
    });
    const call = fake.calls.find((c) => c.url.includes("accounts_list"))!;
    expect(call.headers.authorization).toBe("Bearer AT");
    expect(call.json<{ context: { client: { clientName: string } } }>().context.client.clientName).toBe("TVHTML5");
  });

  it("playlist tiles only, VL removed; the catalog then routes the id to the account", async () => {
    const { fake, yt, account } = await setup();
    fake.innertube(
      "browse",
      json(page([playlistTile("VLPL1", "Mine"), videoTile("vidAAAAAAA1", "Song", "Artist", "3:00")])),
      (body) => body.browseId === "FEmusic_liked_playlists",
      WWW,
    );
    expect(await account.playlists(signal())).toEqual([
      {
        id: "PL1",
        title: "Mine",
        subtitle: "Owner",
        coverUrl: "https://i.ytimg.com/vi/x/hq.jpg",
      },
    ]);
    fake.innertube(
      "browse",
      json(
        page([videoTile("vidAAAAAAA1", "Song", "Artist", "3:00")], undefined, {
          header: { entityMetadataRenderer: { title: { simpleText: "Mine" } } },
        }),
      ),
      (body) => body.browseId === "VLPL1",
      WWW,
    );
    const catalog = createCatalog({ yt, fetch: fake.fetch, account });
    const mine = await catalog.playlist("PL1", signal());
    expect(mine.title).toBe("Mine");
    expect(fake.calls.filter((call) => call.url.startsWith("https://music.youtube.com"))).toHaveLength(0);
  });

  it("a later page with no new tile stops the paging", async () => {
    const { fake, account } = await setup();
    fake.innertube("browse", json(page([playlistTile("VLPL1", "One")], "t1")), (body) => body.browseId === "FEmusic_liked_playlists", WWW);
    fake.innertube("browse", json(page([playlistTile("VLPL1", "One")], "t2")), (body) => body.continuation === "t1", WWW);
    await account.playlists(signal());
    expect(fake.callsTo("POST", `${WWW}/youtubei/v1/browse`)).toHaveLength(2);
  });

  it("author skips labels and counts; Topic is removed from artists", async () => {
    const { fake, account } = await setup();
    const header = {
      entityMetadataRenderer: {
        title: { simpleText: "Mix" },
        bylines: [line(text("Playlist")), line(text("Owner")), line(text("120 songs")), line(text("Updated today"))],
      },
    };
    fake.innertube("browse", json(page([videoTile("vidAAAAAAA1", "Song", "Artist - Topic", "3:21")], undefined, { header })), undefined, WWW);
    const mix = (await account.accountPlaylist("PLmix", signal()))!;
    expect(mix.author).toBe("Owner");
    expect(mix.tracks[0]).toMatchObject({
      artists: [{ id: "UCartist", name: "Artist" }],
      durationMs: 201_000,
    });
    expect([mix.trackCount, mix.cover?.url]).toEqual([1, "https://i.ytimg.com/vi/vidAAAAAAA1/hqdefault.jpg"]);
  });

  it("only labels and counts: no author", async () => {
    const { fake, account } = await setup();
    const header = {
      entityMetadataRenderer: {
        title: { simpleText: "Mix" },
        bylines: [line(text("Auto playlist")), line(text("12 videos")), line(text("Private"))],
      },
    };
    fake.innertube("browse", json(page([], undefined, { header })), undefined, WWW);
    expect((await account.accountPlaylist("PLx", signal()))!.author).toBeUndefined();
  });

  it("album track tiles use the track header and the long-press subtitle", async () => {
    const { fake, account } = await setup();
    const tile = {
      tileRenderer: {
        contentId: "vidTRACK001",
        header: {
          trackTileHeaderRenderer: {
            title: { simpleText: "Track One" },
            duration: { simpleText: "2:05" },
          },
        },
        onLongPressCommand: {
          showMenuCommand: { subtitle: { simpleText: "Band" } },
        },
      },
    };
    fake.innertube(
      "browse",
      json(
        page([tile], undefined, {
          header: {
            entityMetadataRenderer: { title: { simpleText: "Album" } },
          },
        }),
      ),
      undefined,
      WWW,
    );
    const album = (await account.accountPlaylist("OLAK5uy_a", signal()))!;
    expect(album.tracks[0]).toMatchObject({
      id: "vidTRACK001",
      title: "Track One",
      durationMs: 125_000,
      artists: [{ id: "unknown", name: "Band" }],
    });
  });

  it("signed out: an empty list without a request", async () => {
    const { fake, account } = await setup(null);
    expect(await account.playlists(signal())).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
