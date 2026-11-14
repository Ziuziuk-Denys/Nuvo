import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { CUSTOM_PREFIX, useAppearanceStore } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { LOCALE_OPTIONS, PRIMARY_LOCALES, useCustomizationStore, type Locale } from "../../ports/settings";
import { presetIconSvg, PRESETS, revealThemeChange, useLook, useSetThemeMode, useThemeMode, type ThemeMode } from "../../ports/theme";
import { SettingBlock, SettingGroup, SettingRow, Switch } from "./controls";
import { CustomCssBlock, ResetAppearanceRow } from "./CustomCssBlock";
import { ResetAllRow } from "./CustomizationSection";
import { FontsGroup } from "./FontsGroup";
import { ThemeLibrary } from "./ThemeLibrary";
import styles from "./sections.module.css";

const COLUMNS = 3;
const MODES: ThemeMode[] = ["system", "light", "dark"];

export function PresetGrid(): JSX.Element {
  const { t } = useTranslation();
  const active = useCustomizationStore((state) => state.preset);
  const setPreset = useCustomizationStore((state) => state.setPreset);
  const custom = useAppearanceStore((state) => state.saved.active.presetId.startsWith(CUSTOM_PREFIX));
  const { mode } = useLook();

  const pick = (id: (typeof PRESETS)[number]["id"]) => {
    setPreset(id);
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
        const pressed = preset.id === active && !custom;
        return (
          <button
            key={preset.id}
            type="button"
            data-preset={preset.id}
            aria-pressed={pressed}
            tabIndex={pressed || (custom && preset.id === active) ? 0 : -1}
            className={styles.preset}
            onClick={() => revealThemeChange(() => pick(preset.id))}
          >
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(presetIconSvg(preset.id, mode))}`}
              alt=""
              width={64}
              height={64}
              draggable={false}
              className={styles.presetIcon}
            />
            <span className={styles.presetName}>{t(`settings.preset.names.${preset.id}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

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
  const theme = useThemeMode();
  const setThemeMode = useSetThemeMode();

  return (
    <div className={styles.modes} data-tour="modes">
      <div className={styles.modeGrid}>
        {MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={theme === mode} className={styles.mode} onClick={() => revealThemeChange(() => setThemeMode(mode))}>
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
        ))}
      </div>
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
      headless
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

export function AppearanceSection(): JSX.Element {
  const { t } = useTranslation();
  const accentFromCover = useCustomizationStore((state) => state.accentFromCover);
  const setAccentFromCover = useCustomizationStore((state) => state.setAccentFromCover);

  return (
    <>
      <SettingGroup label={t("settings.page.theme")}>
        <SettingBlock
          title={t("settings.preset.title")}
          description={t("settings.preset.description")}
          titleKey="settings.preset.title"
          descKey="settings.preset.description"
        >
          <PresetGrid />
          <ThemeLibrary />
        </SettingBlock>
        <SettingBlock
          title={t("settings.page.mode")}
          description={t("settings.theme.description")}
          titleKey="settings.page.mode"
          descKey="settings.theme.description"
        >
          <ModeCards />
        </SettingBlock>
      </SettingGroup>
      <SettingGroup label={t("settings.page.colour")}>
        <SettingRow
          title={t("settings.preset.accent_from_cover")}
          description={t("settings.preset.accent_from_cover_description")}
          titleKey="settings.preset.accent_from_cover"
          descKey="settings.preset.accent_from_cover_description"
          explained
          control={<Switch label={t("settings.preset.accent_from_cover")} checked={accentFromCover} onChange={setAccentFromCover} />}
        />
      </SettingGroup>
      <FontsGroup />
      <SettingGroup label={t("settings.language.label")}>
        <LanguageBlock />
      </SettingGroup>
      <SettingGroup label={t("settings.page.advanced")}>
        <CustomCssBlock />
        <ResetAppearanceRow />
        <ResetAllRow />
      </SettingGroup>
    </>
  );
}
