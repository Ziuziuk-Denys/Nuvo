import { useEffect } from "react";
import { useTranslation } from "../ports/i18n";
import { runNetworkCheck } from "../ports/system";
import { useTour } from "../tour/tourStore";
import { adviceFor, type Advice } from "./connectionAdvice";
import { useToastStore } from "./toastStore";

const FIRST_CHECK_MS = 5000;

// The first check waits for the tour: a toast under its layer would fade unread
export function ConnectionWatch() {
  const { t } = useTranslation();
  const tourOff = useTour((state) => state.phase === "off");

  useEffect(() => {
    if (!tourOff) return;
    const told = new Set<Advice>();
    const check = async (cause: string | null) => {
      const result = await runNetworkCheck().catch(() => null);
      const advice = result && adviceFor(result, cause);
      if (!advice || told.has(advice)) return;
      told.add(advice);
      useToastStore.getState().show({ message: t(`ui.network_advice.${advice}`), variant: "info" });
    };
    const onCheck = (event: Event) => void check(String((event as CustomEvent).detail ?? ""));
    const onChange = () => {
      told.clear();
      void check(null);
    };
    const first = setTimeout(() => void check(null), FIRST_CHECK_MS);
    window.addEventListener("nuvo:network-check", onCheck);
    window.addEventListener("online", onChange);
    const off = window.nuvoShell?.onNetworkChanged(onChange);
    return () => {
      clearTimeout(first);
      window.removeEventListener("nuvo:network-check", onCheck);
      window.removeEventListener("online", onChange);
      off?.();
    };
  }, [t, tourOff]);

  return null;
}
