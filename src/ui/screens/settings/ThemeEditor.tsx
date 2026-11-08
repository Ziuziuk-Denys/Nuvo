import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Popover } from "../../components/Popover";
import { TextField } from "../../components/TextField";
import { useLayer } from "../../components/layers";
import { Icon } from "../../icons/Icon";
import {
  applyTokens,
  blockingModes,
  contrastReport,
  CUSTOM_PREFIX,
  deriveRoles,
  fixContrast,
  rolesFor,
  ROLE_KEYS,
  themeTokens,
  useAppearanceStore,
  type NuvoTheme,
  type RoleKey,
  type ThemeRoles,
} from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { useLook, useSetThemeMode } from "../../ports/theme";
import { ColorPicker } from "./ColorPicker";
import { Segmented, Switch } from "./controls";
import styles from "./look.module.css";

const TRANSLUCENT: readonly RoleKey[] = ["ink2", "ink3", "hair", "tint"];
const SEEDS: readonly RoleKey[] = ["field", "accent"];
const CHIP_DEBOUNCE_MS = 120;

/** Whether the docked sheet is showing. The draft lives in the appearance store and outlives the sheet. */
export const useThemeEditor = create<{ open: boolean; show(): void; hide(): void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Opens the sheet over the live app: Settings steps aside so every change shows on the real screens. */
export function openThemeEditor(theme?: NuvoTheme): void {
  if (theme) useAppearanceStore.getState().setDraft(theme);
  useModalStore.getState().closeSettings();
  useThemeEditor.getState().show();
}

/** The roles after one change: with Smart start on, a seed change re-derives every role not overridden by hand. */
export function withRole(theme: NuvoTheme, mode: "light" | "dark", role: RoleKey, value: string, smart: boolean, overridden: ReadonlySet<RoleKey>): NuvoTheme {
  const roles: ThemeRoles = { ...rolesFor(theme, mode), [role]: value };
  let next = roles;
  if (smart && SEEDS.includes(role)) {
    next = { ...deriveRoles(roles.field, roles.accent, mode), field: roles.field, accent: roles.accent };
    for (const key of overridden) next[key] = roles[key];
  }
  return { ...theme, modes: { ...theme.modes, [mode]: next } };
}

/** Mounted once next to Settings; shows the sheet while it is open and a draft exists. */
export function ThemeEditorHost(): JSX.Element | null {
  const open = useThemeEditor((s) => s.open);
  const draft = useAppearanceStore((s) => s.draft !== null);
  if (!open || !draft) return null;
  return createPortal(<ThemeEditor />, document.body);
}

/** Back to the section the sheet came from; the draft stays for "Open" there. */
function closeEditor(): void {
  useThemeEditor.getState().hide();
  useModalStore.getState().openSettingsSection("appearance");
}

/** The docked sheet over the playing app (customization 2). Not modal: the app behind stays live and shows every change. */
function ThemeEditor(): JSX.Element | null {
  const { t } = useTranslation();
  const draft = useAppearanceStore((s) => s.draft);
  const saved = useAppearanceStore((s) => s.saved);
  const { mode } = useLook();
  const setMode = useSetThemeMode();
  const panelRef = useRef<HTMLElement>(null);
  const [base] = useState(draft);
  const [picking, setPicking] = useState<RoleKey | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [smart, setSmart] = useState(true);
  const [overridden, setOverridden] = useState<Set<RoleKey>>(() => new Set());
  const [technical, setTechnical] = useState(false);
  const [chipRoles, setChipRoles] = useState<ThemeRoles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef(0);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<NuvoTheme | null>(null);

  useLayer(true, panelRef, { onEscape: closeEditor });
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(chipTimer.current);
      document.documentElement.removeAttribute("data-theme-editing");
    },
    [],
  );

  if (!draft) return null;
  const setDraft = useAppearanceStore.getState().setDraft;
  const roles = rolesFor(draft, mode);
  const report = new Map(contrastReport(chipRoles ?? roles).map((line) => [line.role, line]));
  const blocked = blockingModes(draft);
  // the sheet is painted with the draft too; its own text stays readable, so the way out is never hidden by the colours being fixed
  const readableInk = fixContrast(roles.ink, roles.raised, 4.5);
  const sheetStyle =
    readableInk === roles.ink ? undefined : ({ "--n-ink": readableInk, "--btn-primary-bg": readableInk, "--btn-primary-text": roles.raised } as CSSProperties);

  // dragging: one token write per frame straight to :root, no React render of the app
  const onInput = (role: RoleKey, value: string) => {
    pending.current = withRole(draft, mode, role, value, smart, overridden);
    document.documentElement.setAttribute("data-theme-editing", "");
    frame.current ||= requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) applyTokens(document.documentElement, `${CUSTOM_PREFIX}${pending.current.id}`, themeTokens(pending.current, mode));
    });
    clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => {
      if (pending.current) setChipRoles(rolesFor(pending.current, mode));
    }, CHIP_DEBOUNCE_MS);
  };

  const onCommit = (role: RoleKey, value: string) => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    clearTimeout(chipTimer.current);
    pending.current = null;
    document.documentElement.removeAttribute("data-theme-editing");
    const nextOverridden = smart && !SEEDS.includes(role) ? new Set(overridden).add(role) : overridden;
    setOverridden(nextOverridden);
    setChipRoles(null);
    setDraft(withRole(draft, mode, role, value, smart, nextOverridden));
  };

  const save = async () => {
    setError(null);
    const themes = [...saved.themes.filter((theme) => theme.id !== draft.id), draft];
    const ok = await useAppearanceStore.getState().save({ themes, active: { presetId: `${CUSTOM_PREFIX}${draft.id}` } });
    if (!ok) {
      setError(t("appearance.errors.save_failed"));
      return;
    }
    setDraft(null);
    closeEditor();
  };

  const roleName = (role: RoleKey) => (technical ? `--n-${role.replace(/(\d)$/, "-$1")}` : t(`appearance.roles.${role}.name`));

  return (
    <aside ref={panelRef} className={styles.editor} style={sheetStyle} aria-label={t("appearance.editor.label")}>
      <header className={styles.editorHead}>
        <span className={styles.editorTitle}>{t("appearance.editor.label")}</span>
        <button type="button" className={styles.close} aria-label={t("common.close")} onClick={closeEditor}>
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className={`${styles.editorBody} n-scroll`}>
        <TextField label={t("appearance.editor.name")} value={draft.name} maxLength={40} onChange={(name) => setDraft({ ...draft, name })} />
        <Segmented
          label={t("appearance.editor.mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "light", label: t("appearance.editor.light") },
            { value: "dark", label: t("appearance.editor.dark") },
          ]}
        />
        {!draft.modes[mode] ? <p className={styles.note}>{t("appearance.editor.shared_mode")}</p> : null}

        <div className={styles.swatches}>
          {ROLE_KEYS.map((role) => {
            const line = report.get(role);
            return (
              <div key={role} className={styles.swatch}>
                <button
                  type="button"
                  className={styles.swatchButton}
                  aria-label={t("appearance.editor.edit_role", { role: roleName(role) })}
                  aria-expanded={picking === role}
                  onClick={(event) => {
                    setAnchor(event.currentTarget);
                    setPicking(role);
                  }}
                >
                  <span className={styles.colour} style={{ background: roles[role] }} />
                  <span className={styles.roleName}>{roleName(role)}</span>
                  <span className={styles.hint}>{t(`appearance.roles.${role}.hint`)}</span>
                </button>
                {line ? (
                  <span className={styles.contrast} data-pass={line.pass ? "" : undefined}>
                    <Icon name={line.pass ? "check" : "warning"} size={14} />
                    {t(line.pass ? "appearance.contrast.pass" : "appearance.contrast.warn", { ratio: line.ratio.toFixed(1) })}
                  </span>
                ) : null}
                {line && !line.pass ? (
                  <button type="button" className={styles.textAction} onClick={() => onCommit(role, fixContrast(roles[role], roles.field, line.target))}>
                    {t("appearance.contrast.fix")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={styles.switchRow}>
          <span>{t("appearance.editor.smart")}</span>
          <Switch label={t("appearance.editor.smart")} checked={smart} onChange={setSmart} />
        </div>
        <div className={styles.switchRow}>
          <span>{t("appearance.editor.technical")}</span>
          <Switch label={t("appearance.editor.technical")} checked={technical} onChange={setTechnical} />
        </div>

        {blocked.length > 0 ? <p className={styles.problem}>{t("appearance.contrast.blocked", { mode: t(`appearance.editor.${blocked[0]}`) })}</p> : null}
        {error ? <p className={styles.problem}>{error}</p> : null}
      </div>

      <footer className={styles.editorFoot}>
        <button type="button" className={styles.button} onClick={() => setDraft(saved.themes.find((theme) => theme.id === draft.id) ?? base)}>
          {t("appearance.editor.revert")}
        </button>
        <button type="button" className={styles.primary} disabled={blocked.length > 0 || draft.name.trim() === ""} onClick={() => void save()}>
          {t("appearance.editor.save")}
        </button>
      </footer>

      {picking ? (
        <Popover open solid anchor={anchor} onClose={() => setPicking(null)} title={roleName(picking)} width={300}>
          <ColorPicker
            key={`${picking}-${mode}`}
            value={roles[picking]}
            translucent={TRANSLUCENT.includes(picking)}
            label={roleName(picking)}
            onInput={(value) => onInput(picking, value)}
            onCommit={(value) => onCommit(picking, value)}
          />
        </Popover>
      ) : null}
    </aside>
  );
}
