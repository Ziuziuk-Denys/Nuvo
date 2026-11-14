// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { ImportError, type ImportActions, type ImportSummary, type Listing } from "../../ports/imports";
import { listingCovers, searchCovers } from "./ImportPreview";
import { ImportSheet, type ImportSheetProps } from "./ImportSheet";

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LISTING: Listing = {
  source: "deezer",
  label: "Northbound",
  rows: Array.from({ length: 7 }, (_, i) => ({
    title: `Song ${i}`,
    artists: ["Mira Holt"],
  })),
};

const SUMMARY = { id: "i1", status: "running" } as ImportSummary;

function fakeActions(patch: Partial<ImportActions> = {}): ImportActions {
  return {
    list: vi.fn(async () => LISTING),
    listLikes: vi.fn(async () => ({
      ...LISTING,
      source: "soundcloud" as const,
      likesOf: "nightowl",
    })),
    post: vi.fn(async () => [SUMMARY]),
    importFile: vi.fn(async () => [SUMMARY]),
    ...patch,
  };
}

async function mount(props: Partial<ImportSheetProps> & { actions: ImportActions }) {
  await act(async () => {
    root.render(<ImportSheet open onClose={() => {}} onOpenReport={() => {}} {...props} />);
  });
}

const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;
const click = async (name: string) => {
  await act(async () => {
    button(name).click();
  });
};
const typeInto = async (value: string) => {
  const input = document.querySelector("input[type=text]") as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("ImportSheet", () => {
  it("reads a link, previews it with the honesty line, and posts to the chosen target", async () => {
    const actions = fakeActions();
    const onStarted = vi.fn();
    await mount({ actions, onStarted });
    await typeInto("https://deezer.com/playlist/1");
    await click("ui.imports.read");
    expect(actions.list).toHaveBeenCalledWith("https://deezer.com/playlist/1", expect.any(AbortSignal), expect.any(Function));
    expect(document.body.textContent).toContain("Northbound");
    expect(document.body.textContent).toContain('ui.imports.songs {"count":7}');
    expect(document.body.textContent).toContain("ui.imports.honesty");
    expect(document.querySelectorAll("li")).toHaveLength(4);
    await click("ui.imports.target_liked");
    await click("ui.imports.import");
    expect(actions.post).toHaveBeenCalledWith(LISTING, { kind: "liked" });
    expect(onStarted).toHaveBeenCalledWith([SUMMARY]);
    expect(button("ui.imports.open_report")).toBeTruthy();
  });

  it("opens the whole song list and folds it back", async () => {
    await mount({ actions: fakeActions(), initialLink: "https://deezer.com/playlist/1" });
    const toggle = () => document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(toggle().textContent).toBe('ui.imports.show_all {"count":7}');
    await act(async () => toggle().click());
    expect(document.querySelectorAll("li")).toHaveLength(7);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle().click());
    expect(document.querySelectorAll("li")).toHaveLength(4);
  });

  it("stacks up to three distinct song covers", () => {
    const row = (url?: string) => ({ title: "t", artists: [], ...(url ? { track: { id: url, title: "t", artists: [], durationMs: 1, cover: { url } } } : {}) });
    expect(listingCovers([row("a"), row(), row("a"), row("b")])).toEqual(["a", "b"]);
    expect(listingCovers(["a", "b", "c", "d", "e"].map(row))).toEqual(["a", "b", "c"]);
    expect(listingCovers([row()])).toEqual([]);
  });

  it("borrows covers from the catalogue when the listing has none", async () => {
    const rows = [
      { title: "One", artists: ["A"] },
      { title: "Two", artists: [] },
      { title: "Three", artists: ["C"] },
      { title: "Four", artists: ["D"] },
    ];
    const track = (url: string) => ({ id: url, title: "", artists: [], durationMs: 1, cover: { url } });
    const search = vi.fn(async (query: string) => (query === "A One" ? [track("x")] : query === "Two" ? [track("x")] : Promise.reject(new Error("offline"))));
    expect(await searchCovers(rows, search)).toEqual(["x"]);
    expect(search.mock.calls.map(([query]) => query)).toEqual(["A One", "Two", "C Three"]);
  });

  it("previews a cover-less listing with covers found in the catalogue", async () => {
    const searchSongs = vi.fn(async () => [{ id: "s", title: "", artists: [], durationMs: 1, cover: { url: "https://img/cover.jpg" } }]);
    await mount({ actions: fakeActions(), initialLink: "https://deezer.com/playlist/1", searchSongs });
    expect(searchSongs).toHaveBeenCalled();
    expect(document.querySelector("[role=dialog] img")).not.toBeNull();
  });

  it.each([
    ["spotify_file_only", "https://open.spotify.com/playlist/1"],
    ["region_blocked", "https://music.yandex.ru/users/a/playlists/3"],
  ] as const)("explains %s and offers the file import", async (code, initialLink) => {
    const actions = fakeActions({
      list: vi.fn(async () => Promise.reject(new ImportError(code))),
    });
    await mount({ actions, initialLink });
    expect(document.querySelector("[role=alert]")?.textContent).toBe(`ui.imports.error.${code}`);
    await click("ui.imports.import_file_instead");
    expect(document.body.textContent).toContain("ui.imports.file_hint");
    expect(actions.post).not.toHaveBeenCalled();
  });

  it("cancels a slow read: the signal aborts and nothing is posted", async () => {
    let seen: AbortSignal | undefined;
    const actions = fakeActions({
      list: vi.fn((_text: string, signal: AbortSignal) => {
        seen = signal;
        return new Promise<Listing>(() => {});
      }),
    });
    await mount({ actions, initialLink: "https://deezer.com/playlist/1" });
    expect(document.querySelector("[role=status]")?.textContent).toBe('ui.imports.reading {"count":0}');
    await click("ui.imports.cancel");
    expect(seen?.aborted).toBe(true);
    expect(actions.post).not.toHaveBeenCalled();
    expect(button("ui.imports.read")).toBeTruthy();
  });

  it("uses the likes field for SoundCloud names and labels the preview", async () => {
    const actions = fakeActions();
    await mount({ actions });
    await click("ui.imports.tab_likes");
    await typeInto("@nightowl");
    await click("ui.imports.read");
    expect(actions.listLikes).toHaveBeenCalledWith("@nightowl", expect.any(AbortSignal), expect.any(Function));
    expect(document.body.textContent).toContain('ui.imports.likes_name {"name":"nightowl"}');
  });

  it("imports a picked file into a fixed target without the target chips", async () => {
    const actions = fakeActions();
    await mount({ actions, target: { kind: "playlist", id: "p1" } });
    await click("ui.imports.tab_file");
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["a,b"], "likes.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(actions.importFile).toHaveBeenCalledWith(file, {
      kind: "playlist",
      id: "p1",
    });
  });

  it("opens on the tab it is asked for", async () => {
    await mount({ actions: fakeActions(), initialMode: "file" });
    expect(document.body.textContent).toContain("ui.imports.file_hint");
  });

  it("starts reading when Enter is pressed in the field, and not on an empty field", async () => {
    const actions = fakeActions();
    await mount({ actions });
    const input = document.querySelector("input[type=text]") as HTMLInputElement;
    const enter = async () =>
      act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    await enter();
    expect(actions.list).not.toHaveBeenCalled();
    await typeInto("https://deezer.com/playlist/1");
    await enter();
    expect(actions.list).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and gives focus back to what opened it", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    await mount({ actions: fakeActions(), onClose });
    expect(document.activeElement).not.toBe(opener);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(<ImportSheet open={false} onClose={onClose} actions={fakeActions()} onOpenReport={() => {}} />);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("ignores progress that arrives after Cancel", async () => {
    let progress!: (count: number) => void;
    const actions = fakeActions({
      list: vi.fn((_text, _signal, onProgress) => {
        progress = onProgress;
        return new Promise<Listing>(() => {});
      }),
    });
    await mount({ actions, initialLink: "https://deezer.com/playlist/1" });
    await click("ui.imports.cancel");
    await act(async () => progress(5));
    expect(document.querySelector("[role=status]")).toBeNull();
    expect(button("ui.imports.read")).toBeTruthy();
  });

  it("keeps the link and the likes name apart when switching tabs", async () => {
    await mount({ actions: fakeActions() });
    await typeInto("https://deezer.com/playlist/1");
    await click("ui.imports.tab_likes");
    const input = () => document.querySelector("input[type=text]") as HTMLInputElement;
    expect(input().value).toBe("");
    await typeInto("nightowl");
    await click("ui.imports.tab_link");
    expect(input().value).toBe("https://deezer.com/playlist/1");
    await click("ui.imports.tab_likes");
    expect(input().value).toBe("nightowl");
  });
});
