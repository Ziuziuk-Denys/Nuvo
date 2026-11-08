/** The shell's part: search, queue and lyrics commands bound to its state, and their places on the Escape stack. */
import { useEffect, useLayoutEffect, useRef } from "react";
import { navCommands } from "./commands";
import type { Shortcuts } from "./shortcuts";

export interface ShellShortcutOptions {
  searchOpen: boolean;
  openSearch(): void;
  closeSearch(): void;
  rightPanelOpen: boolean;
  openRightPanel(): void;
  closeRightPanel(): void;
  fullscreenOpen: boolean;
  openFullscreen(): void;
  closeFullscreen(): void;
  openRecognize(): void;
  /** Escape with nothing open, for example back from an entity page; true when it acted. */
  onEscapeFallback(): boolean;
}

export function useShellShortcuts(shortcuts: Shortcuts, options: ShellShortcutOptions, hasTrack: () => boolean): void {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useEffect(() => shortcuts.start(), [shortcuts]);

  useEffect(() => {
    const removals = navCommands({
      hasTrack,
      openSearch: () => latest.current.openSearch(),
      toggleQueue: () => (latest.current.rightPanelOpen ? latest.current.closeRightPanel() : latest.current.openRightPanel()),
      lyricsOpen: () => latest.current.fullscreenOpen,
      openLyrics: () => latest.current.openFullscreen(),
      closeLyrics: () => latest.current.closeFullscreen(),
      openRecognize: () => latest.current.openRecognize(),
    }).map((command) => shortcuts.registry.register(command));
    shortcuts.escape.setFallback(() => latest.current.onEscapeFallback());
    return () => {
      for (const remove of removals) remove();
      shortcuts.escape.setFallback(null);
    };
  }, [shortcuts, hasTrack]);

  // each surface takes its place on the stack when it opens, so Escape follows what is on screen
  const { searchOpen, rightPanelOpen, fullscreenOpen } = options;
  useEffect(() => (searchOpen ? shortcuts.escape.push(() => latest.current.closeSearch()) : undefined), [shortcuts, searchOpen]);
  useEffect(() => (rightPanelOpen ? shortcuts.escape.push(() => latest.current.closeRightPanel()) : undefined), [shortcuts, rightPanelOpen]);
  useEffect(() => (fullscreenOpen ? shortcuts.escape.push(() => latest.current.closeFullscreen()) : undefined), [shortcuts, fullscreenOpen]);
}
