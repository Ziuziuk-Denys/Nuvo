import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { COVER, ENTITY_OFFSET, ROW, contentLeft } from "../../src/ui/geometry";
import { launchNuvo, SIZES, type NuvoSession } from "./harness";
import { coverBase, LONG_RU, PLAYER_SESSION_KEY, trackSnapshot } from "./seed";

const STEP = "3-entity";
const LOOKS_NUVO = [
  { preset: "nuvo", mode: "light" },
  { preset: "nuvo", mode: "dark" },
] as const;

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

interface HeadLayout {
  coverLeft: number;
  coverSize: number;
  titleLines: number;
  playBottom: number;
  lit: boolean;
  glass: string[];
  rowHeights: number[];
  numberRights: number[];
  durationRights: number[];
  rowsInDom: number;
  overflow: string[];
  actionsOverlap: boolean;
}

async function measure(page: Page): Promise<HeadLayout> {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>("header:has(h1)")!;
    const cover = head.children[0].getBoundingClientRect();
    const title = head.querySelector("h1")!;
    const range = document.createRange();
    range.selectNodeContents(title);
    const lineTops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    const play = [...head.querySelectorAll("button")].find((button) => button.hasAttribute("data-primary"))!.getBoundingClientRect();
    const glass = [...head.querySelectorAll<HTMLElement>("*")]
      .filter((node) => getComputedStyle(node).backdropFilter !== "none")
      .map((node) => node.tagName + "." + node.className);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-track-row]")];
    const visible = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight;
    });
    const overflow = visible.flatMap((row) => {
      const box = row.getBoundingClientRect();
      return [...row.querySelectorAll("*")]
        .filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width > 0 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5);
        })
        .map((child) => `${row.textContent?.slice(0, 30)}: ${child.className}`);
    });
    const actions = head.children[1].lastElementChild!;
    const buttons = actions.children[0].getBoundingClientRect();
    const tools = actions.children[1]?.getBoundingClientRect();
    const actionsOverlap = tools ? buttons.right > tools.left && buttons.bottom > tools.top && tools.bottom > buttons.top : false;
    return {
      coverLeft: cover.left,
      coverSize: cover.width,
      titleLines: lineTops.size,
      playBottom: play.bottom,
      lit: document.querySelector("[data-player-below]") === null,
      glass,
      rowHeights: visible.map((row) => row.getBoundingClientRect().height),
      numberRights: visible.map((row) => row.firstElementChild!.getBoundingClientRect().right),
      durationRights: visible.map((row) => row.lastElementChild!.getBoundingClientRect().right),
      rowsInDom: rows.length,
      overflow,
      actionsOverlap,
    };
  });
}

function expectSharedLayout(layout: HeadLayout, where: string): void {
  expect(layout.coverLeft, `${where}: cover 4 px in from the gutter`).toBe(contentLeft(1200) + ENTITY_OFFSET.x);
  expect(layout.coverSize, `${where}: 168 px cover, 144 for an artist`).toBe(where.startsWith("artist") ? COVER.heroCircle : COVER.hero);
  expect(layout.glass, `${where}: no glass in the head`).toEqual([]);
  expect(layout.titleLines, `${where}: title in two lines at most`).toBeLessThanOrEqual(2);
  expect(layout.rowHeights.length, `${where}: rows render`).toBeGreaterThan(0);
  const rowHeight = where.startsWith("album") ? ROW.numbered : ROW.track;
  for (const height of layout.rowHeights) expect(height, `${where}: ${rowHeight} px rows`).toBe(rowHeight);
  expect(new Set(layout.numberRights.map(Math.round)).size, `${where}: numbers share one right edge`).toBe(1);
  expect(new Set(layout.durationRights.map(Math.round)).size, `${where}: durations share one right edge`).toBe(1);
  expect(layout.overflow, `${where}: nothing spills out of a row`).toEqual([]);
  expect(layout.actionsOverlap, `${where}: actions and tools do not overlap`).toBe(false);
}

async function openPlaylist(live: NuvoSession, id: string, title: string): Promise<void> {
  await live.go(`#/library/playlist?id=${encodeURIComponent(id)}`);
  await live.page.locator("h1").filter({ hasText: title }).first().waitFor({ timeout: 15_000 });
  await live.page.waitForTimeout(600);
}

