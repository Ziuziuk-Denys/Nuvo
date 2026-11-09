// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useTour } from "../../tour/tourStore";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ suppressions: vi.fn(), coldStart: vi.fn(), openSearch: vi.fn(), openSettingsSection: vi.fn(), changed: new EventTarget() }));
vi.mock("../../ports/recs", () => ({ recs: { suppressions: mocks.suppressions }, recsChanged: mocks.changed }));
vi.mock("../../ports/starters", () => ({ coldStartNeeded: mocks.coldStart }));
vi.mock("../../ports/network", () => ({ useStreamingReachable: () => true }));
vi.mock("../../ports/navigation", () => ({
  useModalStore: { getState: () => ({ openSearch: mocks.openSearch, openSettingsSection: mocks.openSettingsSection }) },
}));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../recs/StartWithArtists", () => ({
  StartWithArtists: ({ onStarted }: { onStarted(): void }) => (
    <button type="button" onClick={onStarted}>
      start-with-artists
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
  it("asks for a few artists when nothing tells the taste yet, then leaves the space to the station's mixes", async () => {
    mocks.coldStart.mockResolvedValue(true);
    await act(async () => root.render(<ColdStart />));
    act(() => button("start-with-artists")!.click());
    expect(host.textContent).not.toContain("ui.recs.home.empty_title");
    expect(button("start-with-artists")).toBeUndefined();
  });

  it("leaves the ask to the tour's start card while the tour is up", async () => {
    mocks.coldStart.mockResolvedValue(true);
    useTour.setState({ phase: "poster" });
    await act(async () => root.render(<ColdStart />));
    expect(button("start-with-artists")).toBeUndefined();
    expect(host.textContent).toContain("ui.recs.home.empty_title");
    act(() => useTour.setState({ phase: "off" }));
    expect(button("start-with-artists")).toBeDefined();
  });

  it("asks the daemon again when favourites were sent from the tour", async () => {
    mocks.coldStart.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await act(async () => root.render(<ColdStart />));
    expect(button("start-with-artists")).toBeDefined();
    await act(async () => mocks.changed.dispatchEvent(new Event("change")));
    expect(button("start-with-artists")).toBeUndefined();
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

  it("offers Import under the artist ask too, so a skipped tour still leads to an import", async () => {
    mocks.coldStart.mockResolvedValue(true);
    const onImport = vi.fn();
    await act(async () => root.render(<ColdStart onImport={onImport} />));
    expect(button("start-with-artists")).toBeDefined();
    expect(button("ui.library.import")!.closest("[data-cold-ask]")).toBe(button("start-with-artists")!.closest("[data-cold-ask]"));
    expect(host.querySelector("[data-cold-ask]")).not.toBeNull();
    act(() => button("ui.library.import")!.click());
    expect(onImport).toHaveBeenCalledOnce();
  });
});
