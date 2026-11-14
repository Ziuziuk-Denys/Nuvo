// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useGateStore } from "../screens/lock/gateState";
import { TourLayer } from "./TourLayer";
import { useTour } from "./tourStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ports/search", () => ({ useSearchAll: () => ({ items: [], loading: false, hasLoaded: false }), toSearchResult: (item: unknown) => item }));
vi.mock("../ports/network", () => ({ useStreamingReachable: () => true }));
vi.mock("../ports/importSources", () => ({ IMPORT_SOURCES: ["spotify", "soundcloud"], openImportSheet: () => Promise.resolve() }));
vi.mock("../ports/recs", () => ({ seedFavorites: () => Promise.resolve() }));
vi.mock("../ports/navigation", () => ({
  useModalStore: { getState: () => ({ closeSettings: () => undefined, closeSearch: () => undefined, openSettingsSection: () => undefined }) },
}));

let root: Root;
let host: HTMLDivElement;

const layer = () => document.querySelector("[data-tour-layer]");
const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label);
const press = (key: string) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

beforeEach(() => {
  localStorage.clear();
  useTour.setState({ ...useTour.getInitialState() });
  useGateStore.setState({ locked: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter>
        <TourLayer />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("TourLayer", () => {
  it("draws nothing until the tour starts", () => {
    expect(layer()).toBeNull();
  });

  it("opens on the start step: the welcome, the import services and the favourites field, Take the tour focused", async () => {
    act(() => useTour.getState().start());
    expect(layer()?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("#tour-start-title")?.textContent).toBe("ui.tour.poster.title");
    expect(document.querySelectorAll("[data-source]")).toHaveLength(2);
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("ui.tour.start.taste_placeholder");
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(document.activeElement?.textContent).toBe("ui.tour.start.skip_now");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(useTour.getState().phase).toBe("chapter");
  });

  it("Esc on the welcome takes the short version, as Skip does", () => {
    act(() => useTour.getState().start());
    press("Escape");
    expect(useTour.getState().phase).toBe("brief");
    expect(document.querySelector("#tour-brief-title")).not.toBeNull();
  });

  it("keeps keys from the window under it", () => {
    const heard = vi.fn();
    document.addEventListener("keydown", heard);
    act(() => useTour.getState().start());
    press("k");
    expect(heard).not.toHaveBeenCalled();
    document.removeEventListener("keydown", heard);
  });

  it("Esc in a chapter asks first; Finish later closes the tour and saves the place", () => {
    act(() => {
      useTour.getState().start();
      useTour.getState().watch();
    });
    press("Escape");
    expect(useTour.getState().prompt).toBe(true);
    press("Escape");
    expect(useTour.getState().prompt).toBe(false);
    act(() => button("ui.tour.skip")!.click());
    act(() => button("ui.tour.prompt.laterui.tour.prompt.later_line")!.click());
    expect(useTour.getState()).toMatchObject({ phase: "off", status: "later", at: { chapter: "search", step: 0 } });
  });

  it("holds Next and the arrow key while the first step of a chapter is being read", () => {
    act(() => {
      useTour.getState().start();
      useTour.getState().watch();
    });
    const next = document.querySelector("[data-next]");
    expect(next?.getAttribute("aria-disabled")).toBe("true");
    act(() => (next as HTMLButtonElement).click());
    press("ArrowRight");
    expect(useTour.getState().step).toBe(0);
  });

  it("stays hidden over the lock screen", () => {
    act(() => {
      useGateStore.setState({ locked: true });
      useTour.getState().start();
    });
    expect(layer()).toBeNull();
  });
});
