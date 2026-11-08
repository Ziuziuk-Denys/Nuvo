// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Palette } from "./Palette";
import { useGateStore } from "../lock/gateState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const EN: Record<string, string> = {
    "ui.palette.placeholder": "Type a command or setting",
    "ui.palette.group_go": "Go to",
    "ui.palette.group_playback": "Playback",
    "ui.palette.group_window": "Window",
    "ui.palette.group_settings": "Settings",
    "ui.palette.search": "Search",
    "ui.palette.settings": "Open Settings",
    "ui.palette.play_pause": "Play or pause",
    "ui.palette.next": "Next track",
    "ui.palette.lyrics": "Open lyrics",
    "ui.palette.setting": "Settings: {title}",
    "ui.palette.none": "No matching commands",
    "settings.cover_glow.title": "Cover glow",
  };
  const track = { id: "t1", title: "Song" };
  return {
    EN,
    player: { setFullscreen: vi.fn() },
    engine: {
      togglePlayPause: vi.fn(),
      skipNext: vi.fn(),
      skipPrevious: vi.fn(),
      startRadioStation: vi.fn(),
      setShuffle: vi.fn(),
      setRepeat: vi.fn(),
      getSnapshot: () => ({ currentTrack: track, shuffle: false, repeat: "off", playbackContext: null }),
    },
    modal: { openSettings: vi.fn(), openSettingsSection: vi.fn() },
  };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), mocks.EN[key] ?? key),
  }),
  getTranslationsForAllLocales: (key: string) => (mocks.EN[key] ? [mocks.EN[key]] : []),
  loadAllLocales: () => Promise.resolve(),
}));
vi.mock("../../ports/player", () => ({
  playerEngine: mocks.engine,
  usePlayerStore: Object.assign((select: (state: typeof mocks.player) => unknown) => select(mocks.player), { getState: () => mocks.player }),
  nextRepeatMode: () => "all",
  isRadioContext: () => false,
}));
vi.mock("../../ports/navigation", () => ({
  useModalStore: (select: (state: typeof mocks.modal) => unknown) => select(mocks.modal),
  toggleWindowFullscreen: () => undefined,
}));
vi.mock("../settings/settingItems", () => ({
  SETTING_ITEMS: [{ tabId: "Appearance", titleKey: "settings.cover_glow.title" }],
}));
vi.mock("../../ports/shortcuts", () => {
  const bindings: Record<string, string> = {
    "player.toggle": "Space",
    "player.next": "Control+Right",
    "player.previous": "Control+Left",
    "nav.search": "/",
    "nav.lyrics": "F",
  };
  return {
    useShortcutBindings: () => (id: string) => bindings[id] ?? null,
    useRecorderState: () => ({ kind: "idle" }),
    shortcutKeycaps: (accelerator: string) => accelerator.split("+").map((text) => ({ text, label: text })),
  };
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  act(() =>
    root.render(
      <MemoryRouter>
        <Palette />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => dialog()!.querySelector("input")!;
const rowTitles = () => [...dialog()!.querySelectorAll('[role="button"]')].map((row) => row.textContent);

function ctrlK() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
  });
}

function press(key: string) {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true }));
  });
}

function type(value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

describe("Palette", () => {
  it("opens on Ctrl+K with the field focused and closes on Escape", async () => {
    expect(dialog()).toBeNull();
    ctrlK();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toBe("Type a command or setting");
    press("Escape");
    await settle();
    expect(dialog()).toBeNull();
  });

  it("groups the five suggestions and shows their shortcuts as keycaps", () => {
    ctrlK();
    const groups = [...dialog()!.querySelectorAll('[role="group"]')].map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Playback", "Go to"]);
    expect(rowTitles()).toEqual(["Play or pauseSpace", "Open lyricsF", "Next trackControlRight", "Search/", "Open Settings"]);
    expect([...dialog()!.querySelectorAll("kbd")].map((key) => key.textContent).slice(0, 2)).toEqual(["Space", "F"]);
  });

  it("runs the second command on ArrowDown then Enter and closes", async () => {
    ctrlK();
    press("ArrowDown");
    press("Enter");
    expect(mocks.player.setFullscreen).toHaveBeenCalledWith(true);
    expect(mocks.engine.togglePlayPause).not.toHaveBeenCalled();
    await settle();
    expect(dialog()).toBeNull();
  });

  it("opens a settings entry on its section", () => {
    ctrlK();
    type("cover");
    expect(rowTitles()).toEqual(["Settings: Cover glow"]);
    press("Enter");
    expect(mocks.modal.openSettingsSection).toHaveBeenCalledWith("Appearance");
  });

  it("says so when nothing matches", () => {
    ctrlK();
    type("zzz");
    expect(rowTitles()).toEqual([]);
    expect(dialog()!.textContent).toContain("No matching commands");
  });

  it("toggles closed on a second Ctrl+K", async () => {
    ctrlK();
    ctrlK();
    await settle();
    expect(dialog()).toBeNull();
  });

  it("never opens while the library is locked and closes when it locks", async () => {
    useGateStore.setState({ locked: true });
    ctrlK();
    expect(dialog()).toBeNull();
    useGateStore.setState({ locked: false });
    ctrlK();
    expect(dialog()).not.toBeNull();
    act(() => useGateStore.setState({ locked: true }));
    await settle();
    expect(dialog()).toBeNull();
    useGateStore.setState({ locked: false });
  });
});
