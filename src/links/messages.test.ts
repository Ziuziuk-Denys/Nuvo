import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import ru from "@/i18n/locales/ru.json";
import { flattenTexts, interpolate, lookUp, type Vars } from "@/i18n/text";
import { deliverShareLink, onShareLink } from "./inbox";
import { displayText, errorMessage, notFoundMessage, serviceLabel, stageMessage, viaMessage, type Message } from "./messages";
import { toPlayerTrack } from "./playerTrack";
import type { FoundVia, Stage } from "./resolve";

const TABLES = { en: flattenTexts(en), ru: flattenTexts(ru) };

function translatorFor(locale: "en" | "ru") {
  return (key: string, vars?: Vars): string => {
    const text = lookUp(TABLES[locale], locale, TABLES.en, key, vars) ?? key;
    return vars ? interpolate(text, vars, locale) : text;
  };
}

const STAGES: Stage[] = [
  { stage: "reading_tiktok" },
  { stage: "reading_link" },
  { stage: "looking", title: "x" },
  { stage: "listening_sound" },
  { stage: "listening_video" },
];
const VIAS: FoundVia[] = ["link", "tiktok_name", "recognized_sound", "recognized_video", "by_name", "media_tags", "share_gone"];
const CODES = [
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
  "yandex_lists",
  "core_down",
  "locked",
  "proxy_unsupported",
  "failed",
];

function all(): Message[] {
  return [
    ...STAGES.map(stageMessage),
    ...VIAS.map(viaMessage),
    ...CODES.map((code) => errorMessage(code, "TikTok", "example.com")),
    ...(["named_sound", "original_sound", "sound_page", "song"] as const).map((reason) => notFoundMessage({ kind: "not_found", reason, more: false })),
    notFoundMessage({
      kind: "not_found",
      reason: "song",
      title: "x",
      more: false,
    }),
  ];
}

describe("link strings", () => {
  it("every key exists in English and Russian", () => {
    for (const locale of ["en", "ru"] as const) {
      const dict = Object.fromEntries(TABLES[locale]);
      for (const { key } of all()) expect(dict[key], `${locale} ${key}`).toBeTruthy();
      for (const key of ["ui.links.service.nuvo", "ui.links.share.copy_link", "ui.links.preview.import", "ui.search.hint"])
        expect(dict[key], `${locale} ${key}`).toBeTruthy();
    }
  });

  it("reads as specified", () => {
    const t = translatorFor("en");
    const say = ({ key, vars }: Message) => t(key, vars);
    expect(say(errorMessage("unsupported", "Link", "example.com"))).toBe("Nuvo can't read links from example.com yet. Search the song name instead.");
    expect(say(errorMessage("proxy_unsupported", "TikTok"))).toBe("Listening works only through an HTTP proxy. Change the proxy in Settings, then try again.");
    expect(say(errorMessage("made_up", "TikTok"))).toBe("This post is gone or private.");
    expect(
      say(
        notFoundMessage({
          kind: "not_found",
          reason: "named_sound",
          title: "I Will Survive",
          author: "Gloria Gaynor",
          more: false,
        }),
      ),
    ).toBe("TikTok calls this sound “I Will Survive” by Gloria Gaynor, but Nuvo couldn't find it.");
    expect(say(stageMessage({ stage: "looking", title: "Teardrop" }))).toBe("Looking for “Teardrop”");
    expect(t("ui.links.share.heading", { title: "Mix", count: 42 })).toBe("Mix · 42 songs");
    expect(
      translatorFor("ru")("ui.links.share.heading", {
        title: "Микс",
        count: 42,
      }),
    ).toBe("Микс · 42 трека");
    expect(serviceLabel("web", t)).toBe("Link");
    expect(serviceLabel("tiktok", t)).toBe("TikTok");
  });

  it("display text loses bidi overrides and long tails", () => {
    expect(displayText("a\u202eb\tc")).toBe("a b c");
    expect([...displayText("ё".repeat(500))]).toHaveLength(200);
  });
});

describe("player tracks", () => {
  it("joins artists and keeps the cover", () => {
    expect(
      toPlayerTrack({
        id: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        artists: [
          { id: "UC1", name: "Rick Astley" },
          { id: "", name: "Guest" },
        ],
        durationMs: 213_000,
        cover: {
          url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          width: 480,
          height: 360,
        },
      }),
    ).toEqual({
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      artists: "Rick Astley, Guest",
      artistList: [
        { id: "UC1", name: "Rick Astley" },
        { id: undefined, name: "Guest" },
      ],
      coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationMs: 213_000,
      playCount: 0,
    });
  });
});

describe("the share link inbox", () => {
  it("holds a cold-start link until the shell listens, then passes new ones at once", () => {
    deliverShareLink("OLD");
    deliverShareLink("NEW");
    const got: string[] = [];
    const off = onShareLink((link) => got.push(link));
    deliverShareLink("LIVE");
    off();
    deliverShareLink("LATER");
    expect(got).toEqual(["nuvo://share?id=NEW", "nuvo://share?id=LIVE"]);
    const late: string[] = [];
    onShareLink((link) => late.push(link))();
    expect(late).toEqual(["nuvo://share?id=LATER"]);
  });

  it("a second listener does not silence the first", () => {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = onShareLink((link) => first.push(link));
    const offSecond = onShareLink((link) => second.push(link));
    deliverShareLink("BOTH");
    offSecond();
    deliverShareLink("FIRST");
    offFirst();
    expect(first).toEqual(["nuvo://share?id=BOTH", "nuvo://share?id=FIRST"]);
    expect(second).toEqual(["nuvo://share?id=BOTH"]);
  });
});
