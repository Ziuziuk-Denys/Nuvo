// @vitest-environment node
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import { ENTRY_SORTS, LIBRARY_TABS, LOCAL_SORTS } from "../ui/screens/library/libraryModel";
import { flattenTexts } from "./text";

const SRC = path.resolve(__dirname, "..");
const ROOTS = [
  "ui",
  "engine",
  "youtube",
  "links",
  "imports",
  "data",
  "notch",
  "shell",
  "local",
  "lyrics",
  "features",
  "main.tsx",
  "playerBoot.ts",
  "youtubeBoot.ts",
];
const NAMESPACES = "ui|sound|common|import|artist|core|library|player|playlist|search|settings|track_search";
const EXEMPT = "appearance.";

const DYNAMIC: Record<string, string[]> = {
  "library.search_": LIBRARY_TABS,
  "player.repeat_": ["off", "all", "one"],
  "settings.notch.panel_": ["gnome", "plasma", "waybar", "ready", "relogin", "add_widget"],
  "settings.notch.panel_manual_": ["gnome", "plasma", "waybar"],
  "settings.preset.names.": ["nuvo", "editor", "orbit", "vinyl", "cosmos", "sunset", "amethyst", "y2k", "cassette"],
  "settings.shortcuts.": [
    "play_pause",
    "next_track",
    "prev_track",
    "seek_forward",
    "seek_backward",
    "volume_up",
    "volume_down",
    "toggle_mute",
    "search",
    "toggle_queue",
    "toggle_fullscreen",
    "recognize",
    "loop_a",
    "loop_b",
    "loop_clear",
    "quick_like_song",
  ],
  "settings.theme.": ["system", "light", "dark"],
  "settings.youtube.": ["account_playback", "prompt_sign_in", "sync_library"].flatMap((name) => [`${name}.title`, `${name}.description`]),
  "sound.presets.": [
    "flat",
    "bass_boost",
    "bass_reducer",
    "vocal",
    "treble_boost",
    "loudness",
    "electronic",
    "rock",
    "hip_hop",
    "acoustic",
    "podcast",
    "night",
  ],
  "ui.commands.": [],
  "ui.entity.sort_": ["default", "title", "duration", "added", "artist", "album"],
  "ui.eq.bands.": ["31", "62", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"],
  "ui.home.mood_": ["energy", "calm", "bright", "late_night"],
  "ui.karaoke.repeat_": ["off", "all", "one"],
  "ui.local.unsupported_": ["unreadable", "alac", "format", "wav_codec"],
  "ui.network_advice.": ["offline", "proxy_failed", "blocked", "refused", "tls_intercepted", "clock"],
  "ui.recs.hidden.scope_": ["exact", "work", "artist", "artist_forever"],
  "ui.settings.tools.status_": ["ok", "outdated", "missing", "broken"],
  "ui.recognize.error.": ["no_capture", "network", "busy", "tool_missing", "decode_failed", "unavailable", "unsupported", "core_down", "locked", "failed"],
  "ui.recognize.error_link.": [
    "invalid_link",
    "unsupported",
    "unavailable",
    "login_required",
    "age_gated",
    "drm",
    "blocked",
    "throttled",
    "tool_missing",
    "decode_failed",
    "proxy_unsupported",
  ],
  "ui.recognize.listening_": ["microphone", "system"],
  "ui.recognize.no_access_": ["microphone", "system"],
  "ui.recognize.no_access_title_": ["microphone", "system"],
  "ui.tour.brief.": ["search", "search_line", "recognize", "recognize_line", "sound", "sound_line", "library", "library_line", "look", "look_line"],
  "ui.tour.chapters.": ["search", "recognize", "player", "sound", "playlists", "library", "home", "look"],
  "ui.stats.": [
    ...["playlist", "album", "artist", "radio", "mix", "search", "local", "other"].map((kind) => `source.${kind}`),
    ...["stream", "cache", "local", "other"].map((kind) => `origin.${kind}`),
  ],
  "ui.stats.source.": ["playlist", "album", "artist", "radio", "mix", "search", "local", "other"],
  "ui.stats.lead_": ["week", "month", "year"],
  "ui.stats.part.": ["night", "morning", "afternoon", "evening"].flatMap((part) => [`${part}.name`, `${part}.listener`, `${part}.when`]),
  "ui.stats.on_day.": ["0", "1", "2", "3", "4", "5", "6"],
  "ui.stats.range_": ["week", "month", "year", "all"],
  "ui.history.filter_": ["all", "completed", "skipped"],
  "ui.stats.top_": ["tracks", "artists", "albums", "playlists", "genres"],
  "ui.tour.prompt.": ["chapter", "chapter_line", "later", "later_line", "all", "all_line"],
  "ui.tour.start.sources.": ["spotify", "apple", "deezer", "youtube", "soundcloud"].flatMap((name) => [name, `${name}_line`]),
  "ui.tour.steps.": [
    "add",
    "eq",
    "library_import",
    "library_tabs",
    "like",
    "mixes",
    "home_start",
    "modes",
    "new_playlist",
    "presets",
    "queue",
    "rail_recognize",
    "rail_search",
    "recognize_sources",
    "scrubber",
    "search_field",
    "sleep",
    "speed",
  ],
  "ui.imports.chip.": ["review", "matched", "all"],
  "ui.imports.empty.": ["review", "other"],
  "ui.imports.error.": [
    "not_a_link",
    "unsupported_host",
    "bad_link",
    "spotify_file_only",
    "region_blocked",
    "login_required",
    "missing_name",
    "bad_file",
    "empty",
    "gone",
    "source_changed",
    "network",
    "locked",
    "daemon",
    "cut",
  ],
  "ui.imports.fallback.": ["youtube-music", "soundcloud", "apple-music", "deezer", "spotify", "yandex-music"],
  "ui.imports.label.": ["exact", "likely", "check", "missing", "already"],
  "ui.imports.notice.": ["capped", "cut"],
  "ui.imports.search.": ["none", "failed"],
  "ui.imports.source.": ["youtube-music", "soundcloud", "apple-music", "deezer", "spotify", "yandex-music"],
  "ui.library.empty_": LIBRARY_TABS.filter((tab) => tab !== "local"),
  "ui.library.tab_": LIBRARY_TABS,
  "ui.library.sort.": [...new Set([...ENTRY_SORTS, ...LOCAL_SORTS])],
  "ui.links.error.": [
    "failed",
    "invalid_link",
    "unsupported",
    "unavailable",
    "login_required",
    "region_blocked",
    "age_gated",
    "drm",
    "blocked",
    "throttled",
    "tool_missing",
    "decode_failed",
    "busy",
    "network",
    "newer_link",
    "bad_share",
    "spotify_file_only",
    "core_down",
    "locked",
    "proxy_unsupported",
  ],
  "ui.links.service.": ["nuvo", "web"],
  "ui.links.stage.": ["reading_tiktok", "reading_link", "looking", "listening_sound", "listening_video"],
  "ui.links.via.": ["link", "tiktok_name", "recognized_sound", "recognized_video", "by_name", "media_tags", "share_gone"],
  "ui.palette.": ["home", "library", "search", "settings", "play_pause", "next", "previous", "radio", "lyrics", "shuffle", "repeat", "fullscreen", "tour"],
  "ui.palette.group_": ["go", "playback", "sound", "window", "settings"],
  "ui.recs.notice.": ["exact", "work", "artist", "artist_forever"],
  "ui.settings.proxy.": ["system", "none", "manual"],
  "ui.search.tab_": ["all", "songs", "albums", "artists", "playlists"],
  "ui.search.source_": ["all", "youtube", "soundcloud"],
};

const JOINED = [
  "change_button",
  "dark_theme_only",
  "file_too_large",
  "invalid_file_type",
  "read_error",
  "remove_button",
  "upload_hint",
  "upload_title",
  "wallpaper_blur",
  "wallpaper_dim",
].map((name) => `settings.customization.${name}`);

const LITERAL = new RegExp(`["'\`]((?:${NAMESPACES})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_-]+)*)["'\`]`, "g");
const TEMPLATE = new RegExp(`\`((?:${NAMESPACES})\\.[A-Za-z0-9_.-]*)\\$\\{`, "g");
const PLURAL = /_(?:zero|one|two|few|many|other|plural)$/;
const CONCAT = new RegExp(`["'](?:${NAMESPACES})\\.[A-Za-z0-9_.-]*\\.["']\\s*\\+`);
const COUNT_WITHOUT_FORMS = ["ui.local.scan_missing_many", "ui.recs.hidden.fades", "ui.bulk.selected", "artist.monthly_audience", "settings.lastfm.queued"];
const EN_FORMS = ["_one", "_other"];
const RU_FORMS = ["_one", "_few", "_many", "_other"];

const IDS_ONLY = ["data/shortcuts"];

function sourceFiles(entry: string): string[] {
  const full = path.join(SRC, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).flatMap((name) => sourceFiles(path.join(entry, name)));
  return /\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry) ? [full] : [];
}

