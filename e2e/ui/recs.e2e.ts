import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type Look, type NuvoSession } from "./harness";
import { seedLibrary, trackSnapshot } from "./seed";

const STEP = "recs-home";
const LIGHT: Look = { preset: "nuvo", mode: "light" };
const DARK: Look = { preset: "nuvo", mode: "dark" };
const W1200 = { width: 1200, height: 780 };
const W1100 = { width: 1100, height: 705 };

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

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
    album: snap.album,
  };
}

async function playing(live: NuvoSession, index: number, reason: { kind: string; name?: string } | null): Promise<void> {
  await live.page.waitForTimeout(1_100);
  await live.page.evaluate(
    ([track, why]) => {
      const entry = { entryId: "e1", track, origin: why ? "continuation" : "list", order: 0, ...(why ? { reason: why } : {}) };
      localStorage.setItem(
        "nuvo.player.session.v3",
        JSON.stringify({
          entries: [entry],
          index: 0,
          positionMs: 42_000,
          durationMs: (track as { durationMs: number }).durationMs,
          context: null,
          listCover: null,
        }),
      );
    },
    [clientTrack(index), reason] as const,
  );
  await live.page.reload();
  await live.page.waitForSelector("[data-island]", { timeout: 30_000 });
  await live.page.waitForTimeout(800);
}

async function leftZone(live: NuvoSession) {
  return live.page.evaluate(() => {
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, width: r.width } : null;
    };
    const bar = document.querySelector("[data-island]")!;
    const now = bar.firstElementChild!;
    const title = bar.querySelector("[data-island-title]");
    const like = bar.querySelector("[data-like]");
    const buttons = [...now.querySelectorAll("button")].filter((b) => b !== like && !b.getAttribute("aria-label"));
    return {
      nowRight: rect(now)!.right,
      centreLeft: rect(bar.children[1].firstElementChild ?? bar.children[1])!.left,
      title: rect(title),
      titleClipped: title ? (title as HTMLElement).scrollWidth > (title as HTMLElement).clientWidth : false,
      like: rect(like),
      actions: buttons.map((b) => ({ text: b.textContent, ...rect(b)!, clipped: b.scrollWidth > b.clientWidth })),
    };
  });
}

describe("recs UI shots", () => {
  it("Home mixes, the reason line and the notice", async () => {
    const live = await launchNuvo({ profile: "fresh", locale: "en" });
    session = live;
    const page = live.page;
    page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 400)));
    page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 400), (e.stack ?? "").slice(0, 600)));
    await passFirstRun(page);
    await seedLibrary(live);
    await page.waitForTimeout(1_100);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    const real = (await live.core(
      `return (await (await fetch(base + "/v1/me/recommendations/daily-mixes")).json()).items.map(m => m.id + ":" + m.tracks.length);`,
    )) as string[];
    console.log("daemon mixes:", real.join(", "));

    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        if (!url.endsWith("/v1/me/recommendations/daily-mixes")) return response;
        const body = (await response.clone().json()) as { items: Array<{ id: string; title: string; description: string; tracks: unknown[] }> };
        const forYou = body.items.find((m) => m.id === "daily-mix-for-you");
        if (forYou && !body.items.some((m) => m.id === "daily-mix-discover" && m.tracks.length > 0)) {
          body.items.unshift({ id: "daily-mix-discover", title: "New to you", description: "", tracks: [...forYou.tracks].reverse() });
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    });
    await page.reload();
    await live.go("#/");
    await page.waitForSelector("[data-mix]", { timeout: 15_000 }).catch(async () => {
      console.log("BODY:", (await page.innerText("body")).slice(0, 600), page.url());
      throw new Error("no home mixes");
    });
    const mixes = await page.$$eval("[data-mix]", (nodes) => nodes.map((n) => (n as HTMLElement).dataset.mix));
    console.log("home mixes:", mixes.join(", "));
    expect(mixes.slice(0, 2)).toEqual(["daily-mix-for-you", "daily-mix-discover"]);
    console.log(await live.shoot(STEP, "home", "mixes", { looks: [LIGHT, DARK], sizes: [W1200] }));

    await live.setLook(LIGHT);
    await playing(live, 5, { kind: "session", name: "Teardrop" });
    console.log(await live.shoot(STEP, "bar", "reason", { looks: [LIGHT, DARK], sizes: [W1200] }));

    for (const [locale, index] of [
      ["en", 2],
      ["ru", 3],
    ] as const) {
      await page.evaluate((value) => localStorage.setItem("nuvo_locale", value), locale);
      await live.setLook(LIGHT);
      await playing(live, index, null);
      await live.setSize(W1100);
      await page.locator("[data-island] button").first().dispatchEvent("contextmenu", { clientX: 120, clientY: 600, bubbles: true, cancelable: true });
      await page.waitForSelector('[role="menuitem"]');
      const item = page.locator('[role="menuitem"]').last();
      await item.click();
      await page.waitForSelector("[data-state-line]");
      await page.waitForTimeout(600);
      const zone = await leftZone(live);
      console.log(locale, JSON.stringify(zone));
      expect(zone.titleClipped, `${locale}: the long title ellipsizes`).toBe(true);
      expect(zone.actions.length).toBeGreaterThan(0);
      for (const action of zone.actions) {
        expect(action.clipped, `${locale}: ${action.text} keeps its whole word`).toBe(false);
        expect(action.left, `${locale}: ${action.text} clears the like button`).toBeGreaterThanOrEqual(zone.like!.right);
        expect(action.right, `${locale}: ${action.text} stays left of the transport`).toBeLessThanOrEqual(zone.centreLeft);
      }
      expect(zone.like!.right).toBeLessThanOrEqual(zone.nowRight);
      console.log(await live.shoot(STEP, "bar", `notice-${locale}`, { looks: [LIGHT], sizes: [W1100], prepare: async () => undefined }));
    }
  }, 600_000);
});
