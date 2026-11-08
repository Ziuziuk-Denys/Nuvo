import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright-core";
import type { NuvoSession } from "./harness";

export interface SeedReport {
  bigPlaylistId: string;
  smallPlaylistId: string;
  emptyPlaylistId: string;
  likedCount: number;
  albumIds: string[];
  artistIds: string[];
}

// two stops per cover; one violet (#7A4DFF) and one grey on purpose
const PALETTE: [string, string][] = [
  ["#E0302F", "#FF9E5C"],
  ["#1E88E5", "#7FD1FF"],
  ["#7A4DFF", "#C9B8FF"],
  ["#2E9E6B", "#B7F0CF"],
  ["#F2B705", "#FF7A45"],
  ["#8A8A8E", "#D2D2D7"],
  ["#D81B7A", "#FFB3D1"],
  ["#00897B", "#4DD0E1"],
];

export function coverDataUrl(seed: number): string {
  const [from, to] = PALETTE[Math.abs(seed) % PALETTE.length];
  const shift = (Math.abs(seed) * 37) % 60;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="300" height="300" fill="url(#g)"/>` +
    `<circle cx="${90 + shift}" cy="${110 + shift / 2}" r="70" fill="#ffffff" fill-opacity="0.22"/>` +
    `<circle cx="${210 - shift / 2}" cy="${200 - shift}" r="46" fill="#000000" fill-opacity="0.18"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const ARTISTS = [
  { id: "seed-artist-01", name: "Northern Lights" },
  { id: "seed-artist-02", name: "Velvet Hour" },
  { id: "seed-artist-03", name: "Paper Satellites" },
  { id: "seed-artist-04", name: "Дорожный патруль" },
  { id: "seed-artist-05", name: "Ночные снайперы" },
  { id: "seed-artist-06", name: "Мурашки" },
  { id: "seed-artist-07", name: "Белые крылья" },
  { id: "seed-artist-08", name: "Электрофорез" },
];

const WORDS = ["Midnight", "Glass", "Harbor", "Static", "Golden", "Echo", "Neon", "Paper", "Orbit", "Slow", "Summer", "Signal"];
const NOUNS = ["Drive", "Tide", "Garden", "Letters", "Window", "Season", "Parade", "Radio", "Skyline", "Fever"];
const LONG_EN = "An Exceptionally Long Track Title That Will Not Fit In A Row"; // 60 characters
export const LONG_RU = "Очень длинное название трека, которое не помещается в строку"; // 60 characters

/** The daemon fetches https covers only, so seeded covers use this host and the harness answers their requests. */
const FIXTURE_COVER_HOST = "covers.nuvo.test";
export const fixtureCover = (seed: number) => `https://${FIXTURE_COVER_HOST}/${seed}.svg`;

/** Answers the app's cover requests for fixture covers with the generated picture, as the daemon cache would. */
export async function serveFixtureCovers(page: Page): Promise<void> {
  await page.route(/\/v1\/covers\?/, async (route) => {
    const src = new URL(route.request().url()).searchParams.get("src") ?? "";
    const match = new RegExp(`^https://${FIXTURE_COVER_HOST}/(\\d+)\\.svg$`).exec(src);
    if (!match) return route.fallback();
    const svg = decodeURIComponent(coverDataUrl(Number(match[1])).split(",", 2)[1]);
    return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: svg });
  });
}

let coverServer: Promise<number> | null = null;

/**
 * Saved albums and artists pass their cover through mediaUrl, which only keeps http(s) URLs,
 * so those covers come from a loopback server. Tracks use coverUrl and stay on data URLs.
 */
export function coverBase(): Promise<number> {
  coverServer ??= new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const seed = Number(/(\d+)\.svg/.exec(req.url ?? "")?.[1] ?? 0);
      const svg = decodeURIComponent(coverDataUrl(seed).split(",", 2)[1]);
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
      res.end(svg);
    });
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    server.unref();
  });
  return coverServer;
}

