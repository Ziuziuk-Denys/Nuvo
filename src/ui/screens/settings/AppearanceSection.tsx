import { useId, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { CUSTOM_PREFIX, useAppearanceStore } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { LOCALE_OPTIONS, PRIMARY_LOCALES, selectIsGlassThemeActive, useCustomizationStore, useHasCustomBackground, type Locale } from "../../ports/settings";
import { getPreset, presetIconSvg, PRESETS, revealThemeChange, useLook, useSetThemeMode, useThemeMode, type ThemeMode } from "../../ports/theme";
import { Segmented, SettingBlock, SettingGroup, SettingRow, Switch } from "./controls";
import { FRAME_CAPS, useEffectsStore, type FrameCap } from "../../effects";
import { FontsGroup } from "./FontsGroup";
import { ThemeLibrary } from "./ThemeLibrary";
import styles from "./sections.module.css";

const COLUMNS = 3;
const MODES: ThemeMode[] = ["system", "light", "dark"];

/** Keyboard clicks carry no pointer position, so the reveal starts from the control's centre. */
function revealOrigin(event: MouseEvent<HTMLElement>) {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** The theme tiles; the first run shows the same grid. */
export function PresetGrid(): JSX.Element {
  const { t } = useTranslation();
  const active = useCustomizationStore((state) => state.preset);
  const setPreset = useCustomizationStore((state) => state.setPreset);
  const custom = useAppearanceStore((state) => state.saved.active.presetId.startsWith(CUSTOM_PREFIX));
  const { mode } = useLook();

  const pick = (id: (typeof PRESETS)[number]["id"]) => {
    setPreset(id);
    // a saved theme in force wins over presets, so picking one leaves it
    if (custom) void useAppearanceStore.getState().save({ active: { presetId: id } });
  };
  const gridRef = useRef<HTMLDivElement>(null);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const from = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const targets: Record<string, number> = {
      ArrowRight: from + 1,
      ArrowLeft: from - 1,
      ArrowDown: from + COLUMNS,
      ArrowUp: from - COLUMNS,
      Home: 0,
      End: tiles.length - 1,
    };
    if (from < 0 || !(event.key in targets)) return;
    event.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, targets[event.key]))]?.focus();
  };

  return (
    <div ref={gridRef} role="group" aria-label={t("settings.preset.title")} className={styles.presets} onKeyDown={moveFocus} data-tour="presets">
      {PRESETS.map((preset) => {
        const only = preset.modes.length === 1 ? preset.modes[0] : null;
        const pressed = preset.id === active && !custom;
        return (
          <button
            key={preset.id}
            type="button"
            data-preset={preset.id}
            aria-pressed={pressed}
            tabIndex={pressed || (custom && preset.id === active) ? 0 : -1}
            className={styles.preset}
            onClick={(event) => revealThemeChange(() => pick(preset.id), revealOrigin(event))}
          >
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(presetIconSvg(preset.id, mode))}`}
              alt=""
              width={64}
              height={64}
              draggable={false}
              className={styles.presetIcon}
            />
            <span className={styles.presetText}>
              <span className={styles.presetName}>{t(`settings.preset.names.${preset.id}`)}</span>
              {only ? <span className={styles.presetMode}>{t(only === "dark" ? "settings.preset.dark_only" : "settings.preset.light_only")}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A tiny window drawn in one mode: a sidebar with traffic lights and lines, a content area with tiles. */
function WindowSketch({ mode }: { mode: "light" | "dark" }): JSX.Element {
  return (
    <span className={styles.sketch} data-mode={mode}>
      <span className={styles.sketchSide}>
        <span className={styles.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.line} style={{ width: 22 }} />
        <span className={styles.line} style={{ width: 16 }} />
        <span className={styles.line} style={{ width: 20 }} />
        <span className={styles.sideBlock} />
      </span>
      <span className={styles.sketchMain}>
        <span className={styles.heading} />
        <span className={styles.tiles}>
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

function ModeCards(): JSX.Element {
  const { t } = useTranslation();
  const noteId = useId();
  const theme = useThemeMode();
  const setThemeMode = useSetThemeMode();
  const presetId = useCustomizationStore((state) => state.preset);
  const glass = useCustomizationStore(selectIsGlassThemeActive);
  const preset = getPreset(presetId);
  // light-only presets fall back to the default look under a glass wallpaper, so only a dark-only lock remains there
  const locked = preset.modes.length === 1 && !(glass && preset.modes[0] === "light") ? preset.modes[0] : null;
  const glassReason = t("settings.theme.disabled_for_glass");
  const lockedReason = t(locked === "dark" ? "settings.preset.mode_locked_dark" : "settings.preset.mode_locked_light");
  const systemIsLight = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches === true;

  const reasonFor = (mode: ThemeMode): string | undefined => {
    const resolved = mode === "system" ? (systemIsLight ? "light" : "dark") : mode;
    if (glass && resolved === "light") return glassReason;
    if (locked && resolved !== locked) return lockedReason;
    return undefined;
  };
  const note = glass ? glassReason : locked ? lockedReason : null;

  return (
    <div className={styles.modes} data-tour="modes">
      <div className={styles.modeGrid}>
        {MODES.map((mode) => {
          const reason = reasonFor(mode);
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={theme === mode}
              disabled={Boolean(reason)}
              title={reason}
              aria-describedby={reason && note ? noteId : undefined}
              className={styles.mode}
              onClick={(event) => revealThemeChange(() => setThemeMode(mode), revealOrigin(event))}
            >
              <span className={styles.modeFrame}>
                {mode === "system" ? (
                  <span className={styles.split}>
                    <WindowSketch mode="light" />
                    <WindowSketch mode="dark" />
                  </span>
                ) : (
                  <WindowSketch mode={mode} />
                )}
                {theme === mode ? (
                  <span className={styles.modeCheck}>
                    <Icon name="check" size={16} />
                  </span>
                ) : null}
              </span>
              <span className={styles.modeLabel}>{t(`settings.theme.${mode}`)}</span>
            </button>
          );
        })}
      </div>
      {note ? (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

const englishNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "language" }) : null;

function LanguageRow({
  value,
  label,
  icon,
  active,
  onPick,
}: {
  value: Locale;
  label: string;
  icon?: ReactNode;
  active: boolean;
  onPick: (locale: Locale) => void;
}): JSX.Element {
  const english = englishNames?.of(value) ?? value;
  return (
    <button type="button" lang={value} aria-pressed={active} className={styles.language} onClick={() => onPick(value)}>
      {icon ? <span className={styles.flag}>{icon}</span> : null}
      <span className={styles.languageText}>
        <span className={styles.languageName}>{label}</span>
        {english !== label ? (
          <span lang="en" className={styles.languageEnglish}>
            {english}
          </span>
        ) : null}
      </span>
      {active ? <Icon name="check" size={16} className={styles.languageCheck} /> : null}
    </button>
  );
}

function LanguageBlock(): JSX.Element {
  const { t, locale, setLocale } = useTranslation();
  const [more, setMore] = useState(() => !PRIMARY_LOCALES.includes(locale as Locale));
  const moreId = useId();
  const secondary = LOCALE_OPTIONS.filter((option) => !PRIMARY_LOCALES.includes(option.value));
  const row = (option: (typeof LOCALE_OPTIONS)[number]) => (
    <LanguageRow key={option.value} value={option.value} label={option.label} icon={option.icon} active={option.value === locale} onPick={setLocale} />
  );

  return (
    <SettingBlock
      title={t("settings.language.label")}
      description={t("settings.language.description")}
      titleKey="settings.language.label"
      descKey="settings.language.description"
    >
      <div className={styles.languages}>
        {LOCALE_OPTIONS.filter((option) => PRIMARY_LOCALES.includes(option.value)).map(row)}
        {secondary.length > 0 ? (
          <>
            <button type="button" aria-expanded={more} aria-controls={moreId} className={styles.more} onClick={() => setMore((open) => !open)}>
              {t("settings.language.more")}
              <Icon name="chevron-down" size={16} className={styles.moreChevron} />
            </button>
            <div id={moreId} hidden={!more} className={styles.languageList}>
              {more ? secondary.map(row) : null}
            </div>
          </>
        ) : null}
      </div>
    </SettingBlock>
  );
}

function AppearanceGroup(): JSX.Element {
  const { t } = useTranslation();
  const accentFromCover = useCustomizationStore((state) => state.accentFromCover);
  const setAccentFromCover = useCustomizationStore((state) => state.setAccentFromCover);
  const coverGlow = useCustomizationStore((state) => state.coverGlow);
  const setCoverGlow = useCustomizationStore((state) => state.setCoverGlow);
  const wallpaper = useHasCustomBackground();
  const reduceEffects = useEffectsStore((state) => state.reduce);
  const setReduceEffects = useEffectsStore((state) => state.setReduce);
  const fps = useEffectsStore((state) => state.fps);
  const setFps = useEffectsStore((state) => state.setFps);

  return (
    <SettingGroup>
      <SettingBlock
        title={t("settings.preset.title")}
        description={t("settings.preset.description")}
        titleKey="settings.preset.title"
        descKey="settings.preset.description"
      >
        <PresetGrid />
        <ThemeLibrary />
        <ModeCards />
      </SettingBlock>
      <SettingRow
        title={t("settings.preset.accent_from_cover")}
        description={t("settings.preset.accent_from_cover_description")}
        titleKey="settings.preset.accent_from_cover"
        descKey="settings.preset.accent_from_cover_description"
        explained
        control={<Switch label={t("settings.preset.accent_from_cover")} checked={accentFromCover} onChange={setAccentFromCover} />}
      />
      <SettingRow
        title={t("settings.cover_glow.title")}
        description={t(wallpaper ? "settings.cover_glow.disabled_for_wallpaper" : "settings.cover_glow.description")}
        titleKey="settings.cover_glow.title"
        descKey="settings.cover_glow.description"
        control={<Switch label={t("settings.cover_glow.title")} checked={coverGlow && !wallpaper} disabled={wallpaper} onChange={setCoverGlow} />}
      />
      <SettingRow
        title={t("settings.reduce_effects.title")}
        description={t("settings.reduce_effects.description")}
        titleKey="settings.reduce_effects.title"
        descKey="settings.reduce_effects.description"
        control={<Switch label={t("settings.reduce_effects.title")} checked={reduceEffects} onChange={setReduceEffects} />}
      />
      <SettingRow
        title={t("settings.frame_rate.title")}
        description={t("settings.frame_rate.description")}
        titleKey="settings.frame_rate.title"
        descKey="settings.frame_rate.description"
        control={
          <Segmented
            label={t("settings.frame_rate.title")}
            options={FRAME_CAPS.map((fps) => ({ value: String(fps), label: t("settings.frame_rate.fps", { fps }) }))}
            value={String(fps)}
            onChange={(value) => setFps(Number(value) as FrameCap)}
          />
        }
      />
    </SettingGroup>
  );
}

/** Theme, mode, fonts and language: the Appearance section. */
export function AppearanceSection(): JSX.Element {
  return (
    <>
      <AppearanceGroup />
      <FontsGroup />
      <SettingGroup>
        <LanguageBlock />
      </SettingGroup>
    </>
  );
}
