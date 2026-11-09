// @vitest-environment jsdom
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Settings } from "./Settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  function store<T extends object>(state: T) {
    const hook = (select?: (value: T) => unknown) => (select ? select(state) : state);
    return Object.assign(hook, { getState: () => state });
  }
  const EN: Record<string, string> = {
    "settings.tabs.playback": "Playback",
    "settings.tabs.shortcuts": "Shortcuts",
    "settings.tabs.appearance": "Appearance",
    "settings.tabs.customization": "Customization",
    "settings.tabs.notch": "Notch",
    "settings.tabs.youtube": "YouTube",
    "settings.tabs.storage": "Cache & Storage",
    "settings.tabs.about": "About",
    "ui.settings.section_sound": "Sound",
    "ui.recs.hidden.section": "Hidden music",
    "ui.recs.hidden.undo": "Show again",
    "settings.theme.description": "Choose the overall appearance of the app.",
    "settings.about.tagline": "Modern desktop music streaming player",
    "settings.autoplay_similar.title": "Autoplay similar tracks",
    "settings.track_double_click.title": "Double-click on a track",
    "settings.track_double_click.play": "Play",
    "settings.track_double_click.queue": "Add to queue",
    "settings.preset.title": "Theme",
    "settings.preset.accent_from_cover": "Accent from the cover",
    "settings.preset.accent_from_cover_description": "The accent colour follows the artwork.",
    "settings.preset.mode_locked_dark": "This theme is dark only",
    "settings.preset.names.vinyl": "Vinyl",
    "settings.theme.system": "System",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "ui.sound.tab_eq": "Equalizer",
    "ui.settings.normalize": "Even out loudness",
    "ui.settings.keep_speed": "Keep speed for next tracks",
    "sound.tempo.slowed": "Slowed",
    "settings.notch.mode": "Show the Notch",
    "settings.notch.mode_off": "Never",
    "settings.youtube.sign_in": "Sign in",
    "settings.youtube.sign_out": "Sign out",
    "settings.storage.no_limit": "No limit",
    "settings.storage.clear_selected": "Clear Selected Cache",
    "settings.storage.clear_button": "Clear Cache ({size})",
    "ui.settings.clear": "Clear",
    "ui.settings.no_match": "No settings match “{query}”",
    "settings.shortcuts.play_pause": "Play / Pause",
    "settings.shortcuts.next_track": "Next track",
    "settings.shortcuts.press_keys": "Press keys...",
    "settings.shortcuts.conflict_error": 'Already used by "{action}"',
  };
  const tempo = { normal: { rate: 1 }, slowed: { rate: 0.85 } };
  const hidden = { suppressions: vi.fn(), undo: vi.fn() };
  return {
    EN,
    tempo,
    hidden,
    modal: store({ settingsOpen: true, settingsSection: null as string | null, closeSettings: vi.fn() }),
    player: store({
      autoplaySimilar: false,
      setAutoplaySimilar: vi.fn(),
      trackDoubleClickBehavior: "play",
      setTrackDoubleClickBehavior: vi.fn(),
      defaultPlaybackContext: "resume",
      setDefaultPlaybackContext: vi.fn(),
      pauseOnDeviceChange: false,
      setPauseOnDeviceChange: vi.fn(),
      keepSpeedAcrossTracks: true,
      setKeepSpeedAcrossTracks: vi.fn(),
      bestQuality: false,
      outputLabel: null,
      outputChosen: null,
      setBestQuality: vi.fn(),
    }),
    sound: store({
      eqEnabled: false,
      setEnabled: vi.fn(),
      autoGain: true,
      setAutoGain: vi.fn(),
      normalization: "off",
      setNormalization: vi.fn(),
      globalTempo: tempo.normal,
      setGlobalTempo: vi.fn(),
    }),
    custom: store({
      preset: "nuvo",
      setPreset: vi.fn(),
      accentFromCover: false,
      setAccentFromCover: vi.fn(),
      coverGlow: true,
      setCoverGlow: vi.fn(),
      setThemeBeforePreset: vi.fn(),
      backgroundImage: null,
      backgroundBlur: 10,
      backgroundDim: 20,
      setBackgroundImage: vi.fn(),
      setBackgroundBlur: vi.fn(),
      setBackgroundDim: vi.fn(),
      resetAll: vi.fn(),
    }),
    notch: store({ mode: "auto", expandOn: "hover", showLyrics: true, pulseOnTrackChange: true, display: "follow", setSettings: vi.fn() }),
    youtube: { signedIn: false, account: null as null | { name: string }, loading: false },
    prefs: { playThroughAccount: true, offerSignIn: true, showAccountPlaylists: false },
    setPrefs: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(() => Promise.resolve()),
    storage: {
      analytics: {
        totalBytes: 300,
        categories: [
          { id: "audio", labelKey: "settings.storage.categories.audio", bytes: 200, color: "#f00" },
          { id: "covers", labelKey: "settings.storage.categories.covers", bytes: 100, color: "#0f0" },
        ],
      },
      clear: vi.fn(() => Promise.resolve()),
      setLimit: vi.fn(() => Promise.resolve()),
    },
    registry: null as null | import("@/data/shortcuts/registry").CommandRegistry,
    setLocale: vi.fn(),
    setThemeMode: vi.fn(),
    look: { preset: "nuvo", mode: "light" },
    store,
  };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: mocks.setLocale,
    t: (key: string, vars?: Record<string, string>) =>
      Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), mocks.EN[key] ?? key),
  }),
  getTranslationsForAllLocales: (key: string) => [mocks.EN[key] ?? key],
  loadAllLocales: () => Promise.resolve(),
}));
vi.mock("../../ports/navigation", () => ({ useModalStore: mocks.modal }));
vi.mock("../../ports/recs", () => ({ recs: mocks.hidden, useExcludedPlaylists: () => null, setPlaylistExcluded: vi.fn() }));
vi.mock("../../ports/library", () => ({ usePlaylistsList: () => ({ data: { playlists: [] } }) }));
vi.mock("../../ports/player", () => ({
  usePlayerStore: mocks.player,
  CROSSFADE_MAX_S: 12,
  playerOutputs: { list: async () => [], choose: vi.fn() },
  playerEngine: {
    crossfadeSeconds: () => 0,
    setCrossfade: vi.fn(),
    setKeepSpeedAcrossTracks: (on: boolean) => mocks.player.getState().setKeepSpeedAcrossTracks(on),
    setBestQuality: (on: boolean) => mocks.player.getState().setBestQuality(on),
  },
}));
vi.mock("../../ports/sound", () => ({
  useSoundStore: mocks.sound,
  TEMPO_PRESETS: mocks.tempo,
  presetOf: (value: { rate: number }) => (value.rate === 1 ? "normal" : "slowed"),
}));
vi.mock("../../ports/settings", () => ({
  useCustomizationStore: mocks.custom,
  selectIsGlassThemeActive: () => false,
  useHasCustomBackground: () => false,
  MIN_WALLPAPER_BLUR: 10,
  LOCALE_OPTIONS: [
    { value: "en", label: "English" },
    { value: "ru", label: "Русский" },
    { value: "de", label: "Deutsch" },
  ],
  PRIMARY_LOCALES: ["en", "ru"],
  useAppVersion: () => "0.2.10",
}));
vi.mock("../../ports/theme", () => ({
  PRESETS: [
    { id: "nuvo", modes: ["light", "dark"] },
    { id: "vinyl", modes: ["dark"] },
  ],
  getPreset: (id: string) => ({ id, modes: id === "vinyl" ? ["dark"] : ["light", "dark"] }),
  presetIconSvg: () => "<svg></svg>",
  revealThemeChange: (apply: () => void) => apply(),
  useLook: () => mocks.look,
  useThemeMode: () => "light",
  useSetThemeMode: () => mocks.setThemeMode,
}));
vi.mock("../../ports/notch", () => ({ useNotchSettingsStore: mocks.notch, getNotchSession: () => Promise.resolve(null) }));
vi.mock("../../ports/youtube", () => ({
  useYoutubeAccount: () => mocks.youtube,
  useYoutubePreferences: () => [mocks.prefs, mocks.setPrefs],
  openYoutubeSignIn: mocks.signIn,
  signOutYoutube: mocks.signOut,
}));
vi.mock("../../ports/covers", () => ({ useCoverSrc: (url: string | undefined) => url, coverSrc: (src: string) => src }));
vi.mock("../../ports/storage", () => ({
  getCachedStorageAnalytics: () => mocks.storage.analytics,
  refreshStorageAnalytics: () => Promise.resolve(mocks.storage.analytics),
  setStorageTabOpen: vi.fn(),
  clearStorageCategories: mocks.storage.clear,
  openCacheFolder: () => Promise.resolve(true),
  formatStorageBytes: (bytes: number) => `${bytes} B`,
  getAudioCacheLimitBytes: () => 3 * 1024 ** 3,
  setAudioCacheLimitBytes: mocks.storage.setLimit,
}));
vi.mock("../../ports/shortcuts", async () => {
  const { CommandRegistry } = await import("@/data/shortcuts/registry");
  const { Recorder } = await import("@/data/shortcuts/recorder");
  const { formatKeycaps } = await import("@/data/shortcuts/accelerator");
  const registry = new CommandRegistry();
  registry.register({ id: "player.toggle", labelKey: "x", group: "playback", defaultApp: "Space", globalAllowed: true, run: () => undefined });
  registry.register({ id: "player.next", labelKey: "x", group: "playback", defaultApp: "Control+Right", globalAllowed: true, run: () => undefined });
  registry.register({ id: "library.like-toggle", labelKey: "x", group: "library", defaultGlobal: "Alt+Shift+L", globalAllowed: true, run: () => undefined });
  const recorder = new Recorder(registry, { release: () => undefined, restore: () => undefined } as never);
  mocks.registry = registry;
  const { useSyncExternalStore } = await import("react");
  let version = 0;
  registry.subscribe(() => (version += 1));
  return {
    useShortcutBindings: () => {
      useSyncExternalStore(
        (listener) => registry.subscribe(listener),
        () => version,
      );
      return (id: string, scope: "app" | "global") => registry.bindingFor(id, scope);
    },
    useRecorderState: () =>
      useSyncExternalStore(
        (listener) => recorder.subscribe(listener),
        () => recorder.state,
      ),
    startRecording: (id: string, scope: "app" | "global") => recorder.start(id, scope),
    stopRecording: () => recorder.stop(),
    recordKey: (event: KeyboardEvent) => {
      recorder.key(event);
      return recorder.recording;
    },
    defaultShortcut: (id: string, scope: "app" | "global") =>
      ({ "player.toggle": "Space", "player.next": "Control+Right" })[scope === "app" ? id : ""] ??
      (id === "library.like-toggle" && scope === "global" ? "Alt+Shift+L" : null),
    resetShortcut: (id: string, scope: "app" | "global") => registry.resetBinding(id, scope),
    resetAllShortcuts: () => registry.resetAllBindings(),
    shortcutKeycaps: (accelerator: string) => formatKeycaps(accelerator, "other"),
  };
});
vi.mock("../../ports/escape", () => {
  let held = 0;
  return {
    isEscapeGuarded: () => held > 0,
    acquireEscapeGuard: () => {
      held += 1;
      return () => {
        held -= 1;
      };
    },
  };
});

