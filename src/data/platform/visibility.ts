import { createListeners } from "@/engine/listeners";

/** Whether the main window is shown: the document's visibility and main's hidden-to-tray signal. */
let shellVisible = true;
let shellConnected = false;
const listeners = createListeners<[boolean]>();

export function isWindowVisible(): boolean {
  return shellVisible && document.visibilityState === "visible";
}

function emit(): void {
  const visible = isWindowVisible();
  listeners.emit(visible);
}

/** Main's own report (hidden to tray keeps the document "visible" on some compositors); also used by tests. */
export function applyWindowVisibility(visible: boolean): void {
  if (shellVisible === visible) return;
  shellVisible = visible;
  emit();
}

function connectShell(): void {
  if (shellConnected) return;
  shellConnected = true;
  document.addEventListener("visibilitychange", emit);
  window.nuvoShell?.onWinState((state) => applyWindowVisibility(state.visible));
}

export function onWindowVisibilityChange(listener: (visible: boolean) => void): () => void {
  connectShell();
  return listeners.subscribe(listener);
}
