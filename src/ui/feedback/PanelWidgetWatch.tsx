import { useEffect, useRef } from "react";
import { useTranslation } from "../ports/i18n";
import { panelWidgetRefreshed } from "../ports/system";
import { useToastStore } from "./toastStore";

export function PanelWidgetWatch(): null {
  const { t } = useTranslation();
  const told = useRef(false);
  useEffect(() => {
    void panelWidgetRefreshed().then((refreshed) => {
      if (!refreshed || told.current) return;
      told.current = true;
      useToastStore.getState().show({ message: t("settings.notch.panel_refreshed"), variant: "info" });
    });
  }, [t]);
  return null;
}