let root: Root;
let host: HTMLDivElement;

function render(): void {
  act(() => root.render(<Settings />));
}

function byText(text: string, selector = "button"): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`no ${selector} with text ${text}`);
  return found;
}

function heading(): string {
  return document.querySelector("[role=dialog] h2")?.textContent ?? "";
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function key(target: EventTarget, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function openSection(label: string): void {
  click(byText(label, "[role=tab]"));
}

function switchNamed(name: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${name}"]`)!;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.modal.getState().settingsOpen = true;
  mocks.modal.getState().settingsSection = null;
  mocks.custom.getState().preset = "nuvo";
  mocks.youtube.signedIn = false;
  mocks.youtube.account = null;
  mocks.registry?.resetAllBindings();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("settings frame", () => {
  it("opens on Playback, and on the section the palette or the route asks for", () => {
    render();
    expect(heading()).toBe("Playback");
    act(() => root.unmount());
    root = createRoot(host);
    mocks.modal.getState().settingsSection = "about";
    render();
    expect(heading()).toBe("About");
  });

  it("switches sections from the list, and with the arrow keys", () => {
    render();
    openSection("Appearance");
    expect(heading()).toBe("Appearance");
    expect(document.querySelector("[aria-pressed][data-preset=vinyl]")).not.toBeNull();
    key(document.activeElement!, { key: "ArrowDown" });
    expect(heading()).toBe("Customization");
    key(document.activeElement!, { key: "ArrowUp" });
    key(document.activeElement!, { key: "ArrowUp" });
    expect(heading()).toBe("Shortcuts");
  });

  it("closes on Escape and with the close button", () => {
    render();
    key(window, { key: "Escape" });
    expect(mocks.modal.getState().closeSettings).toHaveBeenCalledTimes(1);
    click(document.querySelector('button[aria-label="common.close"]')!);
    expect(mocks.modal.getState().closeSettings).toHaveBeenCalledTimes(2);
  });

  it("never shows Discord or a link in About", () => {
    mocks.modal.getState().settingsSection = "About";
    render();
    expect(document.querySelector('[role="tabpanel"]')!.textContent).not.toMatch(/discord/i);
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/t\.me|github/i);
    expect(document.body.textContent).toContain("0.2.10");
  });
});

describe("settings search", () => {
  it("narrows the list to sections with a match and shows the matching rows", () => {
    render();
    type(document.querySelector<HTMLInputElement>("input[type=text]")!, "accent");
    const tabs = [...document.querySelectorAll("[role=tab]")].map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(["Appearance"]);
    expect(heading()).toBe("Appearance");
    expect(switchNamed("Accent from the cover")).not.toBeNull();
    expect(document.querySelector("[data-preset]")).toBeNull();
  });

  it("says so when nothing matches", () => {
    render();
    type(document.querySelector<HTMLInputElement>("input[type=text]")!, "zzz");
    expect(document.body.textContent).toContain("No settings match “zzz”");
    expect(document.querySelectorAll("[role=tab]")).toHaveLength(0);
  });
});

describe("each setting writes through its port", () => {
  it("hidden from recommendations: the list from the deep link, Show again per row", async () => {
    mocks.hidden.suppressions.mockResolvedValue([
      { id: 7, scope: "exact", origin: "user", track: { id: "t", title: "Roygbiv", artists: "Boards of Canada", coverUrl: "", durationMs: 1 }, fadesAt: null },
    ]);
    mocks.hidden.undo.mockResolvedValue(true);
    mocks.modal.getState().settingsSection = "hidden";
    await act(async () => root.render(<Settings />));
    expect(heading()).toBe("Hidden music");
    expect(document.body.textContent).toContain("Roygbiv");
    await act(async () => byText("Show again").click());
    expect(mocks.hidden.undo).toHaveBeenCalledWith(7);
    expect(document.body.textContent).not.toContain("Roygbiv");
  });

  it("playback", () => {
    render();
    click(switchNamed("Autoplay similar tracks"));
    expect(mocks.player.getState().setAutoplaySimilar).toHaveBeenCalledWith(true);
    click(byText("Add to queue"));
    expect(mocks.player.getState().setTrackDoubleClickBehavior).toHaveBeenCalledWith("queue");
  });

  it("sound", () => {
    render();
    openSection("Sound");
    click(switchNamed("Equalizer"));
    expect(mocks.sound.getState().setEnabled).toHaveBeenCalledWith(true);
    click(switchNamed("Even out loudness"));
    expect(mocks.sound.getState().setNormalization).toHaveBeenCalledWith("track");
    click(switchNamed("Keep speed for next tracks"));
    expect(mocks.player.getState().setKeepSpeedAcrossTracks).toHaveBeenCalledWith(false);
    click(byText("Slowed"));
    expect(mocks.sound.getState().setGlobalTempo).toHaveBeenCalledWith(mocks.tempo.slowed);
  });

  it("appearance: preset, locked mode, accent and language", () => {
    mocks.modal.getState().settingsSection = "Appearance";
    render();
    click(document.querySelector("[data-preset=vinyl]")!);
    expect(mocks.custom.getState().setPreset).toHaveBeenCalledWith("vinyl");
    click(switchNamed("Accent from the cover"));
    expect(mocks.custom.getState().setAccentFromCover).toHaveBeenCalledWith(true);
    click(byText("Dark"));
    expect(mocks.setThemeMode).toHaveBeenCalledWith("dark");
    click(document.querySelector("button[lang=ru]")!);
    expect(mocks.setLocale).toHaveBeenCalledWith("ru");

    act(() => root.unmount());
    root = createRoot(host);
    mocks.custom.getState().preset = "vinyl";
    render();
    expect((byText("Light") as HTMLButtonElement).disabled).toBe(true);
    expect((byText("Dark") as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).toContain("This theme is dark only");
  });

  it("notch", () => {
    mocks.modal.getState().settingsSection = "Notch";
    render();
    click(byText("Never"));
    expect(mocks.notch.getState().setSettings).toHaveBeenCalledWith({ mode: "off" });
  });

  it("youtube: sign in when signed out, sign out when signed in", () => {
    mocks.modal.getState().settingsSection = "Youtube";
    render();
    click(byText("Sign in"));
    expect(mocks.signIn).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(host);
    mocks.youtube.signedIn = true;
    mocks.youtube.account = { name: "Denys" };
    render();
    expect(document.body.textContent).toContain("Denys");
    click(byText("Sign out"));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("storage: the limit and a confirmed clear", async () => {
    mocks.modal.getState().settingsSection = "Storage";
    render();
    click(byText("No limit", "span"));
    expect(mocks.storage.setLimit).toHaveBeenCalledWith(0);
    click(byText("Clear Cache (300 B)"));
    expect(mocks.storage.clear).not.toHaveBeenCalled();
    const sheet = [...document.querySelectorAll("[role=dialog]")].at(-1)!;
    const confirm = [...sheet.querySelectorAll("button")].find((button) => button.textContent === "Clear")!;
    await act(async () => {
      confirm.click();
    });
    expect(mocks.storage.clear).toHaveBeenCalledWith(["audio", "covers"]);
  });
});

describe("shortcut recording", () => {
  function recordPlayPause(): void {
    mocks.modal.getState().settingsSection = "Shortcuts";
    render();
    click(document.querySelector("[data-shortcut=playPause]")!);
    expect(document.body.textContent).toContain("Press keys...");
  }

  it("stores the next combination", () => {
    recordPlayPause();
    key(window, { key: "L", code: "KeyL", ctrlKey: true, shiftKey: true });
    expect(mocks.registry!.bindingFor("player.toggle", "app")).toBe("Control+Shift+L");
    expect(document.body.textContent).not.toContain("Press keys...");
  });

  it("Escape cancels recording and keeps settings open", () => {
    recordPlayPause();
    key(window, { key: "Escape" });
    expect(document.body.textContent).not.toContain("Press keys...");
    expect(mocks.modal.getState().closeSettings).not.toHaveBeenCalled();
  });

  it("shows a conflict instead of saving it", () => {
    recordPlayPause();
    key(window, { key: "ArrowRight", code: "ArrowRight", ctrlKey: true });
    expect(document.body.textContent).toContain('Already used by "Next track"');
    expect(mocks.registry!.bindingFor("player.toggle", "app")).toBe("Space");
  });
});

it("the old settings modal is gone", () => {
  expect(fs.existsSync(path.resolve(__dirname, "../../../features/settings/ui"))).toBe(false);
});
