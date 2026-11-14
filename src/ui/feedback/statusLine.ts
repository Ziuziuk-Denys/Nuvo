import { useEffect, useState } from "react";
import { useCoreStatus } from "../ports/core";
import { useTranslation } from "../ports/i18n";
import { useStreamingReachable } from "../ports/network";
import { useGateStore } from "../screens/lock/gateState";
import { statusLine } from "./connection";
import { STICKY, useToastStore } from "./toastStore";

const DAEMON_ID = "status-daemon";
const OFFLINE_ID = "status-offline";
const OFFLINE_MS = 8000;
const SLOW_START_MS = 1500;

export function useStatusLine(): void {
  const { t } = useTranslation();
  const core = useCoreStatus();
  const reachable = useStreamingReachable();
  const locked = useGateStore((state) => state.locked);
  const [offlineSeen, setOfflineSeen] = useState(false);
  const [startingLong, setStartingLong] = useState(false);
  const kind = statusLine({ core, locked, reachable, offlineSeen, startingLong })?.kind ?? null;

  useEffect(() => {
    if (core !== "starting") return;
    const timer = setTimeout(() => setStartingLong(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [core]);

  useEffect(() => {
    const { show, remove } = useToastStore.getState();
    if (kind === "daemon-starting") show({ id: DAEMON_ID, message: t("ui.status.starting"), variant: "loader", duration: STICKY });
    else if (kind === "daemon-retrying") show({ id: DAEMON_ID, message: t("ui.status.retrying"), variant: "loader", duration: STICKY });
    else if (kind === "daemon-failed") {
      show({ id: DAEMON_ID, message: t("ui.status.failed"), description: t("ui.status.failed_hint"), variant: "error", duration: STICKY });
    } else remove(DAEMON_ID);

    if (kind === "offline") {
      setOfflineSeen(true);
      show({
        id: OFFLINE_ID,
        message: t("ui.status.offline"),
        description: t("ui.status.offline_hint"),
        variant: "info",
        duration: OFFLINE_MS,
      });
    }
  }, [kind, t]);

  useEffect(() => {
    if (reachable) useToastStore.getState().remove(OFFLINE_ID);
  }, [reachable]);
}
