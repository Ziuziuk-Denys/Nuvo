import type { TFunction } from "../../ports/i18n";

export type CommandGroup = "go" | "playback" | "sound" | "window" | "settings";

export interface Command {
  id: string;
  group: CommandGroup;
  title: string;
  /** The title in every language, so a Russian query finds an English command and back. */
  keywords: string[];
  /** An accelerator such as "Control+Right". */
  shortcut?: string;
  run(): void;
}

export type ActionId =
  "home" | "library" | "search" | "settings" | "play_pause" | "next" | "previous" | "radio" | "lyrics" | "shuffle" | "repeat" | "fullscreen" | "tour";

export interface CommandDeps {
  t: TFunction;
  /** Every locale's text for a key. */
  translations: (key: string) => string[];
  /** The in-app binding of a registry command, null when it has none. */
  shortcuts: (commandId: string) => string | null;
  settingItems: readonly { tabId: string; titleKey: string }[];
  actions: Record<ActionId, () => void>;
  openSettings: (section: string) => void;
}

const ACTIONS: { id: ActionId; group: CommandGroup; shortcut?: string }[] = [
  { id: "home", group: "go" },
  { id: "library", group: "go" },
  { id: "search", group: "go", shortcut: "nav.search" },
  { id: "settings", group: "go" },
  { id: "play_pause", group: "playback", shortcut: "player.toggle" },
  { id: "next", group: "playback", shortcut: "player.next" },
  { id: "previous", group: "playback", shortcut: "player.previous" },
  { id: "radio", group: "playback" },
  { id: "lyrics", group: "playback", shortcut: "nav.lyrics" },
  { id: "shuffle", group: "playback" },
  { id: "repeat", group: "playback" },
  { id: "fullscreen", group: "window", shortcut: "app.fullscreen" },
  { id: "tour", group: "window" },
];

/** What the empty palette offers, in this order: the commands worth learning a shortcut for. */
const SUGGESTED = ["play_pause", "lyrics", "search", "next", "settings"];

export function buildCommands({ t, translations, shortcuts, settingItems, actions, openSettings }: CommandDeps): Command[] {
  const base = ACTIONS.map(({ id, group, shortcut }): Command => {
    const key = `ui.palette.${id}`;
    return {
      id,
      group,
      title: t(key),
      keywords: translations(key),
      shortcut: (shortcut && shortcuts(shortcut)) || undefined,
      run: actions[id],
    };
  });
  const settings = settingItems.map(({ tabId, titleKey }): Command => ({
    id: `setting:${titleKey}`,
    group: "settings",
    title: t("ui.palette.setting", { title: t(titleKey) }),
    keywords: translations(titleKey),
    run: () => openSettings(tabId),
  }));
  return [...base, ...settings];
}

export interface SoundDeps {
  t: TFunction;
  translations: (key: string) => string[];
  eqOn: boolean;
  /** Built-in equalizer presets by key, then the user's own by name. */
  eqPresets: readonly string[];
  ownPresets: readonly string[];
  /** Speed presets with the key of their label. */
  tempoPresets: readonly { key: string; labelKey: string }[];
  toggleEq(): void;
  applyEq(name: string): void;
  applyTempo(key: string): void;
}

/** The equalizer switch, every equalizer preset and every speed preset, found by the preset's name in any language. */
export function soundCommands({ t, translations, eqOn, eqPresets, ownPresets, tempoPresets, toggleEq, applyEq, applyTempo }: SoundDeps): Command[] {
  const eqWords = translations("sound.title");
  const eq = (id: string, name: string, keywords: string[]): Command => ({
    id: `eq:${id}`,
    group: "sound",
    title: t("ui.palette.eq_preset", { name }),
    keywords: [...eqWords, ...keywords],
    run: () => applyEq(id),
  });
  return [
    { id: "eq:toggle", group: "sound", title: t(eqOn ? "ui.palette.eq_off" : "ui.palette.eq_on"), keywords: eqWords, run: toggleEq },
    ...eqPresets.map((key) => eq(key, t(`sound.presets.${key}`), translations(`sound.presets.${key}`))),
    ...ownPresets.map((name) => eq(name, name, [name])),
    ...tempoPresets.map(({ key, labelKey }) => ({
      id: `tempo:${key}`,
      group: "sound" as const,
      title: t("ui.palette.speed_preset", { name: t(labelKey) }),
      keywords: [...translations("player.speed"), ...translations(labelKey)],
      run: () => applyTempo(key),
    })),
  ];
}

/** Lower case, ё as е, and every run of non-letters as one space. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The empty query gives the suggestions. Otherwise a command whose title or keywords have a word starting
 * with the query comes first, then one that only contains it; the order within a rank is the given order.
 */
export function rankCommands(commands: Command[], query: string): Command[] {
  const needle = normalize(query);
  if (!needle) return SUGGESTED.flatMap((id) => commands.filter((command) => command.id === id));

  const rankOf = (command: Command): number => {
    const texts = [command.title, ...command.keywords].map(normalize);
    if (texts.some((text) => text.startsWith(needle) || text.includes(` ${needle}`))) return 0;
    if (texts.some((text) => text.includes(needle))) return 1;
    return 2;
  };
  const ranked = commands.map((command) => ({ command, rank: rankOf(command) })).filter(({ rank }) => rank < 2);
  // Array.prototype.sort is stable, so equal ranks keep their order
  return ranked.sort((a, b) => a.rank - b.rank).map(({ command }) => command);
}
