// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { deliverShareLink } from "@/links/inbox";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pushLayer } from "../components/layers";
import { Shell } from "./Shell";
import styles from "./Shell.module.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modal = vi.hoisted(() => ({
  searchOpen: false,
  openSearch: vi.fn(),
  closeSearch: vi.fn(),
  openSettings: vi.fn(),
}));
const player = vi.hoisted(() => ({ fullscreen: false, setFullscreen: vi.fn() }));
const shortcuts = vi.hoisted(() => ({ onEscapeFallback: (() => false) as (() => boolean) | undefined }));
const mocks = vi.hoisted(() => ({
  railPins: [] as { kind: string; id: string; title: string; href: string; imageUrl?: string }[],
  imports: [] as { status: string; done: number; total: number }[],
}));

vi.mock("../ports/navigation", () => ({
  useWindowState: () => ({ isMaximized: false, isFullScreen: false, isEdgeToEdge: false }),
  useDisableButtonFocus: () => undefined,
  useModalStore: (select: (state: typeof modal) => unknown) => select(modal),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  canMinimizeWindow: () => true,
}));
vi.mock("../ports/shortcuts", () => ({
  useAppShortcuts: (options: { onEscapeFallback?: () => boolean }) => {
    shortcuts.onEscapeFallback = options.onEscapeFallback;
  },
}));
vi.mock("../ports/karaoke", () => ({
  Karaoke: () => <div data-testid="karaoke" />,
  KaraokeOverlay: ({ open }: { open: boolean }) => <div data-testid="karaoke-overlay" data-open={open ? "" : undefined} />,
}));
vi.mock("../ports/player", () => ({
  usePlayerStore: (select: (state: typeof player) => unknown) => select(player),
  playerEngine: {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ currentTrack: { id: "t1" } }),
  },
}));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../field/Field", () => ({ Field: () => <div data-testid="field" /> }));
vi.mock("./island/Island", () => ({ Island: () => null }));
vi.mock("../ports/importsRuntime", () => ({ bootImports: () => undefined, useImportSummaries: () => mocks.imports }));
vi.mock("../ports/library", () => ({
  livePins: (pins: unknown[]) => pins,
  usePlaylistsList: () => ({ data: { playlists: [] }, isFetched: false, isLoading: true, error: undefined }),
  useRailPinsStore: (select: (state: { pins: unknown[] }) => unknown) => select({ pins: mocks.railPins }),
}));
vi.mock("../screens/imports/ImportsHost", () => ({ ImportsHost: () => null }));
vi.mock("../screens/palette/Palette", () => ({ Palette: () => null }));

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
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
  modal.openSearch.mockClear();
  modal.openSettings.mockClear();
  modal.searchOpen = false;
  player.fullscreen = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(path: string, children: ReactNode = <p>page</p>) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Shell>{children}</Shell>
      </MemoryRouter>,
    ),
  );
}

const navLinks = () => [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="ui.nav.label"] a')];
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const railButton = () => host.querySelector<HTMLButtonElement>("aside button")!;

