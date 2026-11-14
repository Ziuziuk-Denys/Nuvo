export type SettingsTabId =
  "Playback" | "Sound" | "Shortcuts" | "Appearance" | "Customization" | "Notch" | "Youtube" | "Lastfm" | "Discord" | "Storage" | "Network" | "About";

export interface SettingItem {
  tabId: SettingsTabId;
  titleKey: string;
  descKey?: string;
}

const row = (tabId: SettingsTabId, titleKey: string, descKey?: string): SettingItem => (descKey ? { tabId, titleKey, descKey } : { tabId, titleKey });
const playback = (base: string): SettingItem => row("Playback", `${base}.title`, `${base}.description`);
const youtube = (key: string): SettingItem => row("Youtube", `settings.youtube.${key}.title`, `settings.youtube.${key}.description`);

// Keep in step with the rows the sections render: settings search and the palette read this list
export const SETTING_ITEMS: SettingItem[] = [
  playback("settings.autoplay_similar"),
  playback("settings.track_double_click"),
  playback("settings.default_playback_context"),
  playback("settings.lyrics_highlight"),
  row("Playback", "ui.settings.close_to_tray.title", "ui.settings.close_to_tray.description"),
  row("Playback", "ui.settings.menu_entry.title", "ui.settings.menu_entry.description"),
  row("Playback", "ui.settings.stats_pause.title", "ui.settings.stats_pause.description"),
  row("Sound", "ui.settings.output", "ui.settings.output_desc"),
  row("Sound", "settings.audio.pause_on_device_change.title", "settings.audio.pause_on_device_change.description"),
  row("Sound", "ui.sound.tab_eq", "ui.settings.eq_desc"),
  row("Sound", "sound.auto_gain", "ui.settings.auto_gain_desc"),
  row("Sound", "ui.settings.normalize", "ui.settings.normalize_desc"),
  row("Sound", "ui.settings.best_quality", "ui.settings.best_quality_desc"),
  row("Sound", "ui.settings.crossfade", "ui.settings.crossfade_desc"),
  row("Sound", "ui.settings.keep_speed", "player.keep_speed_hint"),
  row("Sound", "ui.settings.default_speed", "ui.settings.default_speed_desc"),
  row("Appearance", "settings.preset.title", "settings.preset.description"),
  row("Appearance", "settings.page.mode", "settings.theme.description"),
  row("Appearance", "settings.preset.accent_from_cover", "settings.preset.accent_from_cover_description"),
  row("Appearance", "appearance.fonts.ui", "appearance.fonts.title"),
  row("Appearance", "appearance.fonts.lyrics", "appearance.fonts.title"),
  row("Appearance", "appearance.fonts.ui_size", "appearance.fonts.title"),
  row("Appearance", "appearance.fonts.files", "appearance.fonts.title"),
  row("Appearance", "settings.language.label", "settings.language.description"),
  row("Appearance", "appearance.css.title", "appearance.css.warning"),
  row("Appearance", "appearance.safe.reset"),
  row("Appearance", "settings.customization.reset_all", "settings.customization.reset_all_desc"),
  row("Customization", "settings.customization.wallpaper_title", "settings.customization.wallpaper_description"),
  row("Customization", "settings.cover_glow.title", "settings.cover_glow.description"),
  row("Customization", "settings.reduce_effects.title", "settings.reduce_effects.description"),
  row("Customization", "settings.frame_rate.title", "settings.frame_rate.description"),
  row("Notch", "settings.notch.mode", "settings.notch.description"),
  row("Notch", "settings.notch.expand_on"),
  row("Notch", "settings.notch.show_lyrics"),
  row("Notch", "settings.notch.pulse"),
  row("Notch", "settings.notch.display"),
  youtube("account_playback"),
  youtube("prompt_sign_in"),
  youtube("sync_library"),
  row("Lastfm", "settings.lastfm.enabled.title", "settings.lastfm.enabled.description"),
  row("Lastfm", "settings.lastfm.keys.title", "settings.lastfm.keys.description"),
  row("Discord", "settings.discord.enabled.title", "settings.discord.enabled.description"),
  row("Network", "ui.settings.offline_mode.title", "ui.settings.offline_mode.description"),
  row("Network", "ui.settings.proxy.title"),
  row("Network", "ui.settings.proxy_url", "ui.settings.proxy_url_desc"),
  row("Network", "ui.settings.connection", "ui.settings.connection_desc"),
  row("Network", "ui.settings.report", "ui.settings.report_desc"),
  row("Network", "ui.settings.tools.title", "ui.settings.tools.description"),
  row("Storage", "settings.storage.cache_limit", "settings.storage.cache_limit_desc"),
  row("Storage", "ui.settings.save_format.title", "ui.settings.save_format.description"),
  row("About", "ui.settings.auto_update.title", "ui.settings.auto_update.description"),
  row("About", "ui.settings.whats_new.link"),
  row("About", "ui.settings.problem.title"),
];
