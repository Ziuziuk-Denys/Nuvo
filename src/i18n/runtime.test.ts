import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
  currentLocale,
  detectLocale,
  i18nTesting,
  isLocaleLoading,
  loadAllLocales,
  loadLocaleTexts,
  onLocaleChange,
  prepareLocale,
  setLocale,
  textsInEveryLocale,
  translate,
  type LocaleStore,
} from "./runtime";
import type { Texts } from "./text";

const EN = { app: { title: "Nuvo" }, player: { title: "Player" }, toast: { saved: "Saved" } };
const RU = { app: { title: "Нюво" }, player: { title: "Плеер" }, toast: { saved: "Сохранено" } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
};

function setup(options: { ru?: () => Promise<Texts>; store?: LocaleStore; languages?: string[]; boot?: string } = {}) {
  if (options.boot) localStorage.setItem("nuvo_locale", options.boot);
  Object.defineProperty(window.navigator, "languages", { value: options.languages ?? ["en-US"], configurable: true });
  const ru = vi.fn(options.ru ?? (async () => RU));
  const onLoadError = vi.fn();
  const onMissing = vi.fn();
  i18nTesting.reset({ sources: { en: () => EN, ru }, store: options.store ?? null, onLoadError, onMissing, retryDelayMs: 0 });
  return { ru, onLoadError, onMissing };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("detection and persistence", () => {
  it("19: an empty boot copy follows the system languages and is written", async () => {
    setup({ languages: ["ru-RU", "en-US"] });
    await prepareLocale();
    expect(currentLocale()).toBe("ru");
    expect(localStorage.getItem("nuvo_locale")).toBe("ru");
  });

  it("20: unknown and retired languages give English", async () => {
    setup({ languages: ["nl-NL"] });
    await prepareLocale();
    expect(currentLocale()).toBe("en");
    expect(detectLocale(null, ["uk-UA", "de"])).toBe("en");
    expect(detectLocale(null, ["pt_BR", "ru"])).toBe("ru");
  });

  it("21: the old ua and uk boot copies read as unsupported", async () => {
    for (const boot of ["ua", "uk"]) {
      localStorage.clear();
      setup({ boot, languages: ["en-GB"] });
      await prepareLocale();
      expect(currentLocale()).toBe("en");
      expect(localStorage.getItem("nuvo_locale")).toBe("en");
    }
  });

  it("22: the daemon value wins over the boot copy once it answers", async () => {
    const store: LocaleStore = { read: async () => "en", write: vi.fn(async () => undefined) };
    setup({ boot: "ru", store });
    await prepareLocale();
    await settle();
    expect(currentLocale()).toBe("en");
    expect(localStorage.getItem("nuvo_locale")).toBe("en");
  });

  it("23: an empty daemon setting gets the boot copy", async () => {
    const write = vi.fn(async () => undefined);
    setup({ boot: "ru", store: { read: async () => null, write } });
    await prepareLocale();
    await settle();
    expect(write).toHaveBeenCalledWith("ru");
  });

  it("a choice made while the store answers wins", async () => {
    const answer = deferred<string | null>();
    const write = vi.fn(async () => undefined);
    setup({ store: { read: () => answer.promise, write } });
    await prepareLocale();
    await setLocale("ru");
    answer.resolve("en");
    await settle();
    expect(currentLocale()).toBe("ru");
    expect(write).toHaveBeenLastCalledWith("ru");
  });

  it("boots when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setup({ languages: ["ru-RU"] });
    await expect(prepareLocale()).resolves.toBeUndefined();
    expect(currentLocale()).toBe("ru");
  });

  it("boots in English when the detected locale cannot load", async () => {
    const { onLoadError } = setup({ languages: ["ru-RU"], ru: async () => Promise.reject(new Error("chunk")) });
    await prepareLocale();
    expect(currentLocale()).toBe("en");
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });
});

describe("lazy loading and switching", () => {
  it("24: English needs no request for the Russian file", async () => {
    const { ru } = setup();
    await prepareLocale();
    translate("app.title");
    expect(ru).not.toHaveBeenCalled();
  });

  it("26: texts stay English while Russian loads, then switch together and set lang", async () => {
    const file = deferred<Texts>();
    setup({ ru: () => file.promise });
    await prepareLocale();
    const switching = setLocale("ru");
    expect(isLocaleLoading()).toBe(true);
    expect(translate("app.title")).toBe("Nuvo");
    file.resolve(RU);
    await switching;
    expect(isLocaleLoading()).toBe(false);
    expect(translate("app.title")).toBe("Нюво");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("27: the last request wins over a slow load", async () => {
    const file = deferred<Texts>();
    setup({ ru: () => file.promise });
    await prepareLocale();
    const slow = setLocale("ru");
    await setLocale("en");
    file.resolve(RU);
    await slow;
    expect(currentLocale()).toBe("en");
    expect(localStorage.getItem("nuvo_locale")).toBe("en");
  });

  it("28: two failed loads keep the locale, persist nothing and report once", async () => {
    const write = vi.fn(async () => undefined);
    const { ru, onLoadError } = setup({ ru: async () => Promise.reject(new Error("chunk")), store: { read: async () => "en", write } });
    await prepareLocale();
    await settle();
    write.mockClear();
    await setLocale("ru");
    expect(ru).toHaveBeenCalledTimes(2);
    expect(currentLocale()).toBe("en");
    expect(localStorage.getItem("nuvo_locale")).toBe("en");
    expect(write).not.toHaveBeenCalled();
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(isLocaleLoading()).toBe(false);
  });

  it("retries a failed load once", async () => {
    let calls = 0;
    setup({ ru: async () => (calls++ === 0 ? Promise.reject(new Error("chunk")) : RU) });
    await setLocale("ru");
    expect(currentLocale()).toBe("ru");
  });

  it("29: switching back to English releases the Russian table", async () => {
    setup();
    await setLocale("ru");
    await setLocale("en");
    expect(i18nTesting.heldLocales()).toEqual(["en"]);
  });

  it("keeps every locale after loadAllLocales", async () => {
    setup();
    await loadAllLocales();
    await setLocale("ru");
    await setLocale("en");
    expect(i18nTesting.heldLocales().sort()).toEqual(["en", "ru"]);
  });

  it("30: textsInEveryLocale returns what is loaded", async () => {
    setup();
    expect(textsInEveryLocale("player.title")).toEqual(["Player"]);
    await loadLocaleTexts("ru");
    expect(textsInEveryLocale("player.title")).toEqual(["Player", "Плеер"]);
  });

  it("31: plain code translates after a switch; listeners hear it once", async () => {
    setup();
    const heard = vi.fn();
    onLocaleChange(heard);
    await setLocale("ru");
    expect(translate("toast.saved")).toBe("Сохранено");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith("ru");
  });

  it("ignores an unsupported code", async () => {
    setup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await setLocale("de");
    expect(currentLocale()).toBe("en");
    expect(localStorage.getItem("nuvo_locale")).toBeNull();
  });
});

describe("missing keys", () => {
  it("returns the key and reports it once", () => {
    const { onMissing } = setup();
    expect(translate("menu.missing")).toBe("menu.missing");
    translate("menu.missing");
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith("menu.missing");
  });
});
