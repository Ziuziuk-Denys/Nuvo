// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { useEffectsStore } from "../effects";
import { activeNav, ENTITY_ROUTES, isEntityRoute, navigateWithTransition } from "./navigate";

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function mountPage(): { animate: ReturnType<typeof vi.fn> } {
  const page = document.createElement("div");
  page.setAttribute("data-page", "");
  const animate = vi.fn();
  page.animate = animate as unknown as HTMLElement["animate"];
  document.body.append(page);
  return { animate };
}

afterEach(() => {
  document.body.replaceChildren();
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
  it("navigates, then lets the new page rise in on the live document so the glass above it stays real", () => {
    mockReducedMotion(false);
    const { animate } = mountPage();
    const navigate = vi.fn();

    navigateWithTransition(navigate, "/library");

    expect(navigate).toHaveBeenCalledWith("/library");
    expect(animate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(animate.mock.invocationCallOrder[0]);
  });

  it("navigates without a page to animate", () => {
    mockReducedMotion(false);
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("navigates at once under reduced motion", () => {
    mockReducedMotion(true);
    const { animate } = mountPage();
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/library");
    expect(animate).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/library");
  });

  it("navigates at once while Reduce effects is on", () => {
    mockReducedMotion(false);
    useEffectsStore.setState({ reduce: true });
    const { animate } = mountPage();
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/search");
    expect(animate).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/search");
  });
});