const TRACK_COUNT = 300;
const ALBUM_COUNT = 12;
const ARTIST_SAVED_COUNT = 8;

function trackTitle(index: number): string {
  if (index === 2) return LONG_EN;
  if (index === 3) return LONG_RU;
  return `${WORDS[index % WORDS.length]} ${NOUNS[(index * 7) % NOUNS.length]}`;
}

/**
 * The snapshot sent to nuvo-core; the client-side shape also carries coverUrl (a data URL must skip mediaUrl).
 * With withCover it also carries cover.url, the field the daemon's own mixes read, as real tracks do.
 */
export function trackSnapshot(index: number, withCover = false) {
  const artist = ARTISTS[index % ARTISTS.length];
  return {
    ...(withCover ? { cover: { url: fixtureCover(index) } } : {}),
    id: `seed-${String(index).padStart(4, "0")}`,
    title: trackTitle(index),
    artists: [artist],
    durationMs: 150_000 + ((index * 7919) % 120_000),
    coverUrl: coverDataUrl(index),
    album: { id: `seed-album-${String((index % ALBUM_COUNT) + 1).padStart(2, "0")}`, title: `Album ${(index % ALBUM_COUNT) + 1}` },
  };
}

const NEW_ARTISTS = [
  { id: "seed-new-artist-1", name: "Harbor Lights" },
  { id: "seed-new-artist-2", name: "Quiet Engines" },
  { id: "seed-new-artist-3", name: "Летний ливень" },
  { id: "seed-new-artist-4", name: "Glass Atlas" },
  { id: "seed-new-artist-5", name: "Morning Static" },
  { id: "seed-new-artist-6", name: "Северный ветер" },
];

/** A song outside the library, as a radio list would bring one: its own title, a new artist. */
export function newSong(index: number) {
  const artist = NEW_ARTISTS[index % NEW_ARTISTS.length];
  return {
    cover: { url: fixtureCover(400 + index) },
    id: `seed-new-${String(index).padStart(3, "0")}`,
    title: `${WORDS[index % WORDS.length]} Avenue ${index}`,
    artists: [artist],
    durationMs: 160_000 + ((index * 4111) % 90_000),
    coverUrl: coverDataUrl(400 + index),
  };
}

/** Radio lists for the liked songs, the way the pool refresher stores them, so New to you and More like have songs offline. */
export async function seedPools(session: NuvoSession, seeds = 40, perSeed = 12): Promise<void> {
  const lists = Array.from({ length: seeds }, (_, s) => ({
    seedId: trackSnapshot(s + 1).id,
    items: Array.from({ length: perSeed }, (_, i) => newSong((s * 5 + i) % 60)),
  }));
  await session.core(
    `for (const list of ${JSON.stringify(lists)}) {
       const res = await fetch(base + "/v1/recs/pool", { method: "PUT", headers: json, body: JSON.stringify({ seedId: list.seedId, source: "yt_radio", items: list.items }) });
       if (!res.ok) throw new Error("pool " + res.status + " " + await res.text());
     }`,
  );
}

/** The engine's saved session (src/engine/persist.ts): entries, index, positionMs, durationMs, context, listCover. */
export const PLAYER_SESSION_KEY = "nuvo.player.session.v3";

function clientTrack(index: number) {
  const snap = trackSnapshot(index);
  return {
    id: snap.id,
    title: snap.title,
    artists: snap.artists[0].name,
    artistList: snap.artists,
    artistId: snap.artists[0].id,
    coverUrl: snap.coverUrl,
    durationMs: snap.durationMs,
    playCount: 0,
    album: snap.album,
  };
}

