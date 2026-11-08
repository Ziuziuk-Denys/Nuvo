// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LocalFiles } from "./LocalFiles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const L = (c: string) => `local:${c.repeat(32)}`;
const mocks = vi.hoisted(() => ({
  roots: [] as Array<{ id: number; path: string; status: string; files: number; lastScanAt: number | null }>,
  items: [] as unknown[],
  rootsFailed: false,
  tracksFailed: false,
  loading: false,
  reloadRoots: vi.fn(),
  reloadTracks: vi.fn(),
  status: { scanning: true, read: 3, total: 9, watching: 1, polling: false, truncated: false } as Record<string, unknown>,
  addMusicFolder: vi.fn(async () => null as string | null),
  removeMusicFolder: vi.fn(async () => undefined),
  playTrack: vi.fn(),
}));

vi.mock("../../ports/localFiles", () => ({
  useLocalRoots: () => ({ roots: mocks.roots, failed: mocks.rootsFailed, reload: mocks.reloadRoots }),
  useLocalScan: () => mocks.status,
  useLocalTracks: () => ({ items: mocks.items, loading: mocks.loading, failed: mocks.tracksFailed, reload: mocks.reloadTracks }),
  scanLine: (s: { read: number; total: number }) => ({ key: "ui.local.scan_reading", vars: { read: s.read, total: s.total } }),
  addMusicFolder: mocks.addMusicFolder,
  removeMusicFolder: mocks.removeMusicFolder,
  rescanMusicFolders: vi.fn(),
  toPlayerTrack: (view: { track: object }) => ({ ...view.track, playCount: 0 }),
}));
vi.mock("../entity/EntityTracks", () => ({
  EntityTracks: (props: { tracks: Array<{ id: string; title: string }>; unavailable: (t: { id: string }) => string | null; onPlay: (t: unknown) => void }) => (
    <ul data-rows="">
      {props.tracks.map((track) => (
        <li key={track.id} data-unavailable={props.unavailable(track) ?? ""} onClick={() => props.onPlay(track)}>
          {track.title}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("../../ports/player", () => ({ playerEngine: { playTrack: mocks.playTrack } }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mocks.rootsFailed = false;
  mocks.tracksFailed = false;
  mocks.loading = false;
  mocks.reloadRoots.mockClear();
  mocks.reloadTracks.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () =>
  act(() =>
    root.render(
      <MemoryRouter>
        <LocalFiles query="" />
      </MemoryRouter>,
    ),
  );
const item = (id: string, title: string, unsupported?: string) => ({
  track: { id, title, artists: "A", coverUrl: "", durationMs: 1000 },
  codec: "flac",
  lossless: true,
  unsupported: unsupported ?? null,
  hasLyrics: false,
});

describe("LocalFiles", () => {
  it("without folders it offers to add one", async () => {
    mocks.roots = [];
    render();
    expect(host.textContent).toContain("ui.local.empty_title");
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("ui.local.add_folder"))!;
    await act(async () => add.click());
    expect(mocks.addMusicFolder).toHaveBeenCalled();
  });

  it("lists files, dims unsupported ones and plays only playable ones", () => {
    mocks.roots = [{ id: 1, path: "/home/u/Music", status: "ok", files: 2, lastScanAt: 1 }];
    mocks.items = [item(L("1"), "Good"), item(L("2"), "Apple", "alac")];
    render();
    expect(host.textContent).toContain("/home/u/Music");
    expect(host.textContent).toContain('ui.local.scan_reading {"read":3,"total":9}');
    const rows = host.querySelectorAll<HTMLElement>("[data-rows] li");
    expect(rows[1].dataset.unavailable).toBe("ui.local.unsupported_alac");
    act(() => (rows[0] as HTMLElement).click());
    expect(mocks.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: L("1") }), [expect.objectContaining({ id: L("1") })], "local:library", "");
  });

  it("a folder's remove button removes that folder", async () => {
    mocks.roots = [{ id: 7, path: "/home/u/Music", status: "ok", files: 2, lastScanAt: 1 }];
    mocks.items = [];
    render();
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label^="ui.local.remove_folder"]')!;
    await act(async () => remove.click());
    expect(mocks.removeMusicFolder).toHaveBeenCalledWith(7);
  });

  it("a daemon that cannot list the folders shows a retry, not the invitation to add one", async () => {
    mocks.roots = [];
    mocks.rootsFailed = true;
    render();
    expect(host.textContent).toContain("ui.library.load_error_title");
    expect(host.textContent).not.toContain("ui.local.empty_title");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("ui.library.retry"))!;
    await act(async () => retry.click());
    expect(mocks.reloadRoots).toHaveBeenCalled();
  });

  it("a failed file list shows a retry under the folders and marks a loading list busy", async () => {
    mocks.roots = [{ id: 1, path: "/m", status: "ok", files: 2, lastScanAt: 1 }];
    mocks.items = [];
    mocks.tracksFailed = true;
    render();
    expect(host.textContent).toContain("ui.library.load_error_line");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("ui.library.retry"))!;
    await act(async () => retry.click());
    expect(mocks.reloadTracks).toHaveBeenCalled();
    mocks.tracksFailed = false;
    mocks.loading = true;
    render();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("a missing folder carries an icon and a word", () => {
    mocks.roots = [
      { id: 1, path: "/gone", status: "missing", files: 2, lastScanAt: 1 },
      { id: 2, path: "/gone2", status: "missing", files: 1, lastScanAt: 1 },
      { id: 3, path: "/here", status: "ok", files: 1, lastScanAt: 1 },
    ];
    mocks.items = [];
    render();
    const chip = host.querySelector("[data-missing]")!;
    expect(chip.textContent).toContain("ui.local.folder_missing");
    expect(chip.querySelectorAll("svg").length).toBeGreaterThan(1);
    expect(host.querySelectorAll("[data-missing]")).toHaveLength(2);
  });
});
