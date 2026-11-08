export { ThemeProvider } from "next-themes";
export { useNotchFeeds } from "@/features/notch";
export { useAbLoop, useSoundSync, useTempoSync } from "@/features/sound";
export type { DeeplinkTarget } from "@/shell/nuvoShell";

import type { DeeplinkTarget } from "@/shell/nuvoShell";

/** Links that started the app and links that arrive while it runs; a no-op without the Electron shell. */
export function watchLinks(open: (target: DeeplinkTarget | null) => void): () => void {
  const shell = window.nuvoShell;
  if (!shell) return () => undefined;
  shell.takePendingLink().then(open, () => undefined);
  return shell.onLink(open);
}
