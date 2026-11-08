// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { useEffectsStore } from "../effects";
import { activeNav, ENTITY_ROUTES, isEntityRoute, navigateWithTransition } from "./navigate";

type Doc = { startViewTransition?: unknown };

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  delete (document as unknown as Doc).startViewTransition;
  document.documentElement.removeAttribute("data-page-transition");
  useEffectsStore.setState({ reduce: false });
});

describe("activeNav", () => {
  it("maps every route to its top bar item", () => {
    expect(activeNav("/")).toBe("home");
    expect(activeNav("/library")).toBe("library");
    expect(activeNav("/library/playlist")).toBe("library");
    expect(activeNav("/artist")).toBe("library");
    expect(activeNav("/collection")).toBe("library");
    expect(activeNav("/search")).toBe("search");
    expect(activeNav("/recognize")).toBe("recognize");
    expect(activeNav("/player")).toBeNull();
    expect(activeNav("/specimen")).toBeNull();
  });
});

describe("isEntityRoute", () => {
  it("is true for playlist, artist, collection and statistics drill-down pages only", () => {
    expect(ENTITY_ROUTES).toEqual(["/library/playlist", "/artist", "/collection", "/stats/track", "/stats/artist"]);
    for (const route of ENTITY_ROUTES) expect(isEntityRoute(route)).toBe(true);
    expect(isEntityRoute("/")).toBe(false);
    expect(isEntityRoute("/library")).toBe(false);
    expect(isEntityRoute("/player")).toBe(false);
    expect(isEntityRoute("/stats")).toBe(false);
    expect(activeNav("/stats/track")).toBe("stats");
  });
});

describe("navigateWithTransition", () => {
  it("wraps the navigation in a view transition when motion is allowed", async () => {
    mockReducedMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const start = vi.fn((update: () => void) => {
      update();
      return { finished };
    });
    (document as unknown as Doc).startViewTransition = start;
    const navigate = vi.fn();

    navigateWithTransition(navigate, "/library");

    expect(start).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/library");
    expect(document.documentElement.hasAttribute("data-page-transition")).toBe(true);
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute("data-page-transition")).toBe(false);
  });

  it("navigates at once without view transitions", () => {
    mockReducedMotion(false);
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("navigates at once under reduced motion", () => {
    mockReducedMotion(true);
    const start = vi.fn();
    (document as unknown as Doc).startViewTransition = start;
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/library");
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/library");
  });

  it("navigates at once while Reduce effects is on", () => {
    mockReducedMotion(false);
    useEffectsStore.setState({ reduce: true });
    const start = vi.fn();
    (document as unknown as Doc).startViewTransition = start;
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/search");
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/search");
  });
});