const glued: string[] = [];

function scan(): { literals: Set<string>; templates: Set<string> } {
  const literals = new Set<string>();
  const templates = new Set<string>();
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const code = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (!IDS_ONLY.some((dir) => file.includes(`${path.sep}${dir}${path.sep}`))) for (const match of code.matchAll(LITERAL)) literals.add(match[1]);
    for (const match of code.matchAll(TEMPLATE)) templates.add(match[1]);
    if (CONCAT.test(code)) glued.push(path.relative(SRC, file));
  }
  return { literals, templates };
}

const { literals, templates } = scan();
const used = new Set([...literals, ...JOINED, ...Object.entries(DYNAMIC).flatMap(([prefix, values]) => values.map((value) => prefix + value))]);
const EN = flattenTexts(en);
const RU = flattenTexts(ru);

const isPluralForm = (table: Map<string, string>, key: string) =>
  PLURAL.test(key) && (table.has(key.replace(PLURAL, "_other")) || table.has(key.replace(PLURAL, "_plural")));
const baseOf = (table: Map<string, string>, key: string) => (isPluralForm(table, key) ? key.replace(PLURAL, "") : key);
const bases = (table: Map<string, string>) => new Set([...table.keys()].map((key) => baseOf(table, key)));
const resolves = (table: Map<string, string>, key: string, forms: string[]) =>
  table.has(key) || forms.every((form) => table.has(key + form)) || [...table.keys()].some((name) => name.startsWith(`${key}.`));
