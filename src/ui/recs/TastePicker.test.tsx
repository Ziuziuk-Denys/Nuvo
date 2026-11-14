// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { TastePicker } from "./TastePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  online: true,
  results: [
    { kind: "artist", id: "a1", title: "Massive Attack", subtitle: "", cover: "" },
    { kind: "song", id: "s1", title: "Teardrop", subtitle: "Massive Attack", cover: "" },
    { kind: "song", id: "s1b", title: "Teardrop", subtitle: "Massive Attack", cover: "" },
    { kind: "album", id: "al1", title: "Mezzanine", subtitle: "", cover: "" },
    { kind: "song", id: "s2", title: "Angel", subtitle: "Massive Attack", cover: "" },
    { kind: "song", id: "s3", title: "Unfinished Sympathy", subtitle: "Massive Attack", cover: "" },
  ],
}));
vi.mock("../ports/search", () => ({
  useSearchAll: (query: string) => ({ items: query.trim().length >= 2 ? mocks.results : [], loading: false, hasLoaded: true }),
  toSearchResult: (item: unknown) => item,
}));
vi.mock("../ports/starters", () => ({ STARTER_PICKS: 3 }));
vi.mock("../ports/network", () => ({ useStreamingReachable: () => mocks.online }));
vi.mock("../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
}));
vi.mock("../ports/covers", () => ({ coverSrc: (src: string) => src }));

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  mocks.online = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TastePicker action="go" rows={3} start={mocks.start} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const input = () => host.querySelector("input")!;
const found = () => [...host.querySelectorAll('[aria-label="ui.tour.start.taste_suggestions"] b')].map((item) => item.textContent);
const seeds = () => [...host.querySelectorAll("[data-seed]")].map((item) => `${item.getAttribute("data-seed")}:${item.textContent}`);
const go = () => [...host.querySelectorAll("button")].find((item) => item.textContent === "go")!;

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pickFirst(text: string) {
  type(text);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="ui.tour.start.taste_suggestions"] button')!.click());
}

describe("TastePicker", () => {
  it("finds songs and artists together, never albums or a song twice, and says which is which", () => {
    type("mas");
    expect(found()).toEqual(["Massive Attack", "Teardrop", "Angel"]);
    expect(host.textContent).toContain("ui.tour.start.artist");
    expect(host.textContent).toContain('ui.tour.start.song {"artists":"Massive Attack"}');
  });

  it("a pick clears the field, shows as a seed and leaves the results; a song alone is enough to start", async () => {
    expect(go().disabled).toBe(true);
    type("tear");
    act(() => [...host.querySelectorAll("button")].find((item) => item.textContent?.startsWith("Teardrop"))!.click());
    expect(input().value).toBe("");
    expect(seeds()).toEqual(["song:Teardrop"]);
    expect(go().disabled).toBe(false);
    type("mas");
    expect(found()).not.toContain("Teardrop");

    let finish = (_ok: boolean) => {};
    mocks.start.mockReturnValue(new Promise<boolean>((done) => (finish = done)));
    act(() => go().click());
    expect(host.textContent).toContain("ui.tour.start.taste_busy");
    expect(go().disabled).toBe(true);
    await act(async () => finish(true));
    expect(mocks.start).toHaveBeenCalledWith([{ kind: "song", id: "s1", title: "Teardrop" }]);
    expect(host.textContent).toContain("ui.tour.start.taste_done");
    expect(input().disabled).toBe(true);
  });

  it("takes three at most, Enter picks the top result and Backspace in an empty field lets the last one go", () => {
    for (let n = 0; n < 3; n++) pickFirst("mas");
    expect(seeds()).toEqual(["artist:Massive Attack", "song:Teardrop", "song:Angel"]);
    type("mas");
    expect([...host.querySelectorAll<HTMLButtonElement>('[aria-label="ui.tour.start.taste_suggestions"] button')].every((row) => row.disabled)).toBe(true);
    type("");
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    expect(seeds()).toEqual(["artist:Massive Attack", "song:Teardrop"]);
    type("mas");
    act(() => input().form!.requestSubmit());
    expect(seeds()).toEqual(["artist:Massive Attack", "song:Teardrop", "song:Angel"]);
  });

  it("a seed's cross removes it", () => {
    pickFirst("mas");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="ui.tour.start.remove"]')!.click());
    expect(seeds()).toEqual([]);
  });

  it("keeps the picks and says so when starting failed", async () => {
    mocks.start.mockResolvedValue(false);
    pickFirst("mas");
    await act(async () => go().click());
    expect(host.textContent).toContain("ui.recs.start.failed");
    expect(seeds()).toHaveLength(1);
    expect(go().disabled).toBe(false);
  });

  it("asks for a connection instead of searching offline", async () => {
    mocks.online = false;
    await act(async () => root.render(<TastePicker action="go" rows={3} start={mocks.start} />));
    type("mas");
    expect(found()).toEqual([]);
    expect(host.textContent).toContain("ui.tour.start.taste_offline");
  });
});