export async function seedLibrary(session: NuvoSession): Promise<SeedReport> {
  const tracks = Array.from({ length: TRACK_COUNT }, (_, i) => trackSnapshot(i + 1, true));
  const likedCount = 40;

  const ids = (await session.core(
    `const tracks = ${JSON.stringify(tracks)};
     const send = async (method, path, body) => {
       const res = await fetch(base + path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
       if (!res.ok) throw new Error(method + " " + path + " " + res.status + " " + await res.text());
       return res.status === 204 ? null : res.json().catch(() => null);
     };
     for (const track of tracks.slice(0, ${likedCount})) {
       await send("PUT", "/v1/me/library/tracks/" + track.id, { track });
     }
     const big = await send("POST", "/v1/me/playlists", { title: "Late night drive" });
     await send("POST", "/v1/me/playlists/" + big.id + "/tracks", { tracks });
     const small = await send("POST", "/v1/me/playlists", { title: "Morning" });
     await send("POST", "/v1/me/playlists/" + small.id + "/tracks", { tracks: tracks.slice(40, 64) });
     const empty = await send("POST", "/v1/me/playlists", { title: "Empty playlist" });
     return { big: big.id, small: small.id, empty: empty.id };`,
  )) as { big: string; small: string; empty: string };

  const remoteCover = fixtureCover;
  const albumIds: string[] = [];
  const albums = Array.from({ length: ALBUM_COUNT }, (_, i) => {
    const id = `seed-album-${String(i + 1).padStart(2, "0")}`;
    albumIds.push(id);
    return { id, title: i === 1 ? LONG_EN : `Album ${i + 1}`, cover: { url: remoteCover(100 + i) }, trackCount: 8 + i };
  });
  const artistIds: string[] = [];
  const artists = Array.from({ length: ARTIST_SAVED_COUNT }, (_, i) => {
    const artist = ARTISTS[i];
    artistIds.push(artist.id);
    return { id: artist.id, name: artist.name, title: artist.name, cover: { url: remoteCover(200 + i) } };
  });
  await session.core(
    `const put = async (type, snapshot) => {
       const res = await fetch(base + "/v1/me/library/" + type + "/" + encodeURIComponent(snapshot.id), { method: "PUT", headers: json, body: JSON.stringify({ snapshot }) });
       if (!res.ok) throw new Error(type + " " + res.status);
     };
     for (const album of ${JSON.stringify(albums)}) await put("albums", album);
     for (const artist of ${JSON.stringify(artists)}) await put("artists", artist);`,
  );

  const queue = Array.from({ length: 50 }, (_, i) => clientTrack(i + 1));
  const first = queue[0];
  const playerSession = {
    entries: queue.map((track, order) => ({ entryId: `seed-${order}`, track, origin: "list", order })),
    index: 0,
    positionMs: 42_000,
    durationMs: first.durationMs,
    context: "Late night drive",
    listCover: first.coverUrl,
  };
  const pins = {
    state: {
      pins: [
        {
          kind: "playlist",
          id: ids.big,
          title: "Late night drive",
          subtitle: "300 tracks",
          imageUrl: coverDataUrl(1),
          href: `/library/playlist?id=${ids.big}`,
          trackCount: TRACK_COUNT,
        },
        {
          kind: "playlist",
          id: ids.small,
          title: "Morning",
          subtitle: "24 tracks",
          imageUrl: coverDataUrl(41),
          href: `/library/playlist?id=${ids.small}`,
          trackCount: 24,
        },
        { kind: "album", id: albumIds[0], title: "Album 1", imageUrl: coverDataUrl(100), href: `/collection?type=album&id=${albumIds[0]}` },
      ],
    },
    version: 0,
  };
  // a pending debounced store write would land after ours and replace it, so let it flush first
  await session.page.waitForTimeout(1_100);
  await session.page.evaluate(
    ([player, homePins, key]) => {
      localStorage.setItem(key, player);
      localStorage.setItem("nuvo_home_pins_v1", homePins);
    },
    [JSON.stringify(playerSession), JSON.stringify(pins), PLAYER_SESSION_KEY],
  );

  return {
    bigPlaylistId: ids.big,
    smallPlaylistId: ids.small,
    emptyPlaylistId: ids.empty,
    likedCount,
    albumIds,
    artistIds,
  };
}
