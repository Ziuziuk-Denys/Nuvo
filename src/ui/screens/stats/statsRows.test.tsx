// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SongRows } from "./StatsRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ play: vi.fn(), gone: new Set<string>() }));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/stats", () => ({ rowTrack: (track: unknown) => track }));
vi.mock("../../ports/player", () => ({ playerEngine: { playTrack: mocks.play }, usePlayerStore: () => null }));
vi.mock("../../ports/exports", () => ({ saveAsFiles: vi.fn() }));
vi.mock("../../ports/localFiles", () => ({ revealLocalTrack: vi.fn() }));
vi.mock("../../recs/notInterested", () => ({ songMenuNotInterested: vi.fn() }));
vi.mock("../lyrics/lyricsTools", () => ({ openLyricsTool: vi.fn() }));
vi.mock("../../shell/popovers/AddToPlaylistPopover", () => ({ AddToPlaylistPopover: () => null }));
vi.mock("../entity/EntityTracks", () => ({ useUnavailable: () => (track: { id: string }) => (mocks.gone.has(track.id) ? "gone" : null) }));

const track = (id: string) => ({ id, title: `Song ${id}`, artists: `Artist ${id}`, coverUrl: "", durationMs: 1000, playCount: 0 });
const row = (id: string, rank: number) => ({ id, rank, title: `Song ${id}`, subtitle: `Artist ${id}`, coverUrl: "", track: track(id) });

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.play.mockReset();
  mocks.gone.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () =>
  act(() =>
    root.render(
      <MemoryRouter>
        <SongRows rows={[row("a", 1), row("b", 2), row("c", 3)] as never} meta={() => ""} />
      </MemoryRouter>,
    ),
  );
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-stats-row] [role="button"]')];
const click = (node: HTMLElement, detail: number) => act(() => void node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail })));

describe("SongRows", () => {
  it("one click on a row plays it among the playable songs, once even when double clicked", () => {
    mocks.gone.add("c");
    render();
    click(rows()[1], 1);
    click(rows()[1], 2);
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b" }),
      [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })],
      "stats",
      "",
    );
  });

  it("a song that cannot play does not start on a click", () => {
    mocks.gone.add("c");
    render();
    click(host.querySelectorAll<HTMLElement>("[data-stats-row] > div")[2], 1);
    expect(mocks.play).not.toHaveBeenCalled();
  });
});
