import { useState, type JSX } from "react";
import { Icon } from "../../icons/Icon";
import { sanitizeCss, useAppearanceStore, type CssProblem } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { SettingBlock, SettingRow, Switch } from "./controls";
import styles from "./look.module.css";
import sections from "./sections.module.css";

const HOOKS = ["--n-field", "--n-deep", "--n-raised", "--n-ink", "--n-ink-2", "--n-ink-3", "--n-hair", "--n-tint", "--n-accent"];

export function CustomCssBlock(): JSX.Element {
  const { t } = useTranslation();
  const customCss = useAppearanceStore((s) => s.saved.customCss);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(customCss.text);
  const [problems, setProblems] = useState<CssProblem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: { enabled: boolean; text: string }) => {
    setError((await useAppearanceStore.getState().save({ customCss: next })) ? null : t("appearance.errors.save_failed"));
  };

  const apply = () => {
    const result = sanitizeCss(text);
    setProblems(result.ok ? [] : result.problems);
    if (result.ok) void save({ enabled: true, text });
  };

  const lines = text.split("\n").length;

  return (
    <SettingBlock title={t("appearance.css.title")} titleKey="appearance.css.title" description={t("appearance.css.warning")} descKey="appearance.css.warning">
      <div className={styles.cssHead}>
        <button type="button" className={sections.button} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? "appearance.css.hide" : "appearance.css.show")}
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} />
        </button>
        <span className={styles.cssToggle}>
          <span>{t("appearance.css.enabled")}</span>
          <Switch
            label={t("appearance.css.enabled")}
            checked={customCss.enabled}
            disabled={customCss.text.trim() === ""}
            onChange={(enabled) => void save({ ...customCss, enabled })}
          />
        </span>
      </div>
      {expanded ? (
        <>
          <div className={styles.cssEditor}>
            <pre className={styles.gutter} aria-hidden="true">
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              className={styles.cssText}
              value={text}
              spellCheck={false}
              rows={10}
              aria-label={t("appearance.css.editor")}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {problems.map((problem) => (
            <p key={`${problem.line}-${problem.key}`} className={styles.problem}>
              {t("appearance.css.line", { line: problem.line, message: t(`appearance.css_errors.${problem.key}`) })}
            </p>
          ))}
          {error ? <p className={styles.problem}>{error}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={apply}>
              {t("appearance.css.apply")}
            </button>
            <button
              type="button"
              className={sections.button}
              onClick={() => {
                setText("");
                setProblems([]);
                void save({ enabled: false, text: "" });
              }}
            >
              {t("appearance.css.clear")}
            </button>
          </div>
          <details className={styles.reference}>
            <summary>{t("appearance.css.reference")}</summary>
            <p>{t("appearance.css.reference_hooks")}</p>
            <code className={styles.hooks}>{HOOKS.join("  ")}</code>
            <p>{t("appearance.css.reference_regions")}</p>
            <p>{t("appearance.css.reference_unstable")}</p>
          </details>
        </>
      ) : null}
    </SettingBlock>
  );
}

export function ResetAppearanceRow(): JSX.Element {
  const { t } = useTranslation();
  const safe = useAppearanceStore((s) => s.safe);
  return (
    <SettingRow
      title={t("appearance.safe.reset")}
      titleKey="appearance.safe.reset"
      description={safe ? t("appearance.safe.banner") : undefined}
      explained
      control={
        <button
          type="button"
          className={sections.button}
          data-nuvo-guard="inline-flex"
          disabled={safe}
          onClick={() => void useAppearanceStore.getState().setSafe(true)}
        >
          {t("appearance.safe.reset")}
        </button>
      }
    />
  );
}
