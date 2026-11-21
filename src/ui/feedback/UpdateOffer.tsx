import { useEffect } from "react";
import { useTranslation } from "../ports/i18n";
import { installUpdate, openReleasePage, readUpdate, watchUpdate, type UpdateView } from "../ports/system";
import { useTour } from "../tour/tourStore";
import { STICKY, useToastStore } from "./toastStore";

const ID = "update-offer";
const declined = new Set<string>();
let asked = false;

export function UpdateOffer(): null {
  const { t } = useTranslation();
  const tourOff = useTour((state) => state.phase === "off");

  useEffect(() => {
    if (!tourOff) return;
    const toasts = useToastStore.getState();
    const offer = (view: UpdateView | null) => {
      if (!view) return;
      const version = { version: view.version ?? "" };
      const later = (key: string) => ({ label: t("ui.update_offer.later"), onClick: () => declined.add(key) });
      if (view.phase === "ready" && view.mode === "install") {
        const key = `ready:${view.version}`;
        if (declined.has(key)) return;
        toasts.show({
          id: ID,
          message: t("ui.update_offer.ready", version),
          variant: "info",
          duration: STICKY,
          later: later(key),
          action: { label: t("ui.update_offer.restart"), onClick: () => void installUpdate() },
        });
      } else if (view.phase === "available") {
        const key = `available:${view.version}`;
        if (declined.has(key)) return;
        const notify = view.mode === "notify";
        toasts.show({
          id: ID,
          message: t("ui.update_offer.available", version),
          variant: "info",
          duration: STICKY,
          later: later(key),
          action: {
            label: t("ui.update_offer.update"),
            onClick: () => {
              asked = !notify;
              void (notify ? openReleasePage() : installUpdate());
            },
          },
        });
      } else if (view.phase === "downloading" && asked) {
        toasts.show({ id: ID, message: t("ui.update_offer.downloading", version), variant: "loader", progress: (view.percent ?? 0) / 100 });
      } else if (asked && (view.phase === "error" || view.phase === "idle")) {
        asked = false;
        toasts.remove(ID);
      }
    };
    void readUpdate().then(offer);
    return watchUpdate(offer);
  }, [t, tourOff]);

  return null;
}
