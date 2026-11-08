import { useContext, useEffect, useState, type JSX } from "react";
import { Sheet } from "../../components/Sheet";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { useTranslation } from "../../ports/i18n";
import { defaultShortcut, resetAllShortcuts, resetShortcut, useShortcutBindings, type ShortcutScope } from "../../ports/shortcuts";
import { SearchQuery } from "./controls";
import { KeyRecorder, type Rejection } from "./KeyRecorder";
import { matchesQuery } from "./sections";
import { ClearGlyph } from "./SectionIcon";
import styles from "./shortcuts.module.css";

/** Each row: the registry command, the scope it is bound in, and the name its texts use. */
const ACTIONS: { id: string; scope: ShortcutScope; action: string; icon: IconName }[] = [
  { id: "player.toggle", scope: "app", action: "playPause", icon: "play" },
  { id: "player.next", scope: "app", action: "nextTrack", icon: "next" },
  { id: "player.previous", scope: "app", action: "prevTrack", icon: "previous" },
  { id: "player.seek-forward", scope: "app", action: "seekForward", icon: "forward" },
  { id: "player.seek-back", scope: "app", action: "seekBackward", icon: "back" },
  { id: "player.volume-up", scope: "app", action: "volumeUp", icon: "volume-high" },
  { id: "player.volume-down", scope: "app", action: "volumeDown", icon: "volume-low" },
  { id: "player.mute", scope: "app", action: "toggleMute", icon: "volume-mute" },
  { id: "nav.search", scope: "app", action: "search", icon: "search" },
  { id: "nav.queue", scope: "app", action: "toggleQueue", icon: "queue" },
  { id: "nav.lyrics", scope: "app", action: "toggleFullscreen", icon: "expand" },
  { id: "nav.recognize", scope: "app", action: "recognize", icon: "recognize" },
  { id: "loop.set-a", scope: "app", action: "loopA", icon: "loop" },
  { id: "loop.set-b", scope: "app", action: "loopB", icon: "loop" },
  { id: "loop.clear", scope: "app", action: "loopClear", icon: "loop" },
  { id: "library.like-toggle", scope: "global", action: "quickLikeSong", icon: "liked" },
];

/** settings.shortcuts.play_pause for playPause. */
function labelKey(action: string): string {
  return `settings.shortcuts.${action.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

export function ShortcutsSection(): JSX.Element {
  const { t } = useTranslation();
  const settingsQuery = useContext(SearchQuery);
  const bindingOf = useShortcutBindings();
  const [scope, setScope] = useState<ShortcutScope>("app");
  const [localQuery, setLocalQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // a press outside the recording row stops recording
  useEffect(() => {
    if (!recording) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(`[data-shortcut="${recording}"]`)) setRecording(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [recording]);

  const query = (localQuery || settingsQuery).trim();
  const items = ACTIONS.filter((item) =>
    query ? matchesQuery(query, [labelKey(item.action), `${labelKey(item.action)}_desc`], [bindingOf(item.id, item.scope) ?? ""]) : item.scope === scope,
  );
  const count = (which: ShortcutScope) => ACTIONS.filter((item) => item.scope === which).length;

  const rejectionText = (rejection: Rejection): string => {
    if (rejection.reason === "needs-modifier") return t("settings.shortcuts.modifier_required");
    if (rejection.reason !== "conflict") return t("settings.shortcuts.recording_hint");
    const taken = ACTIONS.find((item) => item.id === rejection.conflictId);
    return t("settings.shortcuts.conflict_error", { action: taken ? t(labelKey(taken.action)) : (rejection.conflictId ?? "") });
  };

  return (
    <div className={styles.shortcuts}>
      <div className={styles.bar}>
        <div role="tablist" className={styles.scopes}>
          {(["app", "global"] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="tab"
              aria-selected={!query && scope === which}
              className={styles.scope}
              onClick={() => {
                setLocalQuery("");
                setScope(which);
              }}
            >
              {t(which === "app" ? "settings.shortcuts.tab_main_app" : "settings.shortcuts.tab_global")}
              <span className={styles.count}>{count(which)}</span>
            </button>
          ))}
        </div>
        <div className={styles.tools}>
          <label className={styles.find}>
            <Icon name="search" size={16} />
            <input
              type="text"
              value={localQuery}
              placeholder={t("settings.shortcuts.search_placeholder")}
              aria-label={t("settings.shortcuts.search_placeholder")}
              onChange={(event) => setLocalQuery(event.target.value)}
            />
            {localQuery ? (
              <button type="button" className={styles.findClear} aria-label={t("ui.clear")} onClick={() => setLocalQuery("")}>
                <ClearGlyph />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className={styles.resetAll}
            aria-label={t("settings.shortcuts.reset_all")}
            title={t("settings.shortcuts.reset_all")}
            onClick={() => setConfirmReset(true)}
          >
            <Icon name="undo" size={16} />
          </button>
        </div>
      </div>

      <div key={query ? `q:${query}` : scope} className={styles.list}>
        {items.length === 0 ? <p className={styles.empty}>{t("search.no_results")}</p> : null}
        {items.map((item) => {
          const id = `${item.scope}-${item.action}`;
          const value = bindingOf(item.id, item.scope) ?? "";
          const fallback = defaultShortcut(item.id, item.scope);
          return (
            <div
              key={id}
              data-shortcut={item.action}
              className={styles.row}
              role="button"
              tabIndex={0}
              aria-pressed={recording === id}
              onClick={() => setRecording((current) => (current === id ? null : id))}
              onKeyDown={(event) => {
                if (recording !== id && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  setRecording(id);
                }
              }}
            >
              <span className={styles.rowLabel}>
                <span className={styles.rowIcon}>
                  <Icon name={item.icon} size={20} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{t(labelKey(item.action))}</span>
                  <span className={styles.tag} data-scope={item.scope}>
                    {t(item.scope === "global" ? "settings.shortcuts.scope_global" : "settings.shortcuts.scope_main_app")}
                  </span>
                </span>
              </span>
              <KeyRecorder
                commandId={item.id}
                scope={item.scope}
                value={value}
                recording={recording === id}
                rejectionText={rejectionText}
                onRecordingChange={(on) => setRecording(on ? id : null)}
              />
              {fallback && value !== fallback && recording !== id ? (
                <button
                  type="button"
                  className={styles.reset}
                  aria-label={t("settings.shortcuts.reset_tooltip", { shortcut: fallback })}
                  title={t("settings.shortcuts.reset_tooltip", { shortcut: fallback })}
                  onClick={(event) => {
                    event.stopPropagation();
                    resetShortcut(item.id, item.scope);
                  }}
                >
                  <Icon name="undo" size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t("ui.settings.reset_shortcuts_title")}
        actions={[
          { label: t("common.cancel"), onClick: () => setConfirmReset(false) },
          {
            label: t("settings.shortcuts.reset_all_button"),
            primary: true,
            onClick: () => {
              resetAllShortcuts();
              setConfirmReset(false);
            },
          },
        ]}
      >
        {t("ui.settings.reset_shortcuts_text")}
      </Sheet>
    </div>
  );
}
