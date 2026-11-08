import { useState, type DragEvent, type JSX } from "react";
import { Icon } from "../../icons/Icon";
import {
  CSS_LIMITS,
  CUSTOM_PREFIX,
  parseThemeFile,
  rolesFor,
  sanitizeCss,
  serializeTheme,
  themeFromPreset,
  useAppearanceStore,
  type CssProblem,
  type NuvoTheme,
} from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { useCustomizationStore } from "../../ports/settings";
import { PRESETS, useLook } from "../../ports/theme";
import { Switch } from "./controls";
import { openThemeEditor, useThemeEditor } from "./ThemeEditor";
import styles from "./look.module.css";
import sections from "./sections.module.css";

const MAX_DROP_BYTES = 48 * 1024;

interface PendingCss {
  theme: NuvoTheme;
  css: string;
  problems: CssProblem[];
}

/** A saved theme's tile: its own background with a card and the accent, in the preset tiles' frame. */
function ThemeSwatch({ theme, mode }: { theme: NuvoTheme; mode: "light" | "dark" }): JSX.Element {
  const roles = rolesFor(theme, theme.modes[mode] ? mode : theme.defaultMode);
  return (
    <span className={`${sections.presetIcon} ${styles.themeIcon}`} style={{ background: roles.field }} aria-hidden="true">
      <span style={{ background: roles.raised }} />
      <i style={{ background: roles.accent }} />
    </span>
  );
}

