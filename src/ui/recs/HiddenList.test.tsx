// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { HiddenList } from "./HiddenList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ suppressions: vi.fn(), undo: vi.fn(), excluded: null as string[] | null, include: vi.fn(async () => undefined) }));
vi.mock("../ports/recs", () => ({
  recs: { suppressions: mocks.suppressions, undo: mocks.undo },
  useExcludedPlaylists: () => mocks.excluded,
  setPlaylistExcluded: mocks.include,
}));
vi.mock("../ports/library", () => ({
  usePlaylistsList: () => ({
    data: {
      playlists: [
        { id: "p1", title: "Gym", coverUrl: "", coverUrls: [] },
        { id: "p2", title: "Sleep", coverUrl: "", coverUrls: [] },
      ],
    },
  }),
}));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: () => [] }));
vi.mock("../ports/covers", () => ({ coverSrc: (src: string) => src }));

const track = (id: string) => ({ id, title: `Song ${id}`, artists: `Artist ${id}`, coverUrl: "", durationMs: 1 });
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.excluded = null;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const buttons = (text: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent === text);

describe("HiddenList", () => {
  it("lists what is hidden and shows a row again on Undo", async () => {
    mocks.suppressions.mockResolvedValue([
      { id: 1, scope: "work", origin: "user", track: track("a"), fadesAt: null },
      { id: 2, scope: "exact", origin: "user", track: track("b"), fadesAt: null },
    ]);
    mocks.undo.mockResolvedValue(true);
    await act(async () => root.render(<HiddenList />));
    expect(host.textContent).toContain("Song a");
    await act(async () => buttons("ui.recs.hidden.undo")[0].click());
    expect(mocks.undo).toHaveBeenCalledWith(1);
    expect(host.textContent).not.toContain("Song a");
    expect(host.textContent).toContain("Song b");
  });

  it("says when nothing is hidden", async () => {
    mocks.suppressions.mockResolvedValue([]);
    await act(async () => root.render(<HiddenList />));
    expect(host.textContent).toContain("ui.recs.hidden.empty");
  });

  it("says when the list cannot be read, and when an Undo fails", async () => {
    mocks.suppressions.mockResolvedValueOnce("unavailable");
    await act(async () => root.render(<HiddenList />));
    expect(host.textContent).toContain("ui.recs.hidden.failed");
    act(() => root.unmount());
    root = createRoot(host);
    mocks.suppressions.mockResolvedValueOnce([{ id: 3, scope: "exact", origin: "user", track: track("c"), fadesAt: null }]);
    mocks.undo.mockResolvedValue("locked");
    await act(async () => root.render(<HiddenList />));
    await act(async () => buttons("ui.recs.hidden.undo")[0].click());
    expect(host.textContent).toContain("Song c");
    expect(host.textContent).toContain("ui.recs.notice.undo_failed");
  });

  it("lists the playlists left out of recommendations, each with Use again", async () => {
    mocks.suppressions.mockResolvedValue([]);
    mocks.excluded = ["p1"];
    await act(async () => root.render(<HiddenList />));
    expect(host.textContent).toContain("ui.recs.excluded.title");
    expect(host.textContent).toContain("Gym");
    expect(host.textContent).not.toContain("Sleep");
    await act(async () => buttons("ui.recs.excluded.undo")[0].click());
    expect(mocks.include).toHaveBeenCalledWith("p1", false);
  });

  it("explains where a playlist is left out while none is", async () => {
    mocks.suppressions.mockResolvedValue([]);
    mocks.excluded = [];
    await act(async () => root.render(<HiddenList />));
    expect(host.textContent).toContain("ui.recs.excluded.empty");
  });
});
