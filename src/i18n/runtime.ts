import { localeSources, type LocaleSources } from "./locales";
import { flattenTexts, interpolate, lookUp, type Table, type Texts, type Vars } from "./text";

export type { Texts, Vars } from "./text";
export type { LocaleSources } from "./locales";
export type Locale = "en" | "ru";
export type TFunction = (key: string, vars?: Vars) => string;

export interface LocaleStore {
  read(): Promise<string | null>;
  write(code: Locale): Promise<void>;
}

interface Config {
  sources: LocaleSources;
  store: LocaleStore | null;
  onLoadError: (code: Locale) => void;
  onMissing: (key: string) => void;
  retryDelayMs: number;
}

export const shippedLocales: readonly { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ru", name: "Русский" },
];

const BOOT_KEY = "nuvo_locale";

function reportMissingInDev(key: string): void {
  if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
}

const defaultConfig = (): Config => ({
  sources: localeSources,
  store: null,
  onLoadError: (code) => console.error(`[i18n] could not load the ${code} texts`),
  onMissing: reportMissingInDev,
  retryDelayMs: 500,
});

let config = defaultConfig();
const tables = new Map<Locale, Table>();
const inFlight = new Map<Locale, Promise<void>>();
let active: Locale = "en";
let pending: Locale | null = null;
let request = 0;
let keepAll = false;
let version = 0;
const localeListeners = new Set<(code: Locale) => void>();
const storeListeners = new Set<() => void>();
const reported = new Set<string>();

export function isShippedLocale(code: unknown): code is Locale {
  return shippedLocales.some((locale) => locale.code === code);
}

export function detectLocale(bootCopy: string | null, systemLanguages: readonly string[]): Locale {
  if (isShippedLocale(bootCopy)) return bootCopy;
  for (const tag of systemLanguages) {
    const primary = tag.split(/[-_]/)[0]?.toLowerCase();
    if (isShippedLocale(primary)) return primary;
  }
  return "en";
}

function readBootCopy(): string | null {
  try {
    return localStorage.getItem(BOOT_KEY);
  } catch {
    return null;
  }
}

function writeBootCopy(code: Locale): void {
  try {
    localStorage.setItem(BOOT_KEY, code);
  } catch {
    // storage is unavailable in some sandboxes; detection simply runs again next start
  }
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function english(): Table {
  let table = tables.get("en");
  if (!table) {
    table = flattenTexts(config.sources.en());
    tables.set("en", table);
  }
  return table;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function loadTable(code: Exclude<Locale, "en">): Promise<void> {
  const source = config.sources[code];
  let texts: Texts;
  try {
    texts = await source();
  } catch {
    await wait(config.retryDelayMs);
    texts = await source();
  }
  tables.set(code, flattenTexts(texts));
}

function ensureTable(code: Locale): Promise<void> {
  if (code === "en") {
    english();
    return Promise.resolve();
  }
  if (tables.has(code)) return Promise.resolve();
  let loading = inFlight.get(code);
  if (!loading) {
    loading = loadTable(code).finally(() => inFlight.delete(code));
    inFlight.set(code, loading);
  }
  return loading;
}

function notifyStore(): void {
  version += 1;
  for (const listener of storeListeners) listener();
}

function commit(code: Locale, persist: boolean): void {
  english();
  const changed = code !== active;
  active = code;
  pending = null;
  if (persist) {
    writeBootCopy(code);
    void config.store?.write(code).catch(() => undefined);
  }
  if (!keepAll) {
    for (const held of [...tables.keys()]) if (held !== "en" && held !== code) tables.delete(held);
  }
  if (typeof document !== "undefined") document.documentElement.lang = code;
  if (changed) for (const listener of localeListeners) listener(code);
  notifyStore();
}

export function translate(key: string, vars?: Vars): string {
  const text = lookUp(tables.get(active), active, english(), key, vars);
  if (text === undefined) {
    if (!reported.has(key)) {
      reported.add(key);
      config.onMissing(key);
    }
    return key;
  }
  return vars ? interpolate(text, vars, active) : text;
}

export const currentLocale = (): Locale => active;
export const isLocaleLoading = (): boolean => pending !== null;
export const i18nVersion = (): number => version;

export function onLocaleChange(listener: (code: Locale) => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function subscribeI18n(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

export async function setLocale(code: string): Promise<void> {
  if (!isShippedLocale(code)) {
    console.warn(`[i18n] ${code} is not a shipped locale`);
    return;
  }
  request += 1;
  const token = request;
  if (code === "en" || tables.has(code)) {
    commit(code, true);
    return;
  }
  pending = code;
  notifyStore();
  try {
    await ensureTable(code);
  } catch {
    if (token !== request) return;
    pending = null;
    notifyStore();
    config.onLoadError(code);
    return;
  }
  if (token === request) commit(code, true);
}

async function syncWithStore(): Promise<void> {
  const store = config.store;
  if (!store) return;
  const token = request;
  let stored: string | null;
  try {
    stored = await store.read();
  } catch {
    return;
  }
  // a choice made while the store was answering is newer than what it holds
  if (token !== request) return;
  if (isShippedLocale(stored)) {
    if (stored !== active) await setLocale(stored);
    return;
  }
  await store.write(active).catch(() => undefined);
}

export async function prepareLocale(): Promise<void> {
  english();
  const detected = detectLocale(readBootCopy(), systemLanguages());
  let ready: Locale = "en";
  if (detected !== "en") {
    try {
      await ensureTable(detected);
      ready = detected;
    } catch {
      config.onLoadError(detected);
    }
  }
  request += 1;
  commit(ready, false);
  writeBootCopy(ready);
  void syncWithStore();
}

export const loadLocaleTexts = (code: Locale): Promise<void> => ensureTable(code);

export async function loadAllLocales(): Promise<void> {
  // shortcut: never released again; fine with two shipped locales, add a release call when a third ships
  keepAll = true;
  await Promise.all(shippedLocales.map(({ code }) => ensureTable(code)));
  notifyStore();
}

export function textsInEveryLocale(key: string): string[] {
  english();
  return shippedLocales.flatMap(({ code }) => {
    const text = tables.get(code)?.get(key);
    return text === undefined ? [] : [text];
  });
}

export function configureI18n(options: Partial<Pick<Config, "store" | "onLoadError">>): void {
  config = { ...config, ...options };
}

export const i18nTesting = {
  reset(overrides: Partial<Config> = {}): void {
    config = { ...defaultConfig(), ...overrides };
    tables.clear();
    inFlight.clear();
    active = "en";
    pending = null;
    request = 0;
    keepAll = false;
    version = 0;
    localeListeners.clear();
    storeListeners.clear();
    reported.clear();
  },
  heldLocales(): Locale[] {
    return [...tables.keys()];
  },
};
