// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceSheetHost, useSourceSheet } from "./SourceSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = { id: "aaaaaaaaaaa", title: "Song", artists: "Band", coverUrl: "", durationMs: 200_000 };
const live = { id: "bbbbbbbbbbb", title: "Song (Live)", artists: "Band", coverUrl: "", durationMs: 240_000 };
const mocks = vi.hoisted(() => ({ choose: vi.fn(async () => undefined), chosen: vi.fn(), search: vi.fn() }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../ports/player", () => ({ chooseSource: mocks.choose, chosenSource: mocks.chosen }));
vi.mock("../ports/search", () => ({ useSearchTracks: mocks.search }));

let root: Root;

beforeEach(() => {
  mocks.search.mockReturnValue({ tracks: [song, live], loading: false });
  mocks.chosen.mockResolvedValue(null);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<SourceSheetHost />));
});
afterEach(() => {
  act(() => useSourceSheet.getState().close());
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-source-row]")];
const open = () => act(async () => useSourceSheet.getState().open(song));

describe("Choose source", () => {
  it("lists the song's own source, ticked, and the other versions the catalog finds", async () => {
    await open();
    expect(mocks.search).toHaveBeenCalledWith("Band Song", expect.anything());
    expect(rows().map((row) => row.textContent?.includes("Song (Live)"))).toEqual([false, true]);
    expect(rows()[0].querySelector("svg")).not.toBeNull();
    act(() => rows()[1].click());
    expect(mocks.choose).toHaveBeenCalledWith(song.id, { id: live.id, durationMs: 240_000 });
    expect(useSourceSheet.getState().track).toBeNull();
  });

  it("ticks a chosen version and goes back to the original", async () => {
    mocks.chosen.mockResolvedValue({ source: "youtube", altId: live.id, reason: "pinned" });
    await open();
    expect(rows()[0].querySelector("svg")).toBeNull();
    expect(rows()[1].querySelector("svg")).not.toBeNull();
    act(() => rows()[0].click());
    expect(mocks.choose).toHaveBeenCalledWith(song.id, null);
  });
});
