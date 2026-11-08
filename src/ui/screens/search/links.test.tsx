// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogTrack, ImportPorts, LinkPorts } from "../../ports/links";
import { ShareSheet } from "../../sheets/ShareSheet";
import { LinkBlock, type LinkBlockProps } from "./LinkBlock";
import { SharePreview } from "./SharePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RICK: CatalogTrack = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  artists: [{ id: "", name: "Rick Astley" }],
  durationMs: 213_000,
};

let root: Root;
let host: HTMLDivElement;

beforeAll(async () => {
  // jsdom lacks the compression streams Chromium has; Node's are the same implementation family
  const web = await import("node:stream/web");
  globalThis.CompressionStream ??= web.CompressionStream as unknown as typeof CompressionStream;
  globalThis.DecompressionStream ??= web.DecompressionStream as unknown as typeof DecompressionStream;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function ports(overrides: Partial<LinkPorts> = {}): LinkPorts {
  return {
    inspect: vi.fn(async () => ({ error: "unavailable" })),
    recognize: vi.fn(async () => ({ kind: "not_found" as const, more: false })),
    matchNext: vi.fn(async ({ steps }) =>
      steps.length === 0
        ? { status: "search" as const, query: "q", filter: "songs" as const }
        : { status: "pending" as const, reason: "no_catalog_candidates" as const },
    ),
    search: vi.fn(async () => []),
    youtubeTrack: vi.fn(async () => RICK),
    soundcloudLookup: vi.fn(async () => null),
    soundcloudTrack: vi.fn(async () => null),
    fetchJson: vi.fn(async () => ({ status: 404, body: null })),
    ...overrides,
  };
}

function props(text: string, linkPorts: LinkPorts): LinkBlockProps {
  return {
    text,
    ports: linkPorts,
    onPlay: vi.fn(),
    onLike: vi.fn(),
    onAddToPlaylist: vi.fn(),
    onSearch: vi.fn(),
    onImport: vi.fn(),
    onShare: vi.fn(),
    onNavigate: vi.fn(),
    onOpenExternal: vi.fn(),
    onImportFile: vi.fn(),
    onSlow: vi.fn(),
  };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent === name || button.getAttribute("aria-label") === name) as HTMLButtonElement;

describe("the link block", () => {
  it("a YouTube link becomes one playable row with its source line", async () => {
    const p = props("https://youtu.be/dQw4w9WgXcQ", ports());
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    expect(host.textContent).toContain("YouTube");
    expect(host.textContent).toContain("Never Gonna Give You Up");
    expect(host.textContent).toContain("From the link");
    act(() => buttonNamed("Play").click());
    expect(p.onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "dQw4w9WgXcQ", artists: "Rick Astley" }));
  });

  it("a SoundCloud track link becomes a row without any listening", async () => {
    const linkPorts = ports({
      soundcloudLookup: vi.fn(async () => ({
        type: "track" as const,
        id: "sc1",
        title: "Midnight City",
        artists: [{ id: "", name: "M83" }],
        durationMs: 244_000,
      })),
    });
    act(() => root.render(<LinkBlock {...props("https://soundcloud.com/m83/midnight-city", linkPorts)} />));
    await settle();
    expect(host.textContent).toContain("SoundCloud");
    expect(host.textContent).toContain("Midnight City");
    expect(host.textContent).toContain("4:04");
    expect(linkPorts.recognize).not.toHaveBeenCalled();
  });

  it("the row's menu likes, copies the name and opens the original link", async () => {
    const p = props("https://youtu.be/dQw4w9WgXcQ", ports());
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    act(() => buttonNamed("More").click());
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(labels).toEqual([
      "Like",
      "Add to playlist",
      "Copy “Rick Astley - Never Gonna Give You Up”",
      "Open the original link",
      "Not this song? Listen to the video",
    ]);
    act(() => (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    expect(p.onLike).toHaveBeenCalledWith(expect.objectContaining({ id: "dQw4w9WgXcQ" }));
    act(() => buttonNamed("More").click());
    act(() => buttonNamed("Add to playlist").click());
    expect(p.onAddToPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: "dQw4w9WgXcQ" }), expect.any(HTMLElement));
    act(() => buttonNamed("More").click());
    act(() => buttonNamed("Open the original link").click());
    expect(p.onOpenExternal).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
    act(() => buttonNamed("More").click());
    act(() => buttonNamed("Not this song? Listen to the video").click());
    await settle();
    expect(p.ports.recognize).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ", 0, expect.any(AbortSignal), expect.any(Function));
  });

  it("reports a slow job only after 300 ms and aborts when it closes", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const slow = ports({
      youtubeTrack: vi.fn((_id: string, s: AbortSignal) => {
        signal = s;
        return new Promise<CatalogTrack | null>(() => undefined);
      }),
    });
    const p = props("https://youtu.be/dQw4w9WgXcQ", slow);
    act(() => root.render(<LinkBlock {...p} />));
    act(() => vi.advanceTimersByTime(299));
    expect(p.onSlow).not.toHaveBeenCalledWith(true);
    act(() => vi.advanceTimersByTime(1));
    expect(p.onSlow).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).toContain("Reading the link");
    act(() => root.render(<></>));
    expect(signal?.aborted).toBe(true);
    expect(p.onSlow).toHaveBeenLastCalledWith(false);
  });

  it("a TikTok sound nobody found offers to search its name", async () => {
    const tiktok = ports({
      inspect: vi.fn(async () => ({
        kind: "tiktok" as const,
        canonicalUrl: "https://www.tiktok.com/@i/video/7000000000000000011",
        sound: { title: "I Will Survive", author: "Gloria Gaynor", original: false },
      })),
    });
    const p = props("https://www.tiktok.com/@a/video/7000000000000000011", tiktok);
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    expect(host.textContent).toContain("TikTok calls this sound “I Will Survive” by Gloria Gaynor, but Nuvo couldn't find it.");
    act(() => buttonNamed("Search for it").click());
    expect(p.onSearch).toHaveBeenCalledWith("Gloria Gaynor I Will Survive");
  });

  it("a Spotify link explains the file import and offers it", async () => {
    const p = props("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", ports());
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    expect(host.textContent).toContain("Nuvo reads public Spotify playlists and albums by link.");
    act(() => buttonNamed("Import a file").click());
    expect(p.onImportFile).toHaveBeenCalled();
  });

  it("a host the daemon can't read gets one calm sentence that names it", async () => {
    const p = props("https://notsoundcloud.com/some/track", ports({ inspect: vi.fn(async () => ({ error: "unsupported" })) }));
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    expect(host.textContent).toContain("Nuvo can't read links from notsoundcloud.com yet.");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("a job that fails outside any service ends in one calm sentence, not an endless stage line", async () => {
    const broken = ports({ youtubeTrack: vi.fn(async () => Promise.reject(new Error("bootYoutube() has not run"))) });
    act(() => root.render(<LinkBlock {...props("https://youtu.be/dQw4w9WgXcQ", broken)} />));
    await settle();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Nuvo couldn't open this link. Try again.");
    expect(host.textContent).not.toContain("gone or private");
  });

  it("a playlist link without the import client says the host can't be read yet", async () => {
    const p = props("https://www.deezer.com/en/playlist/908622995", ports());
    delete p.onImport;
    act(() => root.render(<LinkBlock {...p} />));
    await settle();
    expect(host.textContent).toContain("Nuvo can't read links from www.deezer.com yet.");
  });
});

