// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { SearchItem } from "@/youtube";
import { useSearchAll, useSearchTracks, type CatalogSearch, type SearchOptions } from "./catalogSearch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const search = vi.hoisted(() => vi.fn());
vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog: { search } }) }));

const song = (id: string): SearchItem => ({ kind: "track", id, title: `Song ${id}`, artists: [{ id: "q", name: "Queen" }], durationMs: 1000, explicit: false });

let root: Root;
let seen: (CatalogSearch & { tracks?: unknown[] }) | null;

function Probe({ query, options, tracks }: { query: string; options?: SearchOptions; tracks?: boolean }) {
  seen = tracks ? useSearchTracks(query, options) : useSearchAll(query, options);
  return null;
}

const render = (query: string, options?: SearchOptions, tracks = false) => act(() => root.render(<Probe query={query} options={options} tracks={tracks} />));
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useSearchAll", () => {
  it("waits for the debounce, then asks once and settles", async () => {
    search.mockResolvedValue([song("s1")]);
    render("queen", { debounceMs: 320 });
    expect(seen).toMatchObject({ loading: true, hasLoaded: false, items: [] });
    await advance(319);
    expect(search).not.toHaveBeenCalled();
    await advance(1);
    expect(search).toHaveBeenCalledWith("queen", "all", expect.any(AbortSignal));
    expect(seen).toMatchObject({ loading: false, hasLoaded: true, items: [song("s1")] });
  });

  it("sends nothing below two characters or while disabled", async () => {
    render("q");
    await advance(1000);
    render("queen", { enabled: false });
    await advance(1000);
    expect(search).not.toHaveBeenCalled();
    expect(seen).toMatchObject({ loading: false, items: [] });
  });

  it("runs at once on runNow", async () => {
    search.mockResolvedValue([]);
    render("queen", { debounceMs: 320 });
    act(() => seen!.runNow());
    await advance(0);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("caps the rows at the limit and settles empty on a failure", async () => {
    search.mockResolvedValueOnce([song("1"), song("2"), song("3")]);
    render("abba", { limit: 2, debounceMs: 0 });
    await advance(0);
    expect(seen?.items).toHaveLength(2);
    search.mockRejectedValueOnce(new Error("unreachable"));
    render("abba gold", { limit: 2, debounceMs: 0 });
    await advance(0);
    expect(seen).toMatchObject({ loading: false, hasLoaded: true, items: [] });
  });

  it("never shows an older query's answer as fresh (Review Focus 4)", async () => {
    let answerOld!: (items: SearchItem[]) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)));
    search.mockImplementationOnce(() => new Promise(() => undefined));
    render("qu", { debounceMs: 0 });
    await advance(0);
    render("queen", { debounceMs: 0 });
    await advance(0);
    answerOld([song("old")]);
    await advance(0);
    expect(seen).toMatchObject({ loading: true, hasLoaded: false });
  });
});

describe("useSearchTracks", () => {
  it("gives songs as tracks the lists can play", async () => {
    search.mockResolvedValue([song("s1"), { kind: "artist", id: "a", name: "A" }]);
    render("queen", { debounceMs: 0 }, true);
    await advance(0);
    expect(search).toHaveBeenCalledWith("queen", "track", expect.any(AbortSignal));
    expect(seen?.tracks).toEqual([expect.objectContaining({ id: "s1", artists: "Queen", playCount: 0 })]);
  });
});
