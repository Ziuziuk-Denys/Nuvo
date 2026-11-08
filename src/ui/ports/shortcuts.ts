/** The command registry for the UI: in-app keys, global keys from main, Escape order, and the bindings the settings screen edits. */
import { useSyncExternalStore } from "react";
import { CORE_BASE_URL } from "@/data/core/request";
import { formatKeycaps, type Keycap } from "@/data/shortcuts/accelerator";
import { DEFAULT_BINDINGS } from "@/data/shortcuts/bindings";
import { coreCommands, type PlayerControls } from "@/data/shortcuts/commands";
import type { RecorderState } from "@/data/shortcuts/recorder";
import type { Scope } from "@/data/shortcuts/registry";
import { createShortcuts } from "@/data/shortcuts/shortcuts";
import { useShellShortcuts, type ShellShortcutOptions } from "@/data/shortcuts/useShellShortcuts";
import { clock, gainFromSlider, player, sliderFromGain } from "@/engine";
import { setLoopPointHere, useAbLoopStore } from "@/features/sound/useAbLoop";
import { bootedLibrary } from "@/playerBoot";
import { isEscapeGuarded } from "./escape";

export type { ShellShortcutOptions } from "@/data/shortcuts/useShellShortcuts";

// without the engine every player command is disabled
function engine() {
  try {
    return player();
  } catch {
    return null;
  }
}

function positionMs(): number {
  try {
    return clock().positionMs();
  } catch {
    return 0;
  }
}

const playerControls: PlayerControls = {
  hasTrack: () => Boolean(engine()?.getView().current),
  toggle: () => engine()?.toggle(),
  next: () => engine()?.next(),
  previous: () => engine()?.previous(),
  positionMs,
  durationMs: () => engine()?.getView().durationMs ?? 0,
  seekTo: (ms) => engine()?.seekTo(ms),
  volumeLevel: () => Math.round(sliderFromGain(engine()?.getView().volume ?? 0) * 100),
  setVolumeLevel: (level) => engine()?.changeVolume(gainFromSlider(level / 100)),
};

function currentTrack() {
  return engine()?.getView().current?.track ?? null;
}

export const shortcuts = createShortcuts({
  base: CORE_BASE_URL,
  fetch: (input, init) => fetch(input, init),
  storage: () => localStorage,
  shell: window.nuvoShell ?? null,
  strict: import.meta.env.DEV,
  overlayOpen: () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null,
  escapeGuarded: isEscapeGuarded,
  commands: coreCommands({
    player: playerControls,
    likes: {
      currentLiked: () => {
        const track = currentTrack();
        const library = bootedLibrary();
        return track && library ? library.isLiked(track.id) : null;
      },
      like: () => {
        const track = currentTrack();
        if (track) bootedLibrary()?.like(track.id, track);
      },
      unlike: () => {
        const track = currentTrack();
        if (track) bootedLibrary()?.unlike(track.id);
      },
    },
    loop: { setA: () => setLoopPointHere("a"), setB: () => setLoopPointHere("b"), clear: () => useAbLoopStore.getState().clear() },
    app: { quit: () => void window.nuvoShell?.quit(), toggleFullscreen: () => void window.nuvoShell?.toggleFullscreen() },
  }),
});

const hasTrack = () => playerControls.hasTrack();

/** Shell keys: search, queue and lyrics commands, Escape order and the in-app key listener. */
export function useAppShortcuts(options: ShellShortcutOptions): void {
  useShellShortcuts(shortcuts, options, hasTrack);
}

export type { Keycap, RecorderState, Scope as ShortcutScope };

// the registry has no version of its own; this counter changes on every binding or command change
let bindingsVersion = 0;
shortcuts.registry.subscribe(() => {
  bindingsVersion += 1;
});
const watchBindings = (listener: () => void) => shortcuts.registry.subscribe(listener);
const readVersion = () => bindingsVersion;

/** Re-renders on every binding change and returns the effective binding of a command, null when it has none. */
export function useShortcutBindings(): (id: string, scope: Scope) => string | null {
  useSyncExternalStore(watchBindings, readVersion, readVersion);
  return (id, scope) => shortcuts.registry.bindingFor(id, scope);
}

export function defaultShortcut(id: string, scope: Scope): string | null {
  return DEFAULT_BINDINGS[id]?.[scope] ?? null;
}

export const resetShortcut = (id: string, scope: Scope) => shortcuts.registry.resetBinding(id, scope);
export const resetAllShortcuts = () => shortcuts.registry.resetAllBindings();

const watchRecorder = (listener: () => void) => shortcuts.recorder.subscribe(listener);
const readRecorder = () => shortcuts.recorder.state;

/** Idle, or the command being recorded with the held modifiers and the last refusal. */
export function useRecorderState(): RecorderState {
  return useSyncExternalStore(watchRecorder, readRecorder, readRecorder);
}

/** While recording, app keys are off; recording a global binding also releases main's grabs. */
export const startRecording = (id: string, scope: Scope) => shortcuts.recorder.start(id, scope);
export const stopRecording = () => shortcuts.recorder.stop();
/** A key while recording: Escape cancels, a valid free combination is saved, anything else is refused with a reason. True while still recording. */
export function recordKey(event: KeyboardEvent): boolean {
  shortcuts.recorder.key(event);
  return shortcuts.recorder.recording;
}

const platform = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "mac" : "other";

/** Ctrl, Alt, Shift, Super on Linux and Windows; the symbols on macOS. */
export function shortcutKeycaps(accelerator: string): Keycap[] {
  return formatKeycaps(accelerator, platform);
}
