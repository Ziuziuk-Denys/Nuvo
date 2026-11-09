// @vitest-environment node
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";
import en from "../../../i18n/locales/en.json";
import ru from "../../../i18n/locales/ru.json";

const SOURCES = [
  "src/imports/report.ts",
  "src/imports/messages.ts",
  "src/ui/screens/imports/ImportSheet.tsx",
  "src/ui/screens/imports/ImportReport.tsx",
  "src/ui/screens/imports/ImportsHost.tsx",
];

const DYNAMIC: Record<string, string[]> = {
  "ui.imports.chip": ["review", "matched", "all"],
  "ui.imports.label": ["exact", "likely", "check", "missing", "already"],
  "ui.imports.source": ["youtube-music", "soundcloud", "apple-music", "deezer"],
  "ui.imports.fallback": ["youtube-music", "soundcloud", "apple-music", "deezer"],
  "ui.imports.empty": ["review", "other"],
  "ui.imports.error": [
    "not_a_link",
    "unsupported_host",
    "bad_link",
    "spotify_file_only",
    "yandex_lists",
    "login_required",
    "missing_name",
    "bad_file",
    "empty",
    "gone",
    "source_changed",
    "network",
    "locked",
    "daemon",
  ],
};
const COUNTED = [
  "ui.imports.reading",
  "ui.imports.songs",
  "ui.imports.started",
  "ui.imports.summary.review",
  "ui.imports.summary.done",
  "ui.imports.notice.partial",
  "ui.imports.notice.partial_spotify",
  "ui.imports.rows_capped",
];

function has(dict: unknown, key: string): boolean {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

describe("import strings", () => {
  it("exist in English and Russian for every key the import screens use", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const used = new Set<string>();
    for (const file of SOURCES) {
      for (const match of fs.readFileSync(path.join(root, file), "utf8").matchAll(/"(ui\.imports\.[a-z_.]+[a-z_])"/g)) used.add(match[1]);
    }
    for (const [prefix, values] of Object.entries(DYNAMIC)) values.forEach((value) => used.add(`${prefix}.${value}`));
    const counted = (key: string) => COUNTED.includes(key);
    const missing = [...used].flatMap((key) => {
      const forms = counted(key) ? { en: ["_one", "_other"], ru: ["_one", "_few", "_many", "_other"] } : { en: [""], ru: [""] };
      return [...forms.en.map((f) => ["en", key + f] as const), ...forms.ru.map((f) => ["ru", key + f] as const)].filter(
        ([lang, k]) => !has(lang === "en" ? en : ru, k),
      );
    });
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(60);
  });
});
