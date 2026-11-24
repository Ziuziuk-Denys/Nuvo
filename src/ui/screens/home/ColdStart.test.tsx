// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useWarmup } from "../../ports/recs";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mocks = vi.hoisted(() => ({
  suppressions: vi.fn(),
  openSearch: vi.fn(),
  openSettingsSection: vi.fn(),
  openImport: vi.fn(),
  addMusic: vi.fn(),
  warmHome: vi.fn(),
  changed: new EventTarget(),
}));
vi.mock("../../ports/recs", async () => {
  const { create } = await import("zustand");
  return {
    recs: { suppressions: mocks.suppressions },
    recsChanged: mocks.changed,
    useWarmup: create(() => ({ phase: "idle", seeds: [] as string[] })),
    warmHome: mocks.warmHome,
  };
});
vi.mock("../../ports/importSources", () => ({ openImportSheet: mocks.openImport }));
vi.mock("../local/addMusic", () => ({ useAddMusic: () => mocks.addMusic }));
vi.mock("../../ports/navigation", () => ({
  useModalStore: { getState: () => ({ openSearch: mocks.openSearch, openSettingsSection: mocks.openSettingsSection }) },
}));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.suppressions.mockResolvedValue([{ suppressionId: 1 }]);
  useWarmup.setState({ phase: "idle", seeds: [] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

describe("ColdStart", () => {
  it("rises line by line on the first visit only", async () => {
    await act(async () => root.render(<ColdStart />));
    expect([...host.querySelectorAll(".n-enter")].map((node) => (node as HTMLElement).style.getPropertyValue("--n-i"))).toEqual(["0", "1", "2"]);
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ColdStart />));
    expect(host.querySelectorAll(".n-enter")).toHaveLength(0);
  });

  it("reads as one phrase whose parts are the actions: each source opens its import, the dark part adds files", async () => {
    await act(async () => root.render(<ColdStart />));
    const bring = host.querySelector("[data-bring]")!;
    expect(bring.getAttribute("data-tour")).toBe("home-start");
    expect(bring.textContent).toBe(
      "ui.home.bring.titleui.home.bring.fromui.tour.start.sources.spotifyui.tour.start.sources.appleui.tour.start.sources.youtubeui.home.bring.orui.home.bring.filesui.home.bring.drop",
    );
    act(() => button("ui.tour.start.sources.apple")!.click());
    expect(mocks.openImport).toHaveBeenCalledWith("apple");
    act(() => button("ui.home.bring.files")!.click());
    expect(mocks.addMusic).toHaveBeenCalledOnce();
  });

  it("shows Home being built after picks from the tour", async () => {
    useWarmup.setState({ phase: "building", seeds: ["s1"] });
    await act(async () => root.render(<ColdStart />));
    expect(host.querySelector("[data-bring]")).toBeNull();
    const status = host.querySelector("[data-building]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("ui.recs.home.building");
  });

  it("when no source answered for the picks, says so and tries the same picks again", async () => {
    useWarmup.setState({ phase: "failed", seeds: ["s1", "t2"] });
    await act(async () => root.render(<ColdStart />));
    expect(host.textContent).toContain("ui.recs.home.offline_title");
    act(() => button("ui.recs.home.retry")!.click());
    expect(mocks.warmHome).toHaveBeenCalledWith(["s1", "t2"]);
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
