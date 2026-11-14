import { beforeEach, describe, expect, it } from "vitest";
import { settingsStorage } from "../ports/tour";
import { CHAPTER_IDS, stepCount } from "./chapters";
import { TOUR_KEY, lastStep, useTour, waiting } from "./tourStore";

const tour = () => useTour.getState();

function saved(): { status: string; at: unknown; missed: string[] } {
  settingsStorage.flush();
  return JSON.parse(localStorage.getItem(TOUR_KEY) ?? "{}").state;
}

async function relaunch() {
  settingsStorage.flush();
  const kept = localStorage.getItem(TOUR_KEY);
  useTour.setState({ ...useTour.getInitialState() });
  settingsStorage.removeItem(TOUR_KEY);
  if (kept) localStorage.setItem(TOUR_KEY, kept);
  await useTour.persist.rehydrate();
}

beforeEach(() => {
  settingsStorage.flush();
  localStorage.clear();
  useTour.setState({ ...useTour.getInitialState() });
});

describe("tour store", () => {
  it("starts on the welcome poster after the first run, with the read gates on", () => {
    tour().start();
    expect(tour().phase).toBe("poster");
    expect(tour().poster).toBe("start");
    expect(tour().gated).toBe(true);
    expect(saved().status).toBe("on");
  });

  it("walks every step of every chapter, then finishes and remembers it", () => {
    tour().start();
    tour().watch();
    expect(tour().phase).toBe("chapter");
    const total = CHAPTER_IDS.reduce((sum, id) => sum + stepCount(id), 0);
    for (let at = 1; at < total; at += 1) tour().next();
    expect(lastStep(tour())).toBe(true);
    tour().next();
    expect(tour().phase).toBe("off");
    expect(saved()).toMatchObject({ status: "done", at: null });
  });

  it("plays every chapter again from Settings after it was done, without the read gates", () => {
    tour().start();
    tour().watch();
    tour().next();
    tour().finish();
    useTour.setState({ missed: ["player"] });
    tour().replay();
    expect(tour()).toMatchObject({ phase: "chapter", chapterIds: CHAPTER_IDS, chapter: 0, step: 0, gated: false, missed: [] });
    expect(saved().status).toBe("on");
  });

  it("goes back across a chapter edge to the last step of the one before", () => {
    tour().start();
    tour().watch();
    tour().next();
    tour().next();
    expect(tour().chapter).toBe(1);
    tour().back();
    expect(tour().chapter).toBe(0);
    expect(tour().step).toBe(stepCount(CHAPTER_IDS[0]) - 1);
  });

  it("holds Next once per chapter on the first run, never on a revisit", () => {
    tour().start();
    tour().watch();
    expect(waiting(tour())).toBe(true);
    tour().markRead();
    expect(waiting(tour())).toBe(false);
    tour().skipChapter();
    expect(waiting(tour())).toBe(true);
    tour().back();
    expect(waiting(tour())).toBe(false);
  });

  it("skips one chapter from the prompt", () => {
    tour().start();
    tour().watch();
    tour().openPrompt();
    tour().skipChapter();
    expect(tour().prompt).toBe(false);
    expect(tour().chapterIds[tour().chapter]).toBe(CHAPTER_IDS[1]);
    expect(tour().step).toBe(0);
  });

  it("skips the whole tour into the short version, which ends it", () => {
    tour().start();
    tour().watch();
    tour().openPrompt();
    tour().toBrief();
    expect(tour().phase).toBe("brief");
    tour().finish();
    expect(tour().phase).toBe("off");
    expect(saved().status).toBe("done");
  });

  it("finishes later: the next launch offers to resume at the same step", async () => {
    tour().start();
    tour().watch();
    tour().next();
    tour().next();
    tour().later();
    expect(tour().phase).toBe("off");
    expect(saved()).toMatchObject({ status: "later", at: { chapter: CHAPTER_IDS[1], step: 0 } });

    await relaunch();
    tour().restore();
    expect(tour().phase).toBe("poster");
    expect(tour().poster).toBe("resume");
    tour().watch();
    expect(tour().chapterIds[tour().chapter]).toBe(CHAPTER_IDS[1]);
    expect(tour().step).toBe(0);
  });

  it("resumes a tour the window was closed in the middle of", async () => {
    tour().start();
    tour().watch();
    tour().next();
    await relaunch();
    tour().restore();
    expect(tour().poster).toBe("resume");
  });

  it("brings the start step back when the window was closed on it", async () => {
    tour().start();
    await relaunch();
    tour().restore();
    expect(tour()).toMatchObject({ phase: "poster", poster: "start" });
  });

  it("does not come back after it was finished or never started", async () => {
    tour().restore();
    expect(tour().phase).toBe("off");
    tour().start();
    tour().toBrief();
    tour().finish();
    await relaunch();
    tour().restore();
    expect(tour().phase).toBe("off");
  });

  it("passes over a step whose target is missing in the direction of travel", () => {
    tour().start();
    tour().watch();
    tour().next();
    tour().missing();
    expect(tour().chapter).toBe(1);
    tour().back();
    tour().missing();
    expect(tour().chapter).toBe(0);
    expect(tour().step).toBe(0);
  });

  it("leaves out a chapter with nothing to show, keeps it for later, and offers it once", async () => {
    tour().start();
    tour().watch();
    tour().skipChapter();
    tour().skipChapter();
    expect(tour().chapterIds[tour().chapter]).toBe("player");
    tour().missingChapter();
    expect(tour().chapterIds[tour().chapter]).toBe("sound");
    tour().finish();
    expect(saved().missed).toEqual(["player"]);

    await relaunch();
    tour().offerMore();
    expect(tour().poster).toBe("more");
    tour().watch();
    expect(tour().chapterIds).toEqual(["player"]);
    expect(tour().gated).toBe(false);
    tour().next();
    tour().next();
    tour().next();
    tour().next();
    expect(tour().phase).toBe("off");
    expect(saved().missed).toEqual([]);
  });

  it("forgets the left-out chapters when the offer is declined", () => {
    useTour.setState({ status: "done", missed: ["player"] });
    tour().offerMore();
    tour().decline();
    expect(tour().phase).toBe("off");
    expect(saved().missed).toEqual([]);
  });

  it("a missing first step going back turns forward instead of stopping", () => {
    tour().start();
    tour().watch();
    tour().back();
    tour().missing();
    expect(tour().chapter).toBe(0);
    expect(tour().step).toBe(1);
  });
});
