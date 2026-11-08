// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { StartStep } from "./StartStep";
import { useTour } from "./tourStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  seed: vi.fn(),
  closeSheet: null as null | (() => void),
  openSheet: vi.fn(),
  results: [] as { kind: string; id: string; title: string; subtitle: string; cover: string }[],
}));

vi.mock("../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
}));
vi.mock("../ports/network", () => ({ useStreamingReachable: () => true }));
vi.mock("../ports/recs", () => ({ seedFavorites: mocks.seed }));
vi.mock("../ports/importSources", () => ({
  IMPORT_SOURCES: ["spotify", "apple", "deezer", "youtube", "soundcloud"],
  openImportSheet: (source: string) => {
    mocks.openSheet(source);
    return new Promise<void>((done) => {
      mocks.closeSheet = done;
    });
  },
}));
vi.mock("../ports/search", () => ({
  useSearchAll: (query: string) => ({ items: query.trim().length >= 2 ? mocks.results : [], loading: false, hasLoaded: true }),
  toSearchResult: (item: unknown) => item,
}));

let root: Root;
let host: HTMLDivElement;
const onContinue = vi.fn();
const onSkipTour = vi.fn();

const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
const input = () => host.querySelector("input")!;

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  useTour.setState({ ...useTour.getInitialState() });
  mocks.seed.mockResolvedValue(undefined);
  mocks.results = [
    { kind: "artist", id: "a1", title: "Massive Attack", subtitle: "", cover: "" },
    { kind: "song", id: "s1", title: "Teardrop", subtitle: "Massive Attack", cover: "" },
    { kind: "album", id: "al1", title: "Mezzanine", subtitle: "", cover: "" },
    { kind: "song", id: "s2", title: "Angel", subtitle: "Massive Attack", cover: "" },
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<StartStep onContinue={onContinue} onSkipTour={onSkipTour} />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("StartStep", () => {
  it("offers the five import services by name", () => {
    expect([...host.querySelectorAll("[data-source]")].map((item) => item.getAttribute("data-source"))).toEqual([
      "spotify",
      "apple",
      "deezer",
      "youtube",
      "soundcloud",
    ]);
  });

  it("steps the tour aside while an import sheet is open and comes back to Continue", async () => {
    act(() => host.querySelector<HTMLButtonElement>("[data-source=spotify]")!.click());
    expect(mocks.openSheet).toHaveBeenCalledWith("spotify");
    expect(useTour.getState().away).toBe(true);
    await act(async () => {
      mocks.closeSheet?.();
      await Promise.resolve();
    });
    expect(useTour.getState().away).toBe(false);
    expect(button("ui.tour.start.continue")).toBeDefined();
  });

  it("suggests songs and artists only, and takes three picks before sending them as seeds", async () => {
    type("mas");
    const suggestions = [...host.querySelectorAll('[aria-label="ui.tour.start.taste_suggestions"] b')].map((item) => item.textContent);
    expect(suggestions).toEqual(["Massive Attack", "Teardrop", "Angel"]);
    act(() => button("Massive AttackArtist".replace("Artist", "ui.tour.start.artist"))!.click());
    expect(input().value).toBe("");
    const use = () => button("ui.tour.start.taste_use") as HTMLButtonElement;
    expect(use().disabled).toBe(true);

    type("mas");
    act(() => button("TeardropMassive Attack")!.click());
    type("mas");
    act(() => button("AngelMassive Attack")!.click());
    expect(use().disabled).toBe(false);

    await act(async () => {
      use().click();
      await Promise.resolve();
    });
    expect(mocks.seed).toHaveBeenCalledWith([
      { kind: "artist", id: "a1", title: "Massive Attack" },
      { kind: "song", id: "s1", title: "Teardrop" },
      { kind: "song", id: "s2", title: "Angel" },
    ]);
    expect(host.textContent).toContain("ui.tour.start.taste_done");
    expect(useTour.getState().started).toBe(true);
  });

  it("a removed pick leaves the list and Use these waits again", () => {
    for (const label of ["Massive Attackui.tour.start.artist", "TeardropMassive Attack", "AngelMassive Attack"]) {
      type("mas");
      act(() => button(label)!.click());
    }
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="ui.tour.start.remove"]')!.click());
    expect((button("ui.tour.start.taste_use") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when sending failed and keeps the picks", async () => {
    mocks.seed.mockRejectedValueOnce(new Error("down"));
    for (const label of ["Massive Attackui.tour.start.artist", "TeardropMassive Attack", "AngelMassive Attack"]) {
      type("mas");
      act(() => button(label)!.click());
    }
    await act(async () => {
      (button("ui.tour.start.taste_use") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("ui.tour.start.taste_failed");
    expect(host.querySelectorAll('[aria-label^="ui.tour.start.remove"]')).toHaveLength(3);
  });

  it("Skip for now goes on with the tour, Skip the tour leaves it", () => {
    act(() => button("ui.tour.start.skip_now")!.click());
    expect(onContinue).toHaveBeenCalledOnce();
    act(() => button("ui.tour.poster.finish")!.click());
    expect(onSkipTour).toHaveBeenCalledOnce();
  });
});
