import { describe, expect, it } from "vitest";
import { migrateTheme, parseThemeFile, rolesFor, serializeTheme, validateTheme, type NuvoTheme } from "./themeSchema";
import { SAMPLE } from "./sampleTheme";

const withRole = (role: string, value: string) => ({ ...SAMPLE, modes: { light: { ...SAMPLE.modes.light, [role]: value } } });
const fixedId = () => "new-id";

describe("theme schema", () => {
  it("accepts the sample and refuses what the design bans", () => {
    expect(validateTheme(SAMPLE).ok).toBe(true);
    const refused: Array<[unknown, string]> = [
      [withRole("accent", "hsl(10, 50%, 50%)"), "theme_colour"],
      [withRole("accent", "var(--x)"), "theme_colour"],
      [withRole("accent", "url(https://example.org/x)"), "theme_colour"],
      [withRole("accent", "red"), "theme_colour"],
      [withRole("accent", "rgb(300, 0, 0)"), "theme_colour"],
      [withRole("field", "rgba(1, 2, 3, 0.5)"), "theme_alpha"],
      [{ ...SAMPLE, modes: { light: { ...SAMPLE.modes.light, tint: undefined } } }, "theme_colour"],
      [{ ...SAMPLE, modes: {} }, "theme_modes"],
      [{ ...SAMPLE, name: "x".repeat(41) }, "theme_name"],
      [{ ...SAMPLE, name: "\u0007\u0008" }, "theme_name"],
    ];
    for (const [raw, error] of refused) expect(validateTheme(raw)).toEqual({ ok: false, error });
    expect(parseThemeFile(JSON.stringify({ ...SAMPLE, version: 99 }))).toEqual({ ok: false, error: "theme_newer" });
    expect(parseThemeFile(JSON.stringify({ ...SAMPLE, author: "x".repeat(49 * 1024) }))).toEqual({ ok: false, error: "theme_size" });
    expect(parseThemeFile("{ not json")).toEqual({ ok: false, error: "theme_shape" });
  });

  it("drops unknown keys, strips control characters and keeps names as text", () => {
    const theme = validateTheme({ ...SAMPLE, name: "<b>Dusk</b>\u0000", script: "alert(1)" });
    expect(theme.ok && theme.value).toMatchObject({ name: "<b>Dusk</b>" });
    expect(theme.ok && "script" in theme.value).toBe(false);
  });

  it("a v1 file stays v1; a v0 fixture goes through the chain; a missing step is refused", () => {
    expect(migrateTheme({ ...SAMPLE })).toEqual({ ok: true, value: SAMPLE });
    const v0 = { format: "nuvo-theme", version: 0, name: "Old", colors: SAMPLE.modes };
    const steps = { 0: ({ colors, ...rest }: Record<string, unknown>) => ({ ...rest, modes: colors, defaultMode: "light" }) };
    const migrated = migrateTheme(v0, steps);
    expect(migrated.ok && validateTheme(migrated.value, fixedId)).toMatchObject({ ok: true, value: { name: "Old", id: "new-id", modes: SAMPLE.modes } });
    expect(migrateTheme(v0)).toEqual({ ok: false, error: "theme_shape" });
  });

  it("export then import gives the same theme; a taken id is regenerated", () => {
    const theme = validateTheme(SAMPLE).ok ? (validateTheme(SAMPLE) as { value: NuvoTheme }).value : null;
    const again = parseThemeFile(serializeTheme(theme!));
    expect(again).toEqual({ ok: true, value: theme });
    expect(parseThemeFile(serializeTheme(theme!), new Set([theme!.id]), fixedId)).toMatchObject({ ok: true, value: { id: "new-id" } });
  });

  it("one mode serves both", () => {
    const theme = (validateTheme(SAMPLE) as { value: NuvoTheme }).value;
    expect(rolesFor(theme, "dark")).toBe(theme.modes.light);
  });

  it("keeps carried CSS as text up to 32 KB", () => {
    expect(validateTheme({ ...SAMPLE, css: "a { color: red }" })).toMatchObject({ ok: true, value: { css: "a { color: red }" } });
    expect(validateTheme({ ...SAMPLE, css: "a".repeat(32 * 1024 + 1) })).toEqual({ ok: false, error: "theme_size" });
    expect(validateTheme({ ...SAMPLE, css: "a{background:url(https://e.test/x)}" })).toEqual({ ok: false, error: "theme_css" });
  });
});
