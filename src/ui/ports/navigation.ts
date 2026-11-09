export { useWindowState, useDisableButtonFocus, canMinimizeWindow, minimizeWindow, toggleMaximizeWindow, closeWindow } from "@/data/platform/window";
export { useModalStore } from "../shell/sheets";

export function toggleWindowFullscreen(): void {
  const shell = window.nuvoShell;
  if (shell) {
    void shell.toggleFullscreen().catch(() => undefined);
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}
