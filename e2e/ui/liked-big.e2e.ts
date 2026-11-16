import { afterAll, describe, expect, it } from "vitest";
import { launchNuvo, passFirstRun, type NuvoSession } from "./harness";

const LIKED = 650;

let session: NuvoSession | null = null;

afterAll(async () => {
  await session?.close();
});

describe("Liked songs", () => {
  it("counts and lists every liked song, not just the first page", { timeout: 300_000 }, async () => {
    session = await launchNuvo({ profile: "fresh" });
    const live = session;
    await passFirstRun(live.page);
    await live.core(
      `for (let i = 0; i < ${LIKED}; i += 1) {
         const id = "liked-big-" + String(i).padStart(4, "0");
         const track = { id, title: "Liked song " + i, artists: ["Artist " + i], durationMs: 180000, coverUrl: "" };
         const res = await fetch(base + "/v1/me/library/tracks/" + id, { method: "PUT", headers: json, body: JSON.stringify({ track }) });
         if (!res.ok) throw new Error("like " + res.status);
       }`,
    );
    await live.page.reload();
    await live.page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
    await live.go("#/library/playlist?id=likes");

    await live.page.getByText(`${LIKED} tracks`).first().waitFor({ timeout: 30_000 });
    await live.page.getByText(`Liked song ${LIKED - 1}`, { exact: true }).waitFor({ timeout: 10_000 });
    await live.page.evaluate(
      (top) => {
        const row = [...document.querySelectorAll("*")].find((node) => node.childElementCount === 0 && node.textContent === top);
        let scroller: HTMLElement | null = row instanceof HTMLElement ? row : null;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "visible")) {
          scroller = scroller.parentElement;
        }
        if (!scroller) throw new Error("no scroller");
        scroller.scrollTop = scroller.scrollHeight;
      },
      `Liked song ${LIKED - 1}`,
    );
    // the first song liked is the oldest, so it closes the list
    await live.page.getByText("Liked song 0", { exact: true }).waitFor({ timeout: 10_000 });
    expect(await live.page.getByText(`${LIKED} tracks`).count()).toBeGreaterThan(0);
  });
});
