import { getTranslationsForAllLocales } from "../../ports/i18n";
import { SETTING_ITEMS, type SettingsTabId } from "./settingItems";

export type SectionId = SettingsTabId;

const section = (key: string) => ({
  labelKey: `settings.sections.${key}.title`,
  descKey: `settings.sections.${key}.description`,
  findKey: `settings.sections.${key}.find`,
});

export const SECTIONS: Record<SectionId, { labelKey: string; descKey: string; findKey: string }> = {
  Language: section("language"),
  Startup: section("startup"),
  Updates: section("updates"),
  Playback: section("playback"),
  BetweenSongs: section("between_songs"),
  Sound: section("sound"),
  Spatial: section("spatial"),
  Lyrics: section("lyrics"),
  Theme: section("theme"),
  Fonts: section("fonts"),
  Background: section("background"),
  Player: section("player"),
  Motion: section("motion"),
  Notch: section("notch"),
  Shortcuts: section("shortcuts"),
  Youtube: section("youtube"),
  Lastfm: section("lastfm"),
  Discord: section("discord"),
  Privacy: section("privacy"),
  Storage: section("storage"),
  Network: section("network"),
  Tools: section("tools"),
  About: section("about"),
};

export const SECTION_GROUPS: { labelKey?: string; ids: SectionId[] }[] = [
  { ids: ["Language", "Startup", "Updates"] },
  { labelKey: "settings.groups.music", ids: ["Playback", "BetweenSongs", "Sound", "Spatial", "Lyrics"] },
  { labelKey: "settings.groups.look", ids: ["Theme", "Fonts", "Background", "Player", "Motion", "Notch", "Shortcuts"] },
  { labelKey: "settings.groups.services", ids: ["Youtube", "Lastfm", "Discord"] },
  { labelKey: "settings.groups.application", ids: ["Privacy", "Storage", "Network", "Tools", "About"] },
];

export const SECTION_ORDER: SectionId[] = SECTION_GROUPS.flatMap((group) => group.ids);

const RENAMED: Record<string, SectionId> = {
  hidden: "Privacy",
  appearance: "Theme",
  customization: "Background",
};

export function sectionFromParam(value: string | null | undefined): SectionId | null {
  if (!value) return null;
  const wanted = value.toLowerCase().replace(/[-_ ]/g, "");
  return RENAMED[wanted] ?? SECTION_ORDER.find((id) => id.toLowerCase() === wanted) ?? null;
}

const FIND_KEYS = new Map(SETTING_ITEMS.flatMap((item) => (item.findKey ? [[item.titleKey, item.findKey] as const] : [])));

export function findKeyFor(titleKey: string | undefined): string | undefined {
  return titleKey ? FIND_KEYS.get(titleKey) : undefined;
}

export function matchesQuery(query: string, keys: (string | undefined)[], texts: string[] = []): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const all = [...texts, ...keys.flatMap((key) => (key ? getTranslationsForAllLocales(key) : []))];
  return all.some((text) => text.toLowerCase().includes(needle));
}

export function matchingSections(query: string): Set<SectionId> {
  const found = new Set<SectionId>();
  for (const id of SECTION_ORDER) {
    const { labelKey, descKey, findKey } = SECTIONS[id];
    if (matchesQuery(query, [labelKey, descKey, findKey])) found.add(id);
  }
  for (const item of SETTING_ITEMS) {
    if (matchesQuery(query, [item.titleKey, item.descKey, item.findKey])) found.add(item.tabId);
  }
  return found;
}