const placeholders = (table: Map<string, string>, base: string) =>
  [...table].filter(([key]) => baseOf(table, key) === base).flatMap(([, text]) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]));

describe("translation keys", () => {
  it("finds the code it checks", () => {
    expect(used.size).toBeGreaterThan(300);
  });

  it("every key the code builds at run time is listed", () => {
    expect([...templates].filter((prefix) => !(prefix in DYNAMIC)).sort()).toEqual([]);
    expect(
      Object.keys(DYNAMIC)
        .filter((prefix) => !templates.has(prefix))
        .sort(),
    ).toEqual([]);
  });

  it("no key is glued together with +", () => {
    expect(glued).toEqual([]);
  });

  it("every text that shows a count has its plural forms", () => {
    const loose = [...EN]
      .filter(([key, text]) => !key.startsWith(EXEMPT) && text.includes("{count}") && !isPluralForm(EN, key))
      .map(([key]) => key)
      .filter((key) => !COUNT_WITHOUT_FORMS.includes(key));
    expect(loose).toEqual([]);
  });

  it("every key the code uses exists in English and Russian", () => {
    const missing = [...used].flatMap((key) => [...(resolves(EN, key, EN_FORMS) ? [] : [`en ${key}`]), ...(resolves(RU, key, RU_FORMS) ? [] : [`ru ${key}`])]);
    expect(missing.sort()).toEqual([]);
  });

  it("no key is left over", () => {
    const unused = (table: Map<string, string>) =>
      [...table.keys()].filter(
        (key) => !key.startsWith(EXEMPT) && !used.has(key) && !used.has(baseOf(table, key)) && ![...used].some((name) => key.startsWith(`${name}.`)),
      );
    expect([...unused(EN), ...unused(RU).map((key) => `ru ${key}`)].sort()).toEqual([]);
  });

  it("Russian and English hold the same keys", () => {
    const en = bases(EN);
    const ru = bases(RU);
    expect([...en].filter((key) => !ru.has(key)).sort()).toEqual([]);
    expect([...ru].filter((key) => !en.has(key)).sort()).toEqual([]);
  });

  it("every counted key has its forms", () => {
    const families = [...EN.keys()].filter((key) => isPluralForm(EN, key)).map((key) => key.replace(PLURAL, ""));
    const broken = [...new Set(families)].flatMap((base) => [
      ...(EN.has(`${base}_one`) && (EN.has(`${base}_other`) || EN.has(`${base}_plural`)) ? [] : [`en ${base}`]),
      ...RU_FORMS.filter((form) => !RU.has(base + form)).map((form) => `ru ${base}${form}`),
    ]);
    expect(broken).toEqual([]);
  });

  it("placeholders match between the languages", () => {
    const differ = [...bases(EN)]
      .filter((base) => !base.startsWith(EXEMPT))
      .filter((base) => [...new Set(placeholders(EN, base))].sort().join() !== [...new Set(placeholders(RU, base))].sort().join());
    expect(differ).toEqual([]);
  });

  it("texts follow the copy rules", () => {
    const broken = [...EN, ...RU]
      .filter(([key]) => !key.startsWith(EXEMPT))
      .filter(([, text]) => text === "" || text !== text.trim() || text.includes("!") || text.includes("..."))
      .map(([key, text]) => `${key}: ${text}`);
    expect(broken).toEqual([]);
  });
});
