// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtistLinks } from "./ArtistLinks";
import { bindNavigate } from "./navigate";

const warmArtist = vi.hoisted(() => vi.fn());
vi.mock("../ports/catalog", () => ({ warmArtist }));
vi.mock("../ports/player", () => ({ usePlayerStore: { getState: () => ({ setFullscreen: vi.fn() }) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRACK = {
  artists: "Daft Punk, Pharrell",
  artistList: [
    { id: "UC1", name: "Daft Punk" },
    { id: "unknown", name: "Pharrell" },
  ],
};
let root: Root;
let host: HTMLDivElement;
const go = vi.fn();
const rowClick = vi.fn();
const links = () => [...host.querySelectorAll<HTMLElement>("[data-artist-link]")];
const fire = (target: Element, event: Event) => act(() => void target.dispatchEvent(event));

beforeEach(() => {
  vi.useFakeTimers();
  go.mockReset();
  rowClick.mockReset();
  warmArtist.mockReset();
  bindNavigate(go);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <div onClick={rowClick}>
        <ArtistLinks track={TRACK} />
      </div>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("reads like the plain line and opens each artist without activating the row", () => {
  expect(host.textContent).toBe("Daft Punk, Pharrell");
  for (const link of links()) fire(link, new MouseEvent("click", { bubbles: true }));
  expect(go.mock.calls.map(([href]) => href)).toEqual(["/artist?id=UC1&name=Daft+Punk", "/artist?name=Pharrell"]);
  expect(rowClick).not.toHaveBeenCalled();
});

it("loads an artist the pointer rests on, not one it passes", () => {
  const [known, unknown] = links();
  fire(known, new MouseEvent("pointerover", { bubbles: true }));
  fire(known, new MouseEvent("pointerout", { bubbles: true }));
  fire(unknown, new MouseEvent("pointerover", { bubbles: true }));
  vi.runAllTimers();
  expect(warmArtist).not.toHaveBeenCalled();
  fire(known, new MouseEvent("pointerover", { bubbles: true }));
  vi.runAllTimers();
  expect(warmArtist).toHaveBeenCalledExactlyOnceWith("UC1");
});
