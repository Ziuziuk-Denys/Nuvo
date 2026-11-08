// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { StartWithArtists } from "./StartWithArtists";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../ports/search", () => ({
  useSearchArtists: () => ({ artists: ["a1", "a2", "a3", "a4"].map((id) => ({ id, name: `Name ${id}` })), loading: false, hasLoaded: true }),
  toSearchResult: (item: { id: string; name: string }) => ({ kind: "artist", id: item.id, title: item.name, subtitle: "", cover: "" }),
}));
vi.mock("../ports/starters", () => ({ STARTER_ARTISTS: 3, startFromArtists: mocks.start }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/covers", () => ({ coverSrc: (src: string) => src }));

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
});

const byText = (text: string) => [...host.querySelectorAll<HTMLElement>("*")].find((el) => el.textContent === text && el.children.length === 0)!;

describe("StartWithArtists", () => {
  it("picks at most three artists and starts from them", async () => {
    mocks.start.mockResolvedValue(true);
    const onStarted = vi.fn();
    await act(async () => root.render(<StartWithArtists onStarted={onStarted} />));
    for (const name of ["Name a1", "Name a2", "Name a3", "Name a4"]) act(() => byText(name).click());
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(3);
    await act(async () => byText("ui.recs.start.go").click());
    expect(mocks.start).toHaveBeenCalledWith(["a1", "a2", "a3"]);
    expect(onStarted).toHaveBeenCalled();
  });

  it("a second press on a picked artist lets it go", async () => {
    await act(async () => root.render(<StartWithArtists onStarted={() => undefined} />));
    act(() => byText("Name a2").click());
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    act(() => byText("Name a2").click());
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
    expect(byText("ui.recs.start.go").closest("button")!.disabled).toBe(true);
  });

  it("says so when nothing could be saved and stays", async () => {
    mocks.start.mockResolvedValue(false);
    const onStarted = vi.fn();
    await act(async () => root.render(<StartWithArtists onStarted={onStarted} />));
    act(() => byText("Name a1").click());
    await act(async () => byText("ui.recs.start.go").click());
    expect(host.textContent).toContain("ui.recs.start.failed");
    expect(onStarted).not.toHaveBeenCalled();
  });
});