async function playFromSmall(page: Page, smallId: string): Promise<void> {
  // a pending debounced store write would land after ours and replace it, so let it flush first
  await page.waitForTimeout(1_100);
  await page.evaluate(
    ([id, key]) => {
      const stored = JSON.parse(localStorage.getItem(key)!);
      // the seed's queue holds tracks 1-50; track 42 is the small playlist's second song
      stored.index = 41;
      stored.context = `playlist:${id}`;
      localStorage.setItem(key, JSON.stringify(stored));
    },
    [smallId, PLAYER_SESSION_KEY] as const,
  );
}

describe("Playlist page", () => {
  it("the 300-song and the 24-song playlists in every look and size", { timeout: 1_500_000 }, async () => {
    session = await launchNuvo({ profile: "seeded" });
    const live = session;
    const seed = live.seed!;
    await playFromSmall(live.page, seed.smallPlaylistId);
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");

    const playlists = [
      { id: seed.bigPlaylistId, title: "Late night drive", screen: "playlist-300" },
      { id: seed.smallPlaylistId, title: "Morning", screen: "playlist-24" },
    ];
    for (const playlist of playlists) {
      const prepare = () => openPlaylist(live, playlist.id, playlist.title);
      await prepare();
      for (const size of SIZES) {
        await live.setSize(size);
        await live.page.waitForTimeout(300);
        const layout = await measure(live.page);
        const where = `${playlist.screen} ${size.width}`;
        expectSharedLayout(layout, where);
        expect(layout.lit, `${where}: lit`).toBe(true);
        if (playlist.screen === "playlist-300") expect(layout.rowsInDom, `${where}: virtualised`).toBeLessThan(60);
        expect(layout.playBottom, `${where}: Play above the fold`).toBeLessThan(size.height - 96);
      }
      await live.shoot(STEP, playlist.screen, "rest", { prepare });
    }

    const wide = SIZES.find((entry) => entry.width === 1200)!;
    const prepare = async () => {
      await openPlaylist(live, seed.smallPlaylistId, "Morning");
      await live.page.emulateMedia({ reducedMotion: "reduce" });
      await live.page.locator("[data-track-row]").nth(1).hover();
      await live.page.waitForTimeout(300);
    };
    await live.shoot(STEP, "playlist-24", "hover", { looks: [...LOOKS_NUVO], sizes: [wide], prepare });
  });

  it("ru with a 60-character title and 3 songs at both sizes", { timeout: 600_000 }, async () => {
    const live = session ?? (await launchNuvo({ profile: "seeded" }));
    session = live;
    const port = await coverBase();
    const tracks = [9, 10, 11].map((index) => ({ ...trackSnapshot(index), cover: { url: `http://127.0.0.1:${port}/${index}.svg` } }));
    const id = (await live.core(
      `const created = await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: ${JSON.stringify(LONG_RU)} }) });
       if (!created.ok) throw new Error("playlist " + created.status);
       const playlist = await created.json();
       const added = await fetch(base + "/v1/me/playlists/" + playlist.id + "/tracks", { method: "POST", headers: json, body: JSON.stringify({ tracks: ${JSON.stringify(tracks)} }) });
       if (!added.ok) throw new Error("tracks " + added.status);
       return playlist.id;`,
    )) as string;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "ru"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");

    const prepare = () => openPlaylist(live, id, LONG_RU.slice(0, 20));
    await live.setLook(LOOKS_NUVO[0]);
    await prepare();
    for (const size of SIZES) {
      await live.setSize(size);
      await live.page.waitForTimeout(300);
      const layout = await measure(live.page);
      const where = `ru-long ${size.width}`;
      expectSharedLayout(layout, where);
      expect(layout.titleLines, `${where}: the title ellipsizes on one line`).toBe(1);
      expect(layout.playBottom, `${where}: Play above the fold`).toBeLessThan(size.height - 96);
    }
    await live.shoot(STEP, "playlist-ru-long", "rest", { looks: [...LOOKS_NUVO], prepare });
  });
});

const QUEEN = "UCiMhD4jzUqG-IgPzUmmytRQ";

