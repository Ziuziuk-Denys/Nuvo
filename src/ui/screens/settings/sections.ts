import { getTranslationsForAllLocales } from "../../ports/i18n";
import { SETTING_ITEMS, type SettingsTabId } from "./settingItems";

export type SectionId = SettingsTabId | "Hidden";

export const SECTIONS: Record<SectionId, { labelKey: string; descKey: string }> = {
  Playback: { labelKey: "settings.tabs.playback", descKey: "settings.playback.description" },
  Sound: { labelKey: "ui.settings.section_sound", descKey: "ui.settings.sound_desc" },
  Hidden: { labelKey: "ui.recs.hidden.section", descKey: "ui.recs.hidden.description" },
  Shortcuts: { labelKey: "settings.tabs.shortcuts", descKey: "settings.shortcuts.description" },
  Appearance: { labelKey: "settings.tabs.appearance", descKey: "settings.page.appearance" },
  Customization: { labelKey: "settings.page.background", descKey: "settings.page.background_desc" },
  Notch: { labelKey: "settings.tabs.notch", descKey: "settings.notch.description" },
  Youtube: { labelKey: "settings.tabs.youtube", descKey: "settings.youtube.description" },
  Lastfm: { labelKey: "settings.tabs.lastfm", descKey: "settings.lastfm.description" },
  Discord: { labelKey: "settings.tabs.discord", descKey: "settings.discord.description" },
  Storage: { labelKey: "settings.tabs.storage", descKey: "settings.storage.description" },
  Network: { labelKey: "ui.settings.section_network", descKey: "ui.settings.network_desc" },
  About: { labelKey: "settings.tabs.about", descKey: "settings.about.tagline" },
};

export const SECTION_GROUPS: { labelKey: string; ids: SectionId[] }[] = [
  { labelKey: "settings.groups.player", ids: ["Playback", "Sound", "Hidden", "Shortcuts"] },
  { labelKey: "settings.groups.interface", ids: ["Appearance", "Customization", "Notch"] },
  { labelKey: "settings.groups.integrations", ids: ["Youtube", "Lastfm", "Discord"] },
  { labelKey: "settings.groups.application", ids: ["Storage", "Network", "About"] },
];

export const SECTION_ORDER: SectionId[] = SECTION_GROUPS.flatMap((group) => group.ids);

export function sectionFromParam(value: string | null | undefined): SectionId | null {
  if (!value) return null;
  const wanted = value.toLowerCase();
  return SECTION_ORDER.find((id) => id.toLowerCase() === wanted) ?? null;
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
    if (matchesQuery(query, [SECTIONS[id].labelKey, SECTIONS[id].descKey])) found.add(id);
  }
  for (const item of SETTING_ITEMS) {
    if (matchesQuery(query, [item.titleKey, item.descKey])) found.add(item.tabId);
  }
  return found;
}
