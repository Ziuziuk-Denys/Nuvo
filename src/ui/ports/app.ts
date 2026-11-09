export { ThemeProvider } from "next-themes";
export { useNotchFeeds } from "@/features/notch";
export { useAbLoop, useSoundSync, useTempoSync } from "@/features/sound";
export type { DeeplinkTarget } from "@/shell/nuvoShell";

import type { DeeplinkTarget } from "@/shell/nuvoShell";

export function watchLinks(open: (target: DeeplinkTarget | null) => void): () => void {
  const shell = window.nuvoShell;
  if (!shell) return () => undefined;
  shell.takePendingLink().then(open, () => undefined);
  return shell.onLink(open);
}