async function online(): Promise<boolean> {
  try {
    const res = await fetch("https://music.youtube.com", { signal: AbortSignal.timeout(5_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

interface HeadBox {
  coverLeft: number;
  coverTop: number;
  coverSize: number;
  titleLeft: number;
  coverRadius: string;
}

async function headBox(page: Page): Promise<HeadBox> {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>("header:has(h1)")!;
    const cover = head.children[0].getBoundingClientRect();
    const art = head.children[0] as HTMLElement;
    return {
      coverLeft: cover.left,
      coverTop: cover.top,
      coverSize: cover.width,
      titleLeft: head.querySelector("h1")!.getBoundingClientRect().left,
      coverRadius: getComputedStyle(art).borderRadius,
    };
  });
}

describe("Album and artist pages", () => {
  it("the Queen artist page and its first album in every look and size", { timeout: 1_500_000 }, async () => {
    if (!(await online())) {
      console.warn("offline: music.youtube.com did not answer, artist and album shots skipped");
      return;
    }
    const live = session ?? (await launchNuvo({ profile: "seeded" }));
    session = live;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await live.setLook(LOOKS_NUVO[0]);
    const openArtist = async () => {
      await live.go(`#/artist?id=${QUEEN}`);
      await live.page.locator("[data-entity=artist] h1").filter({ hasText: "Queen" }).waitFor({ timeout: 30_000 });
      await live.page.locator("[data-track-row]").first().waitFor({ timeout: 60_000 });
      await live.page.waitForTimeout(600);
    };
    await openArtist();
    const albumTile = live.page
      .locator("section", { has: live.page.locator("h2", { hasText: "Albums" }) })
      .locator("button")
      .first();
    await albumTile.waitFor({ timeout: 30_000 });
    await albumTile.click();
    await live.page.locator("[data-entity=album] h1").waitFor({ timeout: 30_000 });
    const albumHash = new URL(live.page.url()).hash;
    const openAlbum = async () => {
      await live.go(albumHash);
      await live.page.locator("[data-entity=album] [data-track-row]").first().waitFor({ timeout: 30_000 });
      await live.page.waitForTimeout(600);
    };

    for (const size of SIZES) {
      await live.setSize(size);
      await openArtist();
      const artist = await headBox(live.page);
      expectSharedLayout(await measure(live.page), `artist ${size.width}`);
      expect(await live.page.locator("[data-track-row]").count(), `artist ${size.width}: five top songs`).toBe(5);
      await openAlbum();
      const album = await headBox(live.page);
      expectSharedLayout(await measure(live.page), `album ${size.width}`);
      const where = `${size.width}`;
      expect(artist.coverRadius, `${where}: the artist is a circle`).toBe("50%");
      expect(album.coverRadius, `${where}: the album is a square`).not.toBe("50%");
      expect(artist.coverLeft, `${where}: circle and square start on one edge`).toBe(album.coverLeft);
    }
    await live.shoot(STEP, "artist-queen", "rest", { prepare: openArtist });
    await live.shoot(STEP, "album-first", "rest", { prepare: openAlbum });
  });

  it("the empty playlist in nuvo light and dark at both sizes", { timeout: 600_000 }, async () => {
    const live = session ?? (await launchNuvo({ profile: "seeded" }));
    session = live;
    await live.page.evaluate(() => localStorage.setItem("nuvo_locale", "en"));
    const id = (await live.core(
      `const created = await fetch(base + "/v1/me/playlists", { method: "POST", headers: json, body: JSON.stringify({ title: "Nothing yet" }) });
       if (!created.ok) throw new Error("playlist " + created.status);
       return (await created.json()).id;`,
    )) as string;
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    const prepare = () => openPlaylist(live, id, "Nothing yet");
    await live.setLook(LOOKS_NUVO[0]);
    await prepare();
    for (const size of SIZES) {
      await live.setSize(size);
      await live.page.waitForTimeout(300);
      const place = await live.page.evaluate(() => {
        const line = [...document.querySelectorAll("p")].find((node) => node.textContent?.startsWith("This playlist is empty"))!.getBoundingClientRect();
        const sheet = document.querySelector('[class*="_tracks_"]')!.getBoundingClientRect();
        return { dx: line.left + line.width / 2 - (sheet.left + sheet.width / 2), inside: line.top > sheet.top && line.bottom < sheet.bottom };
      });
      expect(Math.abs(place.dx), `empty ${size.width}: centred in the sheet`).toBeLessThan(1);
      expect(place.inside, `empty ${size.width}: inside the sheet`).toBe(true);
    }
    await live.shoot(STEP, "playlist-empty", "rest", { looks: [...LOOKS_NUVO], prepare });
  });
});
