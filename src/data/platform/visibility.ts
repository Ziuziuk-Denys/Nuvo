import { createListeners } from "@/engine/listeners";

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

// Hidden to tray keeps the document visible on some compositors, so main reports it
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
