import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { LAYER_ATTRIBUTE, trapTab, useLayer, usePresence } from "../../components/layers";
import { Row } from "../../components/Row";
import { TextField } from "../../components/TextField";
import { getTranslationsForAllLocales, loadAllLocales, useTranslation } from "../../ports/i18n";
import { toggleWindowFullscreen, useModalStore } from "../../ports/navigation";
import { isRadioContext, nextRepeatMode, playerEngine, usePlayerStore, type Track } from "../../ports/player";
import { SETTING_ITEMS } from "../settings/settingItems";
import { shortcutKeycaps, useRecorderState, useShortcutBindings } from "../../ports/shortcuts";
import { navigateWithTransition } from "../../shell/navigate";
import { useGateStore } from "../lock/gateState";
import { useTour } from "../../tour/tourStore";
import { buildCommands, rankCommands, soundCommands, type Command, type CommandGroup } from "./commands";
import { applyTempo, BUILT_IN_PRESETS, TEMPO_PRESETS, useSoundStore, type TempoPresetKey } from "../../ports/sound";
import styles from "./Palette.module.css";

const LIMIT = 8;

const TEMPO_LABELS: Record<TempoPresetKey, string> = {
  normal: "sound.tempo.normal",
  slowed: "sound.tempo.slowed",
  slowedReverb: "sound.tempo.slowed_reverb",
  spedUp: "sound.tempo.sped_up",
  nightcore: "sound.tempo.nightcore",
  daycore: "sound.tempo.daycore",
};
const TEMPO_KEYS = (Object.keys(TEMPO_PRESETS) as TempoPresetKey[]).map((key) => ({ key, labelKey: TEMPO_LABELS[key] }));

function applyEq(name: string): void {
  const store = useSoundStore.getState();
  if (!store.eqEnabled) store.setEnabled(true);
  if (store.bypass) store.setBypass(false);
  store.applyPreset(name);
}

export function Palette(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const recording = useRecorderState().kind === "recording";
  const locked = useGateStore((state) => state.locked);
  const phase = usePresence(open);

  if (locked && open) setOpen(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // the code, not the key, so the Russian layout's Л works too
      if (useGateStore.getState().locked || recording || event.code !== "KeyK" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recording]);

  return phase === null ? null : <PalettePanel open={open} phase={phase} onClose={() => setOpen(false)} />;
}

function PalettePanel({ open, phase, onClose }: { open: boolean; phase: "in" | "out"; onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openSettings = useModalStore((state) => state.openSettings);
  const openSettingsSection = useModalStore((state) => state.openSettingsSection);
  const bindingOf = useShortcutBindings();
  const shortcuts = (commandId: string) => bindingOf(commandId, "app");
  const panelRef = useRef<HTMLDivElement>(null);
  const eqEnabled = useSoundStore((state) => state.eqEnabled);
  const ownPresets = useSoundStore((state) => state.customPresets);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [, setLocalesLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void loadAllLocales().then(() => live && setLocalesLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  useLayer(open, panelRef, { onEscape: onClose, onOutside: onClose });

  const withTrack = (action: (track: Track) => void) => () => {
    const track = playerEngine.getSnapshot().currentTrack;
    if (track) action(track);
  };

  const commands = buildCommands({
    t,
    translations: getTranslationsForAllLocales,
    shortcuts,
    settingItems: SETTING_ITEMS,
    openSettings: openSettingsSection,
    actions: {
      home: () => navigateWithTransition(navigate, "/"),
      library: () => navigateWithTransition(navigate, "/library"),
      search: () => navigateWithTransition(navigate, "/search"),
      settings: openSettings,
      play_pause: () => playerEngine.togglePlayPause(),
      next: () => void playerEngine.skipNext(),
      previous: () => void playerEngine.skipPrevious(),
      radio: withTrack((track) => void playerEngine.startRadioStation(track)),
      lyrics: withTrack(() => usePlayerStore.getState().setFullscreen(true)),
      shuffle: () => playerEngine.setShuffle(!playerEngine.getSnapshot().shuffle),
      repeat: () => {
        const snapshot = playerEngine.getSnapshot();
        playerEngine.setRepeat(nextRepeatMode(snapshot.repeat, isRadioContext(snapshot.playbackContext)));
      },
      fullscreen: toggleWindowFullscreen,
      tour: () => useTour.getState().replay(),
    },
  });

  const sound = soundCommands({
    t,
    translations: getTranslationsForAllLocales,
    eqOn: eqEnabled,
    eqPresets: Object.keys(BUILT_IN_PRESETS),
    ownPresets: Object.keys(ownPresets),
    tempoPresets: TEMPO_KEYS,
    toggleEq: () => useSoundStore.getState().setEnabled(!eqEnabled),
    applyEq,
    applyTempo: (key) => applyTempo(TEMPO_PRESETS[key as TempoPresetKey]),
  });
  commands.push(...sound);

  const groups: { group: CommandGroup; items: Command[] }[] = [];
  for (const command of rankCommands(commands, query).slice(0, LIMIT)) {
    const found = groups.find((entry) => entry.group === command.group);
    if (found) found.items.push(command);
    else groups.push({ group: command.group, items: [command] });
  }
  const visible = groups.flatMap((entry) => entry.items);
  const active = Math.min(selected, visible.length - 1);

  const run = (command: Command) => {
    onClose();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    trapTab(event, event.currentTarget);
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && visible.length > 0) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((active + step + visible.length) % visible.length);
    } else if (event.key === "Enter" && !event.defaultPrevented && visible[active]) {
      event.preventDefault();
      run(visible[active]);
    }
  };

  const label = t("ui.palette.placeholder");

  return createPortal(
    <div className={styles.frame} {...{ [LAYER_ATTRIBUTE]: "" }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={styles.panel}
        data-state={phase}
        data-below=""
        // Escape belongs to the overlay stack here, not to the global shortcuts
        data-own-escape=""
        onKeyDown={onKeyDown}
      >
        <TextField
          size="l"
          bare
          label={label}
          placeholder={label}
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSelected(0);
          }}
        />
        {visible.length > 0 ? (
          <div className={styles.list}>
            {groups.map(({ group, items }) => {
              const name = t(`ui.palette.group_${group}`);
              return (
                <div key={group} role="group" aria-label={name} className={styles.group}>
                  <div aria-hidden className={styles.label}>
                    {name}
                  </div>
                  {items.map((command) => {
                    const index = visible.indexOf(command);
                    return (
                      <Row
                        key={command.id}
                        variant="compact"
                        title={command.title}
                        meta={command.shortcut ? <Keycaps accelerator={command.shortcut} /> : undefined}
                        data-selected={index === active ? "" : undefined}
                        onMouseMove={() => setSelected(index)}
                        onActivate={() => run(command)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <p role="status" className={styles.none}>
            {t("ui.palette.none")}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Keycaps({ accelerator }: { accelerator: string }): JSX.Element {
  return (
    <span className={styles.keys}>
      {shortcutKeycaps(accelerator).map((cap, index) => (
        <kbd key={index} className={styles.key} aria-label={cap.label}>
          {cap.text}
        </kbd>
      ))}
    </span>
  );
}
