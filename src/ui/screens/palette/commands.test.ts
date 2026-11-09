import { describe, expect, it, vi } from "vitest";
import { buildCommands, rankCommands, soundCommands, type CommandDeps } from "./commands";

const EN: Record<string, string> = {
  "ui.palette.home": "Go to Home",
  "ui.palette.library": "Go to Library",
  "ui.palette.search": "Search",
  "ui.palette.settings": "Open Settings",
  "ui.palette.play_pause": "Play or pause",
  "ui.palette.next": "Next track",
  "ui.palette.previous": "Previous track",
  "ui.palette.radio": "Start radio from this track",
  "ui.palette.lyrics": "Open lyrics",
  "ui.palette.shuffle": "Shuffle on or off",
  "ui.palette.repeat": "Change repeat",
  "ui.palette.fullscreen": "Toggle full screen",
  "ui.palette.tour": "Show the tour again",
  "ui.palette.setting": "Settings: {title}",
  "settings.autoplay_similar.title": "Autoplay similar tracks",
  "settings.cover_glow.title": "Cover glow",
};
const RU: Record<string, string> = {
  "ui.palette.repeat": "Сменить режим повтора",
  "ui.palette.lyrics": "Открыть текст песни",
  "ui.palette.tour": "Показать тур ещё раз",
  "settings.cover_glow.title": "Свечение обложки",
};

const BINDINGS: Record<string, string> = {
  "player.toggle": "Space",
  "player.next": "Control+Right",
  "player.previous": "Control+Left",
  "nav.search": "/",
  "nav.lyrics": "F",
  "app.fullscreen": "F11",
};

function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    t: (key, vars) => Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), EN[key] ?? key),
    translations: (key) => [EN[key], RU[key]].filter((text): text is string => Boolean(text)),
    shortcuts: (id) => BINDINGS[id] ?? null,
    settingItems: [
      { tabId: "Playback", titleKey: "settings.autoplay_similar.title" },
      { tabId: "Appearance", titleKey: "settings.cover_glow.title" },
    ],
    actions: {
      home: vi.fn(),
      library: vi.fn(),
      search: vi.fn(),
      settings: vi.fn(),
      play_pause: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      radio: vi.fn(),
      lyrics: vi.fn(),
      shuffle: vi.fn(),
      repeat: vi.fn(),
      fullscreen: vi.fn(),
      tour: vi.fn(),
    },
    openSettings: vi.fn(),
    ...overrides,
  };
}

const titles = (query: string) => rankCommands(buildCommands(deps()), query).map((command) => command.title);

describe("buildCommands", () => {
  it("lists navigation, playback, window and one entry per settings item, with shortcuts from the bindings", () => {
    const commands = buildCommands(deps());
    expect(commands.map((command) => command.group)).toEqual([
      "go",
      "go",
      "go",
      "go",
      "playback",
      "playback",
      "playback",
      "playback",
      "playback",
      "playback",
      "playback",
      "window",
      "window",
      "settings",
      "settings",
    ]);
    const shortcut = (title: string) => commands.find((command) => command.title === title)?.shortcut;
    expect(shortcut("Play or pause")).toBe("Space");
    expect(shortcut("Next track")).toBe("Control+Right");
    expect(shortcut("Open lyrics")).toBe("F");
    expect(shortcut("Search")).toBe("/");
    expect(shortcut("Toggle full screen")).toBe("F11");
    expect(shortcut("Go to Home")).toBeUndefined();
    expect(commands.at(-1)?.title).toBe("Settings: Cover glow");
  });

  it("shows the tour again, found in English and Russian", () => {
    const d = deps();
    expect(titles("tour")).toContain("Show the tour again");
    expect(titles("тур")).toContain("Show the tour again");
    buildCommands(d)
      .find((command) => command.id === "tour")!
      .run();
    expect(d.actions.tour).toHaveBeenCalledOnce();
  });

  it("opens a settings entry on its section", () => {
    const d = deps();
    buildCommands(d)
      .find((command) => command.title === "Settings: Cover glow")!
      .run();
    expect(d.openSettings).toHaveBeenCalledWith("Appearance");
  });
});

describe("rankCommands", () => {
  it("suggests five commands in a fixed order for an empty query", () => {
    expect(titles("")).toEqual(["Play or pause", "Open lyrics", "Search", "Next track", "Open Settings"]);
    expect(titles("   ")).toEqual(titles(""));
  });

  it("puts a word-prefix match first", () => {
    expect(titles("ly")[0]).toBe("Open lyrics");
  });

  it("finds a command through its translations in other languages", () => {
    expect(titles("повт")).toEqual(["Change repeat"]);
    expect(titles("СВЕЧ")).toEqual(["Settings: Cover glow"]);
  });

  it("ranks substring matches after word-prefix matches, stable within a rank", () => {
    expect(titles("ra")).toEqual(["Start radio from this track", "Go to Library", "Next track", "Previous track", "Settings: Autoplay similar tracks"]);
    expect(titles("ous")).toEqual(["Previous track"]);
    expect(titles("open s")).toEqual(["Open Settings"]);
  });

  it("treats ё as е", () => {
    const d = deps({ translations: (key) => (key === "ui.palette.next" ? ["Next track", "Ещё трек"] : []) });
    expect(rankCommands(buildCommands(d), "еще").map((command) => command.title)).toEqual(["Next track"]);
    expect(rankCommands(buildCommands(d), "ещё").map((command) => command.title)).toEqual(["Next track"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(titles("zzz")).toEqual([]);
  });
});

describe("sound commands", () => {
  const SOUND: Record<string, string[]> = {
    "sound.title": ["Equalizer", "Эквалайзер"],
    "sound.presets.bass_boost": ["Bass boost", "Усиление басов"],
    "sound.tempo.slowed": ["Slowed", "Замедленно"],
    "player.speed": ["Speed", "Скорость"],
  };
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : (SOUND[key]?.[0] ?? key));
  const build = (eqOn: boolean) => {
    const deps = { toggleEq: vi.fn(), applyEq: vi.fn(), applyTempo: vi.fn() };
    const commands = soundCommands({
      t,
      translations: (key) => SOUND[key] ?? [key],
      eqOn,
      eqPresets: ["bass_boost"],
      ownPresets: ["Car"],
      tempoPresets: [{ key: "slowed", labelKey: "sound.tempo.slowed" }],
      ...deps,
    });
    return { commands, ...deps };
  };

  it("switches the equalizer and applies equalizer and speed presets, found by name in any language", () => {
    const { commands, toggleEq, applyEq, applyTempo } = build(false);
    expect(commands.map((command) => [command.id, command.title])).toEqual([
      ["eq:toggle", "ui.palette.eq_on"],
      ["eq:bass_boost", "ui.palette.eq_preset(Bass boost)"],
      ["eq:Car", "ui.palette.eq_preset(Car)"],
      ["tempo:slowed", "ui.palette.speed_preset(Slowed)"],
    ]);
    expect(commands.every((command) => command.group === "sound")).toBe(true);
    expect(rankCommands(commands, "басов").map((command) => command.id)).toEqual(["eq:bass_boost"]);
    expect(rankCommands(commands, "замедл").map((command) => command.id)).toEqual(["tempo:slowed"]);
    for (const command of commands) command.run();
    expect(toggleEq).toHaveBeenCalledOnce();
    expect(applyEq.mock.calls).toEqual([["bass_boost"], ["Car"]]);
    expect(applyTempo).toHaveBeenCalledWith("slowed");
    expect(build(true).commands[0].title).toBe("ui.palette.eq_off");
  });
});
