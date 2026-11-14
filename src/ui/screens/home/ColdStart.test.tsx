// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useTour } from "../../tour/tourStore";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  suppressions: vi.fn(),
  coldStart: vi.fn(),
  openSearch: vi.fn(),
  openSettingsSection: vi.fn(),
  openImportSheet: vi.fn(),
  startFrom: vi.fn(),
  changed: new EventTarget(),
}));
vi.mock("../../ports/recs", () => ({ recs: { suppressions: mocks.suppressions }, recsChanged: mocks.changed }));
vi.mock("../../ports/starters", () => ({ coldStartNeeded: mocks.coldStart, startFromPicks: mocks.startFrom }));
vi.mock("../../ports/network", () => ({ useStreamingReachable: () => true }));
vi.mock("../../ports/importSources", () => ({ IMPORT_SOURCES: ["spotify", "apple"], openImportSheet: mocks.openImportSheet }));
vi.mock("../../ports/navigation", () => ({
  useModalStore: { getState: () => ({ openSearch: mocks.openSearch, openSettingsSection: mocks.openSettingsSection }) },
}));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../recs/TastePicker", () => ({
  TastePicker: ({ start }: { start(picks: unknown[]): Promise<boolean> }) => (
    <button type="button" onClick={() => void start([{ kind: "song", id: "s1", title: "Teardrop" }])}>
      start-with-picks
    </button>
  ),
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.coldStart.mockResolvedValue(false);
  mocks.suppressions.mockResolvedValue([{ suppressionId: 1 }]);
  useTour.setState({ phase: "off" });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

describe("ColdStart", () => {
  it("asks for a few songs or artists when nothing tells the taste yet, then leaves the space to the station's mixes", async () => {
    mocks.coldStart.mockResolvedValue(true);
    mocks.startFrom.mockResolvedValue(true);
    await act(async () => root.render(<ColdStart />));
    await act(async () => button("start-with-picks")!.click());
    expect(mocks.startFrom).toHaveBeenCalledWith([{ kind: "song", id: "s1", title: "Teardrop" }]);
    expect(host.textContent).not.toContain("ui.recs.home.empty_title");
    expect(button("start-with-picks")).toBeUndefined();
  });

  it("stays on the ask when the picks could not be saved", async () => {
    mocks.coldStart.mockResolvedValue(true);
    mocks.startFrom.mockResolvedValue(false);
    await act(async () => root.render(<ColdStart />));
    await act(async () => button("start-with-picks")!.click());
    expect(button("start-with-picks")).toBeDefined();
  });

  it("leaves the ask to the tour's start card while the tour is up", async () => {
    mocks.coldStart.mockResolvedValue(true);
    useTour.setState({ phase: "poster" });
    await act(async () => root.render(<ColdStart />));
    expect(button("start-with-picks")).toBeUndefined();
    expect(host.textContent).toContain("ui.recs.home.empty_title");
    act(() => useTour.setState({ phase: "off" }));
    expect(button("start-with-picks")).toBeDefined();
  });

  it("asks the daemon again when favourites were sent from the tour", async () => {
    mocks.coldStart.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await act(async () => root.render(<ColdStart />));
    expect(button("start-with-picks")).toBeDefined();
    await act(async () => mocks.changed.dispatchEvent(new Event("change")));
    expect(button("start-with-picks")).toBeUndefined();
  });

  it("offers search from the empty state", async () => {
    await act(async () => root.render(<ColdStart />));
    act(() => button("ui.recs.home.search")!.click());
    expect(mocks.openSearch).toHaveBeenCalled();
  });
});

describe("HiddenLink", () => {
  it("opens the hidden list in settings", async () => {
    await act(async () => root.render(<HiddenLink />));
    act(() => button("ui.recs.hidden.open")!.click());
    expect(mocks.openSettingsSection).toHaveBeenCalledWith("hidden");
  });

  it("stays away while nothing is hidden or the daemon does not answer, and comes once something is", async () => {
    mocks.suppressions.mockResolvedValue([]);
    await act(async () => root.render(<HiddenLink />));
    expect(button("ui.recs.hidden.open")).toBeUndefined();
    mocks.suppressions.mockResolvedValue("unavailable");
    await act(async () => mocks.changed.dispatchEvent(new Event("change")));
    expect(button("ui.recs.hidden.open")).toBeUndefined();
    mocks.suppressions.mockResolvedValue([{ suppressionId: 2 }]);
    await act(async () => mocks.changed.dispatchEvent(new Event("change")));
    expect(button("ui.recs.hidden.open")).toBeDefined();
  });
});

describe("ColdStart import", () => {
  it("offers Import beside Search in the empty state when Home passes it", async () => {
    const onImport = vi.fn();
    await act(async () => root.render(<ColdStart onImport={onImport} />));
    act(() => button("ui.library.import")!.click());
    expect(onImport).toHaveBeenCalledOnce();
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ColdStart />));
    expect(button("ui.library.import")).toBeUndefined();
  });

  it("offers each import source under the taste ask while the library is empty, so a skipped tour still leads to an import", async () => {
    mocks.coldStart.mockResolvedValue(true);
    await act(async () => root.render(<ColdStart onImport={vi.fn()} />));
    const ask = host.querySelector("[data-cold-ask]");
    expect(ask?.contains(button("start-with-picks")!)).toBe(true);
    expect([...ask!.querySelectorAll("[data-source]")].map((source) => source.textContent)).toEqual([
      "ui.tour.start.sources.spotify",
      "ui.tour.start.sources.apple",
    ]);
    act(() => button("ui.tour.start.sources.apple")!.click());
    expect(mocks.openImportSheet).toHaveBeenCalledWith("apple");
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ColdStart />));
    expect(host.querySelector("[data-source]")).toBeNull();
  });
});