const pressNamed = (name: string) => act(() => buttonNamed(name).click());

describe("the shared playlist preview", () => {
  it("imports into Liked songs only when Import is pressed", async () => {
    const importPorts: ImportPorts = {
      youtubeTrack: vi.fn(async () => RICK),
      soundcloudTrack: vi.fn(async () => null),
      startImport: vi.fn(async () => ({
        items: [{ id: "i1", label: "Mix", targetKind: "liked", status: "running", total: 2 }],
      })),
    };
    const onImported = vi.fn();
    const share = {
      title: "Mix",
      tracks: [
        { source: "youtube" as const, id: "dQw4w9WgXcQ" },
        { source: "text" as const, artist: "Кино", title: "Группа крови" },
      ],
    };
    act(() => root.render(<SharePreview share={share} ports={importPorts} playlists={[]} onClose={() => undefined} onImported={onImported} />));
    await settle();
    expect(document.body.textContent).toContain("2 songs");
    expect(document.body.textContent).toContain("Never Gonna Give You Up");
    expect(importPorts.startImport).not.toHaveBeenCalled();
    pressNamed("Liked songs");
    await act(async () => buttonNamed("Import").click());
    await settle();
    expect(importPorts.startImport).toHaveBeenCalledWith(
      expect.objectContaining({ source: "nuvo-link", label: "Mix", target: { kind: "liked" } }),
      expect.anything(),
    );
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), 0);
  });

  it("a gone video reads Unavailable song, a playlist comes from the menu, and Import waits while it runs", async () => {
    let finish: (value: { items: [] }) => void = () => undefined;
    const importPorts: ImportPorts = {
      youtubeTrack: vi.fn(async () => null),
      soundcloudTrack: vi.fn(async () => null),
      startImport: vi.fn(() => new Promise<{ items: [] }>((resolve) => (finish = resolve))),
    };
    const share = {
      title: "",
      tracks: [
        { source: "youtube" as const, id: "aaaaaaaaaaa" },
        { source: "text" as const, artist: "Burial", title: "Archangel" },
      ],
    };
    act(() =>
      root.render(<SharePreview share={share} ports={importPorts} playlists={[{ id: "p1", title: "Road" }]} onClose={() => undefined} onImported={vi.fn()} />),
    );
    await settle();
    expect(document.body.textContent).toContain("Shared playlist");
    expect(document.body.textContent).toContain("Unavailable song");
    expect(document.body.textContent).toContain("Archangel");
    pressNamed("Add to playlist");
    pressNamed("Road");
    expect(buttonNamed("Road").getAttribute("aria-pressed")).toBe("true");
    await act(async () => buttonNamed("Import").click());
    await settle();
    expect(buttonNamed("Import").disabled).toBe(true);
    expect(importPorts.startImport).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Shared playlist", target: { kind: "playlist", id: "p1" } }),
      expect.anything(),
    );
    // the gone song is not posted, only the readable one
    expect((importPorts.startImport as ReturnType<typeof vi.fn>).mock.calls[0][0].rows).toHaveLength(1);
    await act(async () => finish({ items: [] }));
    await settle();
    expect(buttonNamed("Import").disabled).toBe(false);
    expect(document.body.textContent).toContain("Couldn't start the import. Try again.");
  });
});

