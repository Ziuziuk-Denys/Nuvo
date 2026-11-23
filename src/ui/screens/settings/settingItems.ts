export type SettingsTabId =
  | "Language"
  | "Startup"
  | "Updates"
  | "Playback"
  | "BetweenSongs"
  | "Sound"
  | "Spatial"
  | "Lyrics"
  | "Theme"
  | "Fonts"
  | "Background"
  | "Player"
  | "Motion"
  | "Notch"
  | "Shortcuts"
  | "Youtube"
  | "Lastfm"
  | "Discord"
  | "Privacy"
  | "Storage"
  | "Network"
  | "Tools"
  | "About";

export interface SettingItem {
  tabId: SettingsTabId;
  titleKey: string;
  descKey?: string;
  findKey?: string;
}

const row = (tabId: SettingsTabId, titleKey: string, descKey?: string, find?: string): SettingItem => ({
  tabId,
  titleKey,
  ...(descKey ? { descKey } : {}),
  ...(find ? { findKey: `settings.find.${find}` } : {}),
});
const titled = (tabId: SettingsTabId, base: string, find?: string): SettingItem => row(tabId, `${base}.title`, `${base}.description`, find);
const youtube = (key: string): SettingItem => titled("Youtube", `settings.youtube.${key}`);

// Keep in step with the rows the sections render: settings search and the palette read this list
export const SETTING_ITEMS: SettingItem[] = [
  row("Language", "settings.language.label", "settings.language.description", "language"),
  titled("Startup", "settings.default_playback_context", "startup"),
  titled("Startup", "ui.settings.close_to_tray", "tray"),
  titled("Startup", "ui.settings.menu_entry", "menu_entry"),
  titled("Updates", "ui.settings.launch_check", "updates"),
  titled("Updates", "ui.settings.auto_update", "updates"),
  row("Updates", "ui.settings.whats_new.link", undefined, "whats_new"),
  titled("Playback", "settings.track_double_click", "click"),
  row("Playback", "ui.settings.default_speed", "ui.settings.default_speed_desc", "speed"),
  titled("BetweenSongs", "settings.autoplay_similar", "autoplay"),
  row("BetweenSongs", "ui.settings.crossfade", "ui.settings.crossfade_desc", "crossfade"),
  row("BetweenSongs", "ui.settings.keep_speed", "player.keep_speed_hint", "speed"),
  row("Sound", "ui.settings.output", "ui.settings.output_desc", "output"),
  titled("Sound", "settings.audio.pause_on_device_change", "output"),
  row("Sound", "ui.settings.best_quality", "ui.settings.best_quality_desc", "quality"),
  row("Sound", "ui.sound.tab_eq", "ui.settings.eq_desc", "equalizer"),
  row("Sound", "sound.auto_gain", "ui.settings.auto_gain_desc", "volume"),
  row("Sound", "ui.settings.normalize", "ui.settings.normalize_desc", "volume"),
  row("Spatial", "sound.moving.title", "sound.moving.hint", "spatial"),
  row("Spatial", "sound.moving.path", "sound.moving.path_desc"),
  row("Spatial", "sound.moving.speed", "sound.moving.speed_desc"),
  titled("Lyrics", "settings.lyrics_highlight", "karaoke"),
  titled("Lyrics", "settings.karaoke_controls", "karaoke"),
  titled("Lyrics", "settings.word_timing", "karaoke"),
  titled("Lyrics", "settings.lyrics_model"),
  titled("Lyrics", "settings.visual_player", "scene"),
  row("Theme", "settings.preset.title", "settings.preset.description", "theme"),
  row("Theme", "settings.page.mode", "settings.theme.description", "dark"),
  titled("Theme", "settings.navigation", "navigation"),
  row("Theme", "settings.preset.accent_from_cover", "settings.preset.accent_from_cover_description", "accent"),
  row("Theme", "appearance.css.title", "appearance.css.warning", "css"),
  row("Theme", "appearance.safe.reset_title", "appearance.safe.reset_desc"),
  row("Theme", "settings.customization.reset_all", "settings.customization.reset_all_desc"),
  row("Fonts", "appearance.fonts.ui", "appearance.fonts.title", "fonts"),
  row("Fonts", "appearance.fonts.lyrics", "appearance.fonts.title", "fonts"),
  row("Fonts", "appearance.fonts.ui_size", "appearance.fonts.title", "fonts"),
  row("Fonts", "appearance.fonts.files", "appearance.fonts.title"),
  row("Background", "settings.customization.wallpaper_title", "settings.customization.wallpaper_description", "wallpaper"),
  titled("Player", "settings.player_controls", "player"),
  titled("Player", "settings.cover_glow", "glow"),
  titled("Motion", "settings.look_quality", "look_quality"),
  titled("Motion", "settings.reduce_effects", "motion"),
  titled("Motion", "settings.frame_rate", "motion"),
  row("Notch", "settings.notch.mode", "settings.notch.description", "notch"),
  row("Notch", "settings.notch.expand_on"),
  row("Notch", "settings.notch.show_lyrics"),
  row("Notch", "settings.notch.pulse"),
  row("Notch", "settings.notch.display", undefined, "monitor"),
  row("Notch", "settings.notch.position"),
  row("Notch", "settings.notch.edge", "settings.notch.edge_desc"),
  row("Notch", "settings.notch.offset", "settings.notch.offset_desc"),
  row("Notch", "settings.notch.stacking", "settings.notch.stacking_desc"),
  row("Notch", "settings.notch.panel", undefined, "panel"),
  youtube("account_playback"),
  youtube("prompt_sign_in"),
  youtube("sync_library"),
  titled("Lastfm", "settings.lastfm.enabled", "scrobble"),
  titled("Lastfm", "settings.lastfm.keys"),
  titled("Discord", "settings.discord.enabled", "discord"),
  titled("Privacy", "ui.settings.stats_pause", "history"),
  row("Privacy", "ui.recs.hidden.section", "ui.recs.hidden.description", "hidden"),
  row("Storage", "settings.storage.cache_limit", "settings.storage.cache_limit_desc", "cache"),
  titled("Storage", "ui.settings.save_format", "save_format"),
  titled("Network", "ui.settings.offline_mode", "offline"),
  row("Network", "ui.settings.proxy.title", undefined, "proxy"),
  row("Network", "ui.settings.proxy_url", "ui.settings.proxy_url_desc", "proxy"),
  row("Network", "ui.settings.connection", "ui.settings.connection_desc"),
  row("Network", "ui.settings.report", "ui.settings.report_desc"),
  titled("Tools", "ui.settings.tools", "tools"),
  row("About", "ui.settings.problem.title", undefined, "help"),
];