/** Saved themes next to the presets, the editor's entry points, import with the carried-CSS question and export. */
export function ThemeLibrary(): JSX.Element {
  const { t } = useTranslation();
  const saved = useAppearanceStore((s) => s.saved);
  const draft = useAppearanceStore((s) => s.draft);
  const editing = useThemeEditor((s) => s.open);
  const presetId = useCustomizationStore((s) => s.preset);
  const { mode } = useLook();
  const [includeCss, setIncludeCss] = useState(false);
  const [pendingCss, setPendingCss] = useState<PendingCss | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = useAppearanceStore.getState;
  const active = saved.active.presetId;
  const selected = active.startsWith(CUSTOM_PREFIX) ? saved.themes.find((theme) => `${CUSTOM_PREFIX}${theme.id}` === active) : undefined;
  const copyName = (name: string) => t("appearance.theme.copy_of", { name }).slice(0, 40);

  const run = async (ok: Promise<boolean>) => setError((await ok) ? null : t("appearance.errors.save_failed"));

  const fromPreset = () => {
    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
    openThemeEditor(themeFromPreset(preset, copyName(t(`settings.preset.names.${preset.id}`)), crypto.randomUUID()));
  };

  const openText = (text: string) => {
    setError(null);
    const parsed = parseThemeFile(text, new Set(saved.themes.map((theme) => theme.id)));
    if (!parsed.ok) {
      setError(t(`appearance.errors.${parsed.error}`));
      return;
    }
    const { css, ...theme } = parsed.value;
    if (!css) return openThemeEditor(theme);
    const checked = sanitizeCss(css);
    setPendingCss({ theme, css, problems: checked.ok ? [] : checked.problems });
  };

  const importFile = async () => {
    const file = await window.nuvoShell?.importThemeFile();
    if (!file) return;
    if (file.ok) openText(file.text);
    else if (file.error !== "cancelled") setError(t(`appearance.errors.${file.error}`));
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (file.size > MAX_DROP_BYTES) {
      setError(t("appearance.errors.theme_size"));
      return;
    }
    void file.text().then(openText);
  };

  /** "Colours and CSS": the theme's CSS joins custom CSS, switched on, after the owner read it. */
  const acceptCss = async ({ theme, css }: PendingCss) => {
    const text = [saved.customCss.text.trim(), `/* ${theme.name.replace(/\*\//g, "")} */\n${css.trim()}`].filter(Boolean).join("\n\n");
    if (new TextEncoder().encode(text).length > CSS_LIMITS.bytes) {
      setError(t("appearance.css_errors.too_large"));
      return;
    }
    if (!(await store().save({ customCss: { enabled: true, text } }))) {
      setError(t("appearance.errors.save_failed"));
      return;
    }
    setPendingCss(null);
    openThemeEditor(theme);
  };

  const exportTheme = async (theme: NuvoTheme) => {
    const css = includeCss && saved.customCss.text.trim() ? saved.customCss.text : undefined;
    const result = await window.nuvoShell?.exportTheme(theme.name, serializeTheme({ ...theme, ...(css ? { css } : {}) }));
    setError(result === "failed" ? t("appearance.errors.export_failed") : null);
  };

  const remove = (theme: NuvoTheme) => {
    const themes = saved.themes.filter((other) => other.id !== theme.id);
    void run(store().save({ themes, ...(active === `${CUSTOM_PREFIX}${theme.id}` ? { active: { presetId } } : {}) }));
  };

  return (
    <div className={styles.library} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      {saved.themes.length > 0 ? (
        <div role="group" aria-label={t("appearance.theme.title")} className={sections.presets}>
          {saved.themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={selected?.id === theme.id}
              className={sections.preset}
              onClick={() => void run(store().save({ active: { presetId: `${CUSTOM_PREFIX}${theme.id}` } }))}
            >
              <ThemeSwatch theme={theme} mode={mode} />
              <span className={sections.presetText}>
                <span className={sections.presetName}>{theme.name}</span>
                <span className={sections.presetMode}>{t("appearance.theme.custom")}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        {selected ? (
          <>
            <button type="button" className={sections.button} onClick={() => openThemeEditor(selected)}>
              <Icon name="edit" size={16} />
              {t("appearance.theme.customize")}
            </button>
            <button
              type="button"
              className={sections.button}
              onClick={() => openThemeEditor({ ...selected, id: crypto.randomUUID(), name: copyName(selected.name) })}
            >
              <Icon name="copy" size={16} />
              {t("appearance.theme.duplicate")}
            </button>
            <button type="button" className={sections.button} onClick={() => void exportTheme(selected)}>
              <Icon name="export" size={16} />
              {t("appearance.theme.export")}
            </button>
            <button type="button" className={sections.button} onClick={() => remove(selected)}>
              <Icon name="trash" size={16} />
              {t("appearance.theme.delete")}
            </button>
          </>
        ) : (
          <button type="button" className={sections.button} onClick={fromPreset}>
            <Icon name="palette" size={16} />
            {t("appearance.theme.new_from")}
          </button>
        )}
        <button type="button" className={sections.button} onClick={() => void importFile()}>
          <Icon name="import" size={16} />
          {t("appearance.theme.import")}
        </button>
      </div>

      {selected ? (
        <div className={styles.switchRow}>
          <span>{t("appearance.theme.export_css")}</span>
          <Switch label={t("appearance.theme.export_css")} checked={includeCss} onChange={setIncludeCss} />
        </div>
      ) : null}

      {draft && !editing ? (
        <div className={styles.draft}>
          <span>{t("appearance.theme.unsaved")}</span>
          <button type="button" className={styles.textAction} onClick={() => openThemeEditor()}>
            {t("appearance.theme.open_draft")}
          </button>
          <button type="button" className={styles.textAction} onClick={() => store().setDraft(null)}>
            {t("appearance.theme.discard")}
          </button>
        </div>
      ) : null}

      {pendingCss ? (
        <div className={styles.pending} role="group" aria-label={t("appearance.theme.css_title")}>
          <p className={styles.pendingText}>{t("appearance.theme.css_question", { name: pendingCss.theme.name })}</p>
          <pre className={styles.code}>{pendingCss.css}</pre>
          {pendingCss.problems.map((problem) => (
            <p key={`${problem.line}-${problem.key}`} className={styles.problem}>
              {t("appearance.css.line", { line: problem.line, message: t(`appearance.css_errors.${problem.key}`) })}
            </p>
          ))}
          <div className={styles.actions}>
            <button
              type="button"
              className={sections.button}
              onClick={() => {
                setPendingCss(null);
                openThemeEditor(pendingCss.theme);
              }}
            >
              {t("appearance.theme.colours_only")}
            </button>
            <button type="button" className={styles.primary} disabled={pendingCss.problems.length > 0} onClick={() => void acceptCss(pendingCss)}>
              {t("appearance.theme.colours_and_css")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className={styles.problem}>{error}</p> : null}
    </div>
  );
}
