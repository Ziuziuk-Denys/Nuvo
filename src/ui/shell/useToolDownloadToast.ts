import { useEffect } from "react";
import { useToastStore, STICKY } from "../feedback/toastStore";
import { useTranslation, type TFunction } from "../ports/i18n";
import { readTools, type ToolsView } from "../ports/system";

export const TOAST_ID = "tool-download";
/** How often the daemon is asked: quickly while a tool downloads, rarely otherwise. */
export const BUSY_MS = 1000;
export const IDLE_MS = 30_000;

type Download = NonNullable<ToolsView["download"]>;

/** The calm line for a running download: its name and percent when the size is known. */
export function downloadText(download: Download, t: TFunction): string {
  const tool = download.tool === "ffmpeg" ? "ffmpeg" : "yt-dlp";
  if (!download.total) return t("ui.settings.tools.downloading", { tool });
  return t("ui.settings.tools.progress", { tool, percent: Math.floor((download.received / download.total) * 100) });
}

/**
 * Shows a tool download (ffmpeg or yt-dlp) outside Settings too: one sticky line that updates in
 * place, gone when the download ends. A failed download says so once.
 */
export function useToolDownloadToast(): void {
  const { t } = useTranslation();
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failedFor: string | null = null;
    const toasts = useToastStore.getState();
    const tick = async () => {
      let view: ToolsView | null = null;
      try {
        view = await readTools();
      } catch {
        view = null;
      }
      if (!live) return;
      const download = view?.download;
      if (download && !download.failed) {
        toasts.show({ id: TOAST_ID, variant: "loader", duration: STICKY, message: downloadText(download, t) });
      } else {
        toasts.remove(TOAST_ID);
        if (download?.failed && failedFor !== download.tool) {
          failedFor = download.tool;
          toasts.show({
            id: `${TOAST_ID}-failed`,
            variant: "error",
            message: t("ui.settings.tools.failed", { tool: download.tool === "ffmpeg" ? "ffmpeg" : "yt-dlp" }),
          });
        }
        if (!download) failedFor = null;
      }
      timer = setTimeout(() => void tick(), download && !download.failed ? BUSY_MS : IDLE_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      toasts.remove(TOAST_ID);
    };
  }, [t]);
}
