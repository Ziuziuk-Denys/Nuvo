/** Pure text helpers of the i18n runtime: locale file flattening, plural choice, English fallback, placeholders. */

export type Texts = Record<string, unknown>;
export type Table = ReadonlyMap<string, string>;
export type Vars = Record<string, string | number>;

/** Dot-joined paths to string leaves. Numbers, booleans, arrays and nulls are not keys. */
export function flattenTexts(texts: unknown, prefix = "", into = new Map<string, string>()): Map<string, string> {
  if (texts === null || typeof texts !== "object" || Array.isArray(texts)) return into;
  for (const [name, value] of Object.entries(texts)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") into.set(key, value);
    else flattenTexts(value, key, into);
  }
  return into;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function pluralCategory(locale: string, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

function formatNumber(locale: string, value: number): string {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

/** One table's text: the plural form when `vars.count` is a finite number, else the plain key. */
export function pickText(table: Table, key: string, locale: string, vars?: Vars): string | undefined {
  const count = vars?.count;
  if (typeof count !== "number" || !Number.isFinite(count)) return table.get(key);
  const zero = count === 0 ? table.get(`${key}_zero`) : undefined;
  if (zero !== undefined) return zero;
  return table.get(`${key}_${pluralCategory(locale, count)}`) ?? table.get(`${key}_other`) ?? table.get(`${key}_plural`) ?? table.get(key);
}

/** The active locale's text, then English chosen with English plural rules; undefined when neither has the key. */
export function lookUp(active: Table | undefined, locale: string, english: Table, key: string, vars?: Vars): string | undefined {
  if (active && locale !== "en") {
    const own = pickText(active, key, locale, vars);
    if (own !== undefined) return own;
  }
  return pickText(english, key, "en", vars);
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** One pass: known names are replaced, numbers use the locale's format, unknown placeholders stay visible. */
export function interpolate(text: string, vars: Vars, locale: string): string {
  return text.replace(PLACEHOLDER, (whole: string, name: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = vars[name];
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}
