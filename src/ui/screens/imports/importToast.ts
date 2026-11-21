import { useEffect, useRef } from "react";
import { useToastStore } from "../../feedback/toastStore";
import { useTranslation } from "../../ports/i18n";
import { useImportSummaries } from "../../ports/importsRuntime";

const TOAST_ID = "import-progress";

export function useImportToast(): void {
  const { t } = useTranslation();
  const running = useImportSummaries().filter((summary) => summary.status === "running");
  const done = running.reduce((sum, summary) => sum + summary.done, 0);
  const total = running.reduce((sum, summary) => sum + summary.total, 0);
  const message =
    running.length === 0
      ? ""
      : running.length === 1
        ? t("ui.imports.toast.one", { name: running[0].label })
        : t("ui.imports.toast.many", { count: running.length });
  const wasRunning = useRef(false);

  useEffect(() => {
    const toast = useToastStore.getState();
    if (message) {
      wasRunning.current = true;
      toast.show({
        id: TOAST_ID,
        message,
        description: total > 0 ? t("ui.imports.toast.progress", { done, total }) : undefined,
        variant: "loading",
        progress: total > 0 ? done / total : undefined,
      });
    } else if (wasRunning.current) {
      wasRunning.current = false;
      toast.show({ id: TOAST_ID, message: t("ui.imports.toast.done"), variant: "success" });
    }
  }, [message, done, total, t]);
}
