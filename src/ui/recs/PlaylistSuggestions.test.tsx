// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { PlaylistSuggestions } from "./PlaylistSuggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ suggest: vi.fn(), play: vi.fn(), mark: vi.fn(() => Promise.resolve()), dislike: vi.fn() }));
vi.mock("../ports/recs", () => ({ suggest: mocks.suggest, playSuggestions: mocks.play }));
vi.mock("./notInterested", () => ({ markNotInterested: mocks.mark, songMenuNotInterested: mocks.dislike }));
vi.mock("../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key) }),
}));
vi.mock("../ports/covers", () => ({ coverSrc: (src: string) => src }));

const pick = (id: string, reason?: { kind: string; name?: string }) => ({
  id,
  title: `Song ${id}`,
  artists: `Artist ${id}`,
  coverUrl: "",
  durationMs: 1000,
  ...(reason ? { reason } : {}),
});
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const byText = (text: string) => [...document.body.querySelectorAll<HTMLElement>("*")].find((el) => el.textContent === text && el.children.length === 0)!;
const labelled = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)];

describe("PlaylistSuggestions", () => {
  it("lists picks with their reason, leaves out what the playlist has, adds and plays", async () => {
    mocks.suggest.mockResolvedValue([pick("a", { kind: "similar", name: "Roygbiv" }), pick("t1"), pick("b")]);
    const onAdd = vi.fn(() => Promise.resolve());
    await act(async () => root.render(<PlaylistSuggestions playlistId="p1" trackIds={["t1", "t2"]} onAdd={onAdd} />));
    expect(mocks.suggest).toHaveBeenCalledWith("p1", ["t1", "t2"]);
    expect(host.textContent).toContain("Artist a · ui.recs.reason.similar(Roygbiv)");
    expect(host.textContent).not.toContain("Song t1");
    await act(async () => labelled("ui.recs.suggest.add")[0].click());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    act(() => byText("Song b").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.play).toHaveBeenCalledWith("p1", [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })], 1);
  });

  it("an added pick leaves the list once the playlist holds it, without asking again", async () => {
    mocks.suggest.mockResolvedValue([pick("a"), pick("b")]);
    await act(async () => root.render(<PlaylistSuggestions playlistId="p1" trackIds={["t1"]} onAdd={() => Promise.resolve()} />));
    await act(async () => root.render(<PlaylistSuggestions playlistId="p1" trackIds={["t1", "a"]} onAdd={() => Promise.resolve()} />));
    expect(host.textContent).not.toContain("Song a");
    expect(host.textContent).toContain("Song b");
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
  });

  it("a dislike drops a pick at once, the row's menu keeps the other choices, and Refresh asks again", async () => {
    mocks.suggest.mockResolvedValueOnce([pick("a"), pick("b"), pick("d")]).mockResolvedValueOnce([pick("c")]);
    await act(async () => root.render(<PlaylistSuggestions playlistId="p1" trackIds={["t1"]} onAdd={() => Promise.resolve()} />));
    await act(async () => labelled("ui.recs.dislike")[0].click());
    expect(mocks.dislike).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "exact");
    expect(host.textContent).not.toContain("Song a");
    const row = [...host.querySelectorAll("[data-track-row]")].find((node) => node.textContent?.includes("Song b"))!;
    act(() => void row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await act(async () => byText("ui.recs.menu.work").click());
    expect(mocks.mark).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }), "work");
    await act(async () => byText("ui.recs.suggest.refresh").click());
    expect(mocks.suggest).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Song c");
  });

  it("shows nothing when there is nothing to suggest", async () => {
    mocks.suggest.mockResolvedValue([]);
    await act(async () => root.render(<PlaylistSuggestions playlistId="p1" trackIds={["t1"]} onAdd={() => Promise.resolve()} />));
    expect(host.textContent).toBe("");
  });
});