/** Waits (real timers) until `find` returns something; the encoder's streams settle on later ticks. */
async function until<T>(find: () => T | undefined | null): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const found = find();
    if (found) return found;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error("never appeared");
}

describe("the share sheet", () => {
  function clipboard() {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  it("copies the three-line song message", async () => {
    const writeText = clipboard();
    act(() =>
      root.render(<ShareSheet title="" items={[{ id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley" }]} onClose={() => undefined} />),
    );
    const copy = await until(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Copy link"));
    await act(async () => copy.click());
    const [message] = writeText.mock.calls[0];
    expect(message.split("\n")).toEqual([
      "Rick Astley - Never Gonna Give You Up",
      expect.stringMatching(/^Open in Nuvo: nuvo:\/\/share\?id=[A-Za-z0-9_-]+$/),
      "https://youtu.be/dQw4w9WgXcQ",
    ]);
    expect(document.body.textContent).toContain("Link copied");
    // one song has no list to copy or save
    expect(buttonNamed("Copy as text")).toBeUndefined();
  });

  it("a 200-song playlist warns about the long link above the actions and copies the first 50 for YouTube", async () => {
    const writeText = clipboard();
    // ids that do not repeat, so deflate cannot shrink the link under the budget
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let state = 7;
    const randomId = () =>
      Array.from({ length: 11 }, () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return alphabet[(state >>> 16) % 64];
      }).join("");
    const items = Array.from({ length: 200 }, (_, index) => ({
      id: randomId(),
      title: `Song number ${index}`,
      artist: `Artist ${index % 40}`,
      durationMs: 120_000 + ((index * 7_919) % 240) * 1_000,
    }));
    act(() => root.render(<ShareSheet title="Road" items={items} onClose={() => undefined} />));
    const copyLong = await until(() => buttonNamed("Copy long link"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Road · 200 songs");
    expect(text).toMatch(/This playlist makes a long link \([\d,]+ characters\)/);
    expect(text.indexOf("long link (")).toBeLessThan(text.indexOf("Copy long link"));
    expect(text).toContain("Opens the first 50 songs on YouTube");
    await act(async () => copyLong.click());
    const [message] = writeText.mock.calls[0];
    expect(message.split("\n")[0]).toBe("Road · 200 songs");
    await act(async () => buttonNamed("Copy YouTube link").click());
    const youtube = writeText.mock.calls[1][0];
    expect(youtube.split("video_ids=")[1].split(",")).toHaveLength(50);
    await act(async () => buttonNamed("Copy as text").click());
    expect(writeText.mock.calls[2][0].split("\n")[0]).toBe("1. Artist 0 - Song number 0");
    expect(document.body.textContent).toContain("List copied");
  });
});
