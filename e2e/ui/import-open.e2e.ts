import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, type NuvoSession } from "./harness";

let session: NuvoSession | null = null;
afterAll(async () => {
  await session?.close();
});

async function blockNetwork(live: NuvoSession): Promise<void> {
  await live.page.route(/^https?:\/\/(?!(localhost|127\.0\.0\.1))/, () => new Promise<never>(() => undefined));
}

describe("a playlist that is still importing", () => {
  it("opens from the library and plays the songs already matched", { timeout: 300_000 }, async () => {
    session = await launchNuvo({ profile: "seeded" });
    const live = session;
    await blockNetwork(live);
    await live.core(
      `const rows = Array.from({ length: 20 }, (_, i) => i < 3
         ? { title: "Ready " + i, artists: ["Artist"], track: { id: "ready" + i, title: "Ready " + i, artists: [{ id: "", name: "Artist" }], durationMs: 200000 } }
         : { title: "Wait " + i, artists: ["Artist"] });
       const res = await fetch(base + "/v1/imports", { method: "POST", headers: json, body: JSON.stringify({ source: "deezer", label: "Still coming", rows, target: { kind: "new" } }) });
       if (!res.ok) throw new Error("import " + res.status);`,
    );
    await live.page.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
    await live.page.reload();
    await live.page.waitForLoadState("domcontentloaded");
    await blockNetwork(live);
    await live.go("#/library");

    await live.page
      .getByText(/Importing… \d+ %/)
      .first()
      .waitFor({ timeout: 30_000 });
    await live.page.getByText("Still coming", { exact: true }).first().click();
    await expect.poll(() => live.page.evaluate(() => location.hash)).toContain("#/library/playlist?id=");
    await live.page.getByText("Ready 0", { exact: true }).waitFor({ timeout: 15_000 });
    await live.page.getByText(/17 songs still matching/).waitFor({ timeout: 15_000 });

    await live.page.getByRole("button", { name: "Play all" }).click();
    await expect
      .poll(() =>
        live.page.evaluate(
          () =>
            (window as unknown as { __nuvoPlayer: { engine: { getView(): { current?: { track: { id: string } } } } } }).__nuvoPlayer.engine.getView().current
              ?.track.id,
        ),
      )
      .toBe("ready0");
  });
});
