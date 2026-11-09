import { ROLE_KEYS, type NuvoTheme, type RoleKey, type ThemeMode, type ThemeRoles } from "@/data/look/appearanceContracts";
import { parseColor } from "@/data/color/contrast";
import { sanitizeCss } from "./cssSanitizer";

export { ROLE_KEYS, type NuvoTheme, type RoleKey, type ThemeMode, type ThemeRoles };

export const THEME_VERSION = 1;
export const MAX_CSS_BYTES = 32 * 1024;
export const MAX_THEME_FILE_BYTES = 16 * 1024 + MAX_CSS_BYTES;
export const OPAQUE_ROLES: readonly RoleKey[] = ["field", "deep", "raised", "ink", "accent"];

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\)$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

export function normalizeColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!HEX.test(v) && !RGB.test(v)) return null;
  const { r, g, b, a } = parseColor(v);
  return [r, g, b].every((c) => c >= 0 && c <= 255) && a >= 0 && a <= 1 ? v : null;
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return text.length >= 1 && [...text].length <= max ? text : null;
}

function checkRoles(raw: unknown): Checked<ThemeRoles> {
  if (!isObject(raw)) return { ok: false, error: "theme_shape" };
  const roles = {} as ThemeRoles;
  for (const key of ROLE_KEYS) {
    const colour = normalizeColour(raw[key]);
    if (!colour) return { ok: false, error: "theme_colour" };
    if (OPAQUE_ROLES.includes(key) && parseColor(colour).a !== 1) return { ok: false, error: "theme_alpha" };
    roles[key] = colour;
  }
  return { ok: true, value: roles };
}

export type Migration = (raw: Raw) => Raw;

export const MIGRATIONS: Record<number, Migration> = {};

export function migrateTheme(raw: Raw, steps: Record<number, Migration> = MIGRATIONS): Checked<Raw> {
  let version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return { ok: false, error: "theme_shape" };
  if (version > THEME_VERSION) return { ok: false, error: "theme_newer" };
  let current = raw;
  while (version < THEME_VERSION) {
    const step = steps[version];
    if (!step) return { ok: false, error: "theme_shape" };
    current = step(current);
    version += 1;
  }
  return { ok: true, value: { ...current, version: THEME_VERSION } };
}

export function validateTheme(raw: unknown, newId: () => string = () => crypto.randomUUID()): Checked<NuvoTheme> {
  if (!isObject(raw) || raw.format !== "nuvo-theme" || raw.version !== THEME_VERSION || !isObject(raw.modes)) {
    return { ok: false, error: "theme_shape" };
  }
  const name = cleanText(raw.name, 40);
  if (!name) return { ok: false, error: "theme_name" };
  const author = raw.author === undefined ? undefined : cleanText(raw.author, 60);
  if (author === null) return { ok: false, error: "theme_name" };
  const modes: NuvoTheme["modes"] = {};
  for (const mode of ["light", "dark"] as const) {
    if (raw.modes[mode] === undefined) continue;
    const roles = checkRoles(raw.modes[mode]);
    if (!roles.ok) return roles;
    modes[mode] = roles.value;
  }
  const present = (["light", "dark"] as const).filter((mode) => modes[mode]);
  if (present.length === 0) return { ok: false, error: "theme_modes" };
  if (raw.css !== undefined && (typeof raw.css !== "string" || new TextEncoder().encode(raw.css).length > MAX_CSS_BYTES)) {
    return { ok: false, error: "theme_size" };
  }
  // theme files are untrusted: a sheet the sanitizer refuses never becomes part of a theme
  if (typeof raw.css === "string" && raw.css.length > 0 && !sanitizeCss(raw.css).ok) return { ok: false, error: "theme_css" };
  const defaultMode = raw.defaultMode === "light" || raw.defaultMode === "dark" ? raw.defaultMode : present[0];
  return {
    ok: true,
    value: {
      format: "nuvo-theme",
      version: THEME_VERSION,
      id: typeof raw.id === "string" && ID.test(raw.id) ? raw.id : newId(),
      name,
      ...(author ? { author } : {}),
      modes,
      defaultMode: modes[defaultMode] ? defaultMode : present[0],
      ...(typeof raw.css === "string" && raw.css.length > 0 ? { css: raw.css } : {}),
    },
  };
}

export function parseThemeFile(text: string, takenIds: ReadonlySet<string> = new Set(), newId: () => string = () => crypto.randomUUID()): Checked<NuvoTheme> {
  if (new TextEncoder().encode(text).length > MAX_THEME_FILE_BYTES) return { ok: false, error: "theme_size" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "theme_shape" };
  }
  if (!isObject(raw)) return { ok: false, error: "theme_shape" };
  const migrated = migrateTheme(raw);
  if (!migrated.ok) return migrated;
  const theme = validateTheme(migrated.value, newId);
  if (theme.ok && takenIds.has(theme.value.id)) theme.value.id = newId();
  return theme;
}

export function serializeTheme(theme: NuvoTheme): string {
  const { format, version, id, name, author, modes, defaultMode, css } = theme;
  return JSON.stringify({ format, version, id, name, ...(author ? { author } : {}), modes, defaultMode, ...(css ? { css } : {}) }, null, 2);
}

export function rolesFor(theme: NuvoTheme, mode: ThemeMode): ThemeRoles {
  return (theme.modes[mode] ?? theme.modes[mode === "light" ? "dark" : "light"])!;
}
