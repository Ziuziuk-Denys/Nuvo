import { useEffect, useState } from "react";
import type { AppInfo, WinState } from "@/shell/nuvoShell";

/** Window state, window commands, drag regions and mouse focus rings. */
export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
  isEdgeToEdge: boolean;
}

let winState: WinState = { maximized: false, fullscreen: false, visible: true };
let appInfo: AppInfo | null = null;
let connected = false;
const listeners = new Set<() => void>();

export function windowStateFrom(win: WinState, tiling: boolean): WindowState {
  return { isMaximized: win.maximized, isFullScreen: win.fullscreen, isEdgeToEdge: win.maximized || win.fullscreen || tiling };
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function connect(): void {
  if (connected) return;
  connected = true;
  const shell = window.nuvoShell;
  if (!shell) return;
  const update = (next: WinState) => {
    winState = next;
    emit();
  };
  shell.getWinState().then(update, () => undefined);
  shell.getAppInfo().then(
    (info) => {
      appInfo = info;
      emit();
    },
    () => undefined,
  );
  shell.onWinState(update);
}

function current(): WindowState {
  return windowStateFrom(winState, appInfo?.tiling === true);
}

export function useWindowState(): WindowState {
  const [state, setState] = useState(current);
  useEffect(() => {
    connect();
    const listener = () => setState(current());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

export function minimizeWindow(): void {
  void window.nuvoShell?.minimize();
}

export function toggleMaximizeWindow(): void {
  void window.nuvoShell?.toggleMaximize();
}

export function closeWindow(): void {
  void window.nuvoShell?.close();
}

/** Tiling compositors have nowhere to minimize to. */
export function canMinimizeWindow(): boolean {
  connect();
  return appInfo?.tiling !== true;
}

const NO_DRAG = "button, a, input, textarea, select, [role=slider], [contenteditable], [data-no-drag]";

export function isDragTarget(element: Element | null): boolean {
  if (!element?.closest("[data-window-drag]")) return false;
  return !element.closest(NO_DRAG);
}

export function useWindowDrag(): void {
  useEffect(() => {
    const shell = window.nuvoShell;
    if (!shell) return;
    let dragging = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !isDragTarget(event.target as Element | null)) return;
      dragging = true;
      shell.drag("start");
    };
    const move = () => {
      if (dragging) shell.drag("move");
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      shell.drag("end");
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
  }, []);
}

/** A pointer click (`detail > 0`) blurs the clicked button; keyboard activation has `detail` 0 and keeps focus. */
export function useDisableButtonFocus(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.detail === 0) return;
      const button = (event.target as Element | null)?.closest?.("button");
      if (button && document.activeElement === button) (button as HTMLButtonElement).blur();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
