// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recognize } from "./Recognize";
import { isRecognizable, useDroppedFile, useRecognizeDrop } from "./recognizeDrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Emit = (event: Record<string, unknown>) => void;

const mocks = vi.hoisted(() => ({
  emit: null as Emit | null,
  signal: null as AbortSignal | null,
  sources: [] as unknown[],
  history: [] as unknown[],
  reachable: true,
  find: vi.fn(),
  forget: vi.fn(async () => undefined),
  grant: vi.fn(),
  play: vi.fn(),
  seek: vi.fn(),
  open: vi.fn(),
  like: vi.fn(),
  dislike: vi.fn(),
}));

vi.mock("../../ports/recognize", async () => {
  const session = await import("@/recognize/session");
  return {
    ...session,
    listen: (source: unknown, _part: number, signal: AbortSignal, onEvent: Emit) => {
      mocks.sources.push(source);
      mocks.signal = signal;
      mocks.emit = onEvent;
      return new Promise<void>(() => undefined);
    },
    startFailure: () => "failed",
    recognizeHistory: async () => mocks.history,
    forgetRecognized: mocks.forget,
    findSong: mocks.find,
    grantFile: mocks.grant,
  };
});
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key) }),
}));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("../../ports/network", () => ({ useOnline: () => mocks.reachable }));
vi.mock("../../ports/player", () => ({ playerEngine: { playTrack: mocks.play, seek: mocks.seek } }));
vi.mock("../../ports/system", () => ({ openExternal: mocks.open }));
vi.mock("../../ports/library", () => ({
  useIsTrackLiked: () => false,
  useLikeTrack: () => ({ mutate: mocks.like }),
  useUnlikeTrack: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../recs/notInterested", () => ({ songMenuNotInterested: mocks.dislike }));
vi.mock("../../shell/popovers/AddToPlaylistPopover", () => ({ AddToPlaylistPopover: () => <p>add popover</p> }));

const song = {
  title: "I Will Survive",
  artist: "Gloria Gaynor",
  album: "Love Tracks",
  released: "1978",
  genre: "Pop",
  coverUrl: "https://is1-ssl.mzstatic.com/a/600x600cc.jpg",
  via: "mix",
  input: { kind: "file", label: "clip.mp3" },
};
const track = { id: "yt1", title: "I Will Survive", artists: "Gloria Gaynor", coverUrl: "", durationMs: 1000, playCount: 0 };

let root: Root;
let host: HTMLDivElement;

const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <Recognize />
      </MemoryRouter>,
    ),
  );
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name) as HTMLButtonElement;
const press = (name: string) => act(async () => button(name).click());
const emit = (event: Record<string, unknown>) => act(async () => mocks.emit?.(event));
const status = () => host.querySelector('[role="status"]')?.textContent ?? "";

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.history = [];
  mocks.sources = [];
  mocks.reachable = true;
  mocks.find.mockReset().mockResolvedValue(track);
  mocks.grant.mockReset().mockResolvedValue("grant1");
  mocks.play.mockClear();
  mocks.seek.mockClear();
  mocks.open.mockClear();
  mocks.like.mockClear();
  mocks.dislike.mockClear();
  mocks.forget.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("Recognize", () => {
  it("offers the four inputs at rest", async () => {
    await render();
    expect(status()).toContain("ui.recognize.idle_title");
    for (const name of ["ui.recognize.microphone", "ui.recognize.system", "ui.recognize.file", "ui.recognize.link"]) expect(button(name).disabled).toBe(false);
  });

  it("listens to a pasted link, says link failures in link words, and keeps the link for another try", async () => {
    await render();
    await press("ui.recognize.link");
    const field = host.querySelector<HTMLInputElement>("[data-recognize-link] input")!;
    expect(document.activeElement).toBe(field);
    expect(button("ui.recognize.link_go").disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "  https://www.instagram.com/reel/abc/ ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(mocks.sources).toEqual([{ url: "https://www.instagram.com/reel/abc/" }]);
    expect(host.querySelector("[data-recognize-link]")).toBeNull();
    expect(status()).toContain("ui.recognize.reading_link_title");
    await emit({ type: "stage", name: "fetching", detail: "Morning walk" });
    expect(status()).toContain("Morning walk");
    await emit({ type: "notFound", more: true });
    await press("ui.recognize.another_part");
    expect(mocks.sources.at(-1)).toEqual({ url: "https://www.instagram.com/reel/abc/" });
    await emit({ type: "error", code: "login_required" });
    expect(status()).toContain("ui.recognize.error_link.login_required");

    await press("ui.recognize.link");
    expect(host.querySelector<HTMLInputElement>("[data-recognize-link] input")!.value).toBe("  https://www.instagram.com/reel/abc/ ");
    await press("common.cancel");
    expect(host.querySelector("[data-recognize-link]")).toBeNull();
    await press("ui.recognize.link");
    await act(
      async () => void host.querySelector("[data-recognize-link] input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(button("ui.recognize.microphone")).toBeDefined();
  });

  it("a shared failure keeps its shared words for a link, and offline turns the link off", async () => {
    await render();
    await press("ui.recognize.link");
    const field = host.querySelector<HTMLInputElement>("[data-recognize-link] input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "https://vk.com/video1_2");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("ui.recognize.link_go");
    await emit({ type: "error", code: "busy" });
    expect(status()).toContain("ui.recognize.error.busy");
    mocks.reachable = false;
    await render();
    expect(button("ui.recognize.link").disabled).toBe(true);
  });

  it("listens, shows the part being checked, and stops the job on Stop and on leaving", async () => {
    await render();
    await press("ui.recognize.microphone");
    expect(mocks.sources).toEqual([{ microphone: true }]);
    expect(status()).toContain("ui.recognize.listening_title");
    expect(status()).toContain("ui.recognize.listening_microphone");
    expect(host.querySelector("[data-live]")).not.toBeNull();
    await emit({ type: "stage", name: "listening", attempt: 1, of: 2, via: "system", envelope: Array.from({ length: 48 }, () => 0.5) });
    expect(status()).toContain("ui.recognize.checking(1,2)");
    expect(host.querySelector("[data-live]")).toBeNull();
    const first = mocks.signal;
    await press("ui.recognize.stop");
    expect(first?.aborted).toBe(true);
    expect(status()).toContain("ui.recognize.idle_title");

    await press("ui.recognize.system");
    const second = mocks.signal;
    act(() => root.render(<MemoryRouter />));
    expect(second?.aborted).toBe(true);
  });

  it("shows the result with its cover and acts on the catalog's copy", async () => {
    await render();
    await press("ui.recognize.system");
    await emit({ type: "result", id: "r1", track: song });
    const card = host.querySelector("[data-recognize-result]")!;
    expect(card.textContent).toContain("I Will Survive");
    expect(card.textContent).toContain("Love Tracks · 1978 · Pop");
    expect(card.querySelector("img")?.getAttribute("src")).toBe(song.coverUrl);
    await press("ui.recognize.play");
    expect(mocks.play).toHaveBeenCalledWith(track, [track]);
    await press("ui.island.like");
    expect(mocks.like).toHaveBeenCalledWith(track);
    await press("ui.recs.dislike");
    expect(mocks.dislike).toHaveBeenCalledWith(track, "exact");
    await press("common.add_to_playlist");
    expect(document.body.textContent).toContain("add popover");
  });

  it("plays from the heard moment and opens the song in Apple Music", async () => {
    await render();
    await press("ui.recognize.system");
    const url = "https://music.apple.com/us/album/i-will-survive/1?i=2";
    await emit({ type: "result", id: "r1", track: { ...song, offsetMs: 83_400, appleMusicUrl: url } });
    await press("ui.recognize.play_from(1:23)");
    expect(mocks.play).toHaveBeenCalledWith(track, [track]);
    expect(mocks.seek).toHaveBeenCalledWith(83_400);
    await press("ui.recognize.apple_music");
    expect(mocks.open).toHaveBeenCalledWith(url);
    // the text actions keep a line of their own under Play, so long labels never push past the card
    const byText = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
    const links = byText("ui.recognize.again").parentElement;
    expect(byText("ui.recognize.apple_music").parentElement).toBe(links);
    expect(byText("ui.recognize.play_from(1:23)").parentElement).not.toBe(links);
  });

  it("sends the song to Search when the catalog has no copy", async () => {
    mocks.find.mockResolvedValue(null);
    await render();
    await press("ui.recognize.system");
    await emit({ type: "result", id: "r1", track: song });
    expect(button("ui.recognize.search")).toBeDefined();
    expect(button("ui.island.like")).toBeUndefined();
    expect(host.textContent).toContain("ui.recognize.not_in_catalog");
  });

  it("says no match, and offers another part only when there is one", async () => {
    await render();
    await press("ui.recognize.system");
    await emit({ type: "notFound", more: false });
    expect(status()).toContain("ui.recognize.none_title");
    expect(button("ui.recognize.another_part")).toBeUndefined();

    const picker = host.querySelector<HTMLInputElement>("[data-recognize-file]")!;
    const file = new File(["x"], "clip.mp3");
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    await act(async () => void picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(mocks.grant).toHaveBeenCalledWith(file);
    expect(mocks.sources.at(-1)).toEqual({ file: "grant1" });
    await emit({ type: "notFound", more: true });
    await press("ui.recognize.another_part");
    expect(mocks.sources.at(-1)).toEqual({ file: "grant1" });
  });

  it("says when the microphone or the computer cannot be reached, and keeps the other inputs", async () => {
    await render();
    await press("ui.recognize.microphone");
    await emit({ type: "error", code: "no_capture" });
    expect(status()).toContain("ui.recognize.no_access_title_microphone");
    await press("ui.recognize.system");
    await emit({ type: "error", code: "no_capture" });
    expect(status()).toContain("ui.recognize.no_access_title_system");
    expect(button("ui.recognize.file").disabled).toBe(false);
  });

  it("reads an unknown failure as a failure, and a refused file as unavailable", async () => {
    await render();
    await press("ui.recognize.system");
    await emit({ type: "error", code: "drm" });
    expect(status()).toContain("ui.recognize.error.failed");
    mocks.grant.mockResolvedValue(null);
    const dropped = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropped, "dataTransfer", { value: { files: [new File(["x"], "a.mp3")] } });
    await act(async () => void host.querySelector("section")!.dispatchEvent(dropped));
    expect(status()).toContain("ui.recognize.error.unavailable");
  });

  it("offline: says so, turns the inputs off and keeps the history", async () => {
    mocks.reachable = false;
    mocks.history = [{ id: "h1", createdAt: "2026-11-07T11:00:00Z", track: song }];
    await render();
    expect(status()).toContain("ui.recognize.offline_title");
    expect(button("ui.recognize.microphone").disabled).toBe(true);
    expect(host.querySelector("[data-recognize-row]")?.textContent).toContain("Gloria Gaynor");
  });

  it("lists what was recognized; a row plays, dislikes and leaves the list", async () => {
    mocks.history = [{ id: "h1", createdAt: "2026-11-07T11:00:00Z", track: song }];
    await render();
    const row = host.querySelector("[data-recognize-row]") as HTMLElement;
    await act(async () => void row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith(track, [track]);
    await press("ui.recs.dislike");
    expect(mocks.dislike).toHaveBeenCalledWith(track, "exact");
    expect(mocks.find).toHaveBeenCalledTimes(1);
    await press("ui.entity.more");
    await press("ui.recognize.forget");
    expect(mocks.forget).toHaveBeenCalledWith("h1");
    expect(host.querySelector("[data-recognize-row]")).toBeNull();
  });

  it("a sound or video file dropped elsewhere in the window starts a file run here", async () => {
    await render();
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await act(async () => useDroppedFile.setState({ file }));
    expect(mocks.grant).toHaveBeenCalledWith(file);
    expect(mocks.sources.at(-1)).toEqual({ file: "grant1" });
    expect(useDroppedFile.getState().file).toBeNull();
  });
});

describe("dropping a file on the window", () => {
  function Host({ open }: { open(): void }) {
    useRecognizeDrop(open);
    return null;
  }
  const drop = (file: File, taken = false) => {
    const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [file] } });
    if (taken) event.preventDefault();
    window.dispatchEvent(event);
    return event;
  };

  it("opens Recognize with a sound or video file, and leaves other files and taken drops alone", () => {
    const open = vi.fn();
    act(() => root.render(<Host open={open} />));
    expect(drop(new File(["x"], "notes.txt", { type: "text/plain" })).defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    drop(new File(["x"], "song.flac", { type: "audio/flac" }), true);
    expect(open).not.toHaveBeenCalled();
    const song = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    drop(song);
    expect(open).toHaveBeenCalledTimes(1);
    expect(useDroppedFile.getState().take()).toBe(song);
    expect(isRecognizable({ type: "video/webm" })).toBe(true);
  });
});
