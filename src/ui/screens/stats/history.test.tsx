// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { History } from "./History";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ history: vi.fn(), play: vi.fn() }));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/stats", () => ({ listeningHistory: mocks.history }));
vi.mock("../../ports/player", () => ({ playerEngine: { playTrack: mocks.play }, usePlayerStore: () => null }));
vi.mock("./StatsRows", () => ({ useSongMenu: () => ({ open: vi.fn(), layers: null }) }));

const track = (id: string) => ({ id, title: `Song ${id}`, artists: `Artist ${id}`, coverUrl: "", durationMs: 1000, playCount: 0 });
const at = (daysAgo: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.history.mockReset();
  mocks.play.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    ),
  );
const button = (name: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === name)!;
const titles = () => [...host.querySelectorAll("h2")].map((node) => node.textContent);
const rows = () => [...host.querySelectorAll<HTMLElement>("[data-history-row]")];

describe("History", () => {
  it("lists plays by day, filters to skipped ones, shows earlier plays and plays a row", async () => {
    mocks.history
      .mockResolvedValueOnce({
        items: [
          { id: "3", track: track("c"), listenedAt: at(0, 10), skipped: false },
          { id: "2", track: track("b"), listenedAt: at(1, 22), skipped: true },
        ],
        next: "2",
      })
      .mockResolvedValueOnce({ items: [{ id: "1", track: track("a"), listenedAt: at(1, 8), skipped: false }], next: null });
    await render();
    expect(mocks.history).toHaveBeenCalledWith("all", null, expect.any(AbortSignal));
    expect(titles()).toEqual(["ui.history.today", "ui.history.yesterday"]);
    expect(rows()[1].textContent).toContain("ui.history.skipped");

    await act(async () => button("ui.history.more").click());
    expect(mocks.history).toHaveBeenLastCalledWith("all", "2");
    expect(rows()).toHaveLength(3);
    expect(button("ui.history.more")).toBeUndefined();

    act(() => void rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.play).toHaveBeenCalledWith(track("c"), [track("c")], "history", "");

    mocks.history.mockResolvedValueOnce({ items: [], next: null });
    await act(async () => button("ui.history.filter_skipped").click());
    expect(mocks.history).toHaveBeenLastCalledWith("skipped", null, expect.any(AbortSignal));
    expect(host.textContent).toContain("ui.history.empty_filter");
  });
});