function press(key: string) {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function Where(): ReactNode {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}
const where = () => host.querySelector('[data-testid="where"]')?.textContent;

describe("Shell", () => {
  it("Escape on a playlist page closes an open sheet or menu instead of going back", () => {
    mount("/library/playlist?id=p1", <Where />);
    const pop = pushLayer(() => undefined);
    expect(shortcuts.onEscapeFallback?.()).toBe(false);
    expect(where()).toBe("/library/playlist?id=p1");
    pop();
    act(() => void shortcuts.onEscapeFallback?.());
    expect(where()).toBe("/library");
  });

  it("opens a shared link in search, whether it opened Nuvo or arrives while it runs", () => {
    deliverShareLink("EAABcold");
    mount("/", <Where />);
    expect(where()).toBe(`/search?link=1&q=${encodeURIComponent("nuvo://share?id=EAABcold")}`);
    act(() => deliverShareLink("EAABwarm"));
    expect(where()).toBe(`/search?link=1&q=${encodeURIComponent("nuvo://share?id=EAABwarm")}`);
  });

  it("renders the nav items as links and marks the active one", () => {
    mount("/library");
    const links = navLinks();
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "ui.nav.home",
      "ui.nav.search",
      "ui.nav.recognize",
      "ui.nav.library",
      "ui.nav.stats",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, null, null, "page", null]);
  });

  it("lists the lists pinned to the sidebar under the nav, a cover or a glyph each", () => {
    mocks.railPins = [
      { kind: "album", id: "a1", title: "Blue", href: "/collection?type=album&id=a1", imageUrl: "blue.jpg" },
      { kind: "artist", id: "r1", title: "Ann", href: "/artist?id=r1" },
    ];
    mount("/");
    const pinned = host.querySelector('nav[aria-label="ui.nav.pinned"]')!;
    const links = [...pinned.querySelectorAll("a")];
    expect(links.map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")])).toEqual([
      ["Blue", "#/collection?type=album&id=a1"],
      ["Ann", "#/artist?id=r1"],
    ]);
    expect(links[0].querySelector("img")).not.toBeNull();
    expect(navLinks()).toHaveLength(5);
    mocks.railPins = [];
  });

  it("draws a progress line under Library while imports run, and none once they are done", () => {
    mocks.imports = [
      { status: "running", done: 30, total: 100 },
      { status: "done", done: 5, total: 5 },
    ];
    mount("/");
    const library = navLinks()[3];
    const bar = library.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("30");
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe("scaleX(0.3)");
    mocks.imports = [{ status: "done", done: 100, total: 100 }];
    mount("/");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    mocks.imports = [];
  });

  it("shows the Back chip on entity routes only", () => {
    const back = () => [...host.querySelectorAll("header button")].find((element) => element.textContent === "ui.nav.back");
    mount("/");
    expect(back()).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    mount("/library/playlist");
    expect(back()).toBeDefined();
  });

  it("Search on the rail opens the search page like the other items", () => {
    mount("/", <Where />);
    act(() => navLinks()[1].click());
    expect(where()).toBe("/search");
    expect(modal.openSearch).not.toHaveBeenCalled();
  });

  it("puts settings at the foot of the rail and the window buttons in the top bar", () => {
    mount("/");
    expect(railButton().getAttribute("aria-label")).toBe("ui.nav.settings");
    act(() => railButton().click());
    expect(modal.openSettings).toHaveBeenCalledTimes(1);
    for (const label of ["ui.window.minimize", "ui.window.maximize", "ui.window.close"]) {
      expect(button(label)?.closest("header[data-window-drag]")).not.toBeNull();
    }
  });

  it("lights Search while the search popup is open", () => {
    modal.searchOpen = true;
    mount("/library");
    expect(navLinks().map((link) => link.getAttribute("aria-current"))).toEqual([null, "page", null, null, null]);
  });

  it("moves the current mark with a click and keeps the rail to glyphs only", () => {
    mount("/");
    act(() => navLinks()[2].click());
    expect(navLinks().map((link) => link.getAttribute("aria-current"))).toEqual([null, null, "page", null, null]);
    expect(host.querySelector("aside")!.textContent).toBe("");
  });

  it("marks nothing on a route outside the rail", () => {
    mount("/specimen");
    expect(navLinks().every((link) => !link.hasAttribute("aria-current"))).toBe(true);
  });

  it("shows the Nuvo mark at the start of the top bar", () => {
    mount("/");
    const header = host.querySelector("header[data-window-drag]")!;
    expect(header.firstElementChild?.getAttribute("aria-label")).toBe("Nuvo");
    expect(header.firstElementChild?.querySelector("svg")).not.toBeNull();
  });

  it("walks the rail with the arrow keys, Home and End", () => {
    mount("/");
    const links = navLinks();
    act(() => links[0].focus());
    press("ArrowDown");
    expect(document.activeElement).toBe(links[1]);
    press("End");
    expect(document.activeElement).toBe(railButton());
    press("ArrowDown");
    expect(document.activeElement).toBe(links[0]);
    press("ArrowUp");
    expect(document.activeElement).toBe(railButton());
    press("Home");
    expect(document.activeElement).toBe(links[0]);
  });

  it("scrolls the content in an n-scroll box with the island padding", () => {
    mount("/", <p data-testid="page">page</p>);
    const scroller = host.querySelector(".n-scroll");
    expect(scroller).not.toBeNull();
    const column = scroller!.firstElementChild!;
    expect(column.classList.contains(styles.column)).toBe(true);
    expect(column.querySelector("[data-testid=page]")).not.toBeNull();
  });

  it("opens the karaoke overlay when the player goes fullscreen; #/player draws the view in dark", () => {
    player.fullscreen = true;
    mount("/");
    expect(host.querySelector("[data-testid=karaoke-overlay]")?.hasAttribute("data-open")).toBe(true);
    expect(host.querySelector("[data-testid=karaoke]")).toBeNull();
  });

  it("draws the karaoke view in dark on #/player", () => {
    player.fullscreen = false;
    mount("/player");
    expect(host.querySelector("[data-testid=karaoke]")?.parentElement?.getAttribute("data-theme")).toBe("dark");
  });
});
