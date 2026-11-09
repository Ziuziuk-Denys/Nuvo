import { useMemo } from "react";
import { useTranslation } from "../ports/i18n";
import type { Track } from "../ports/player";
import { chapterById } from "./chapters";
import { useTour } from "./tourStore";

export const DEMO_TRACK_ID = "nuvo-tour-sample";

export function useTourDemo(): (Track & { playCount: number }) | null {
  const { t } = useTranslation();
  const on = useTour((state) => state.phase === "chapter" && chapterById(state.chapterIds[state.chapter])?.demo === true);
  return useMemo(
    () =>
      on ? { id: DEMO_TRACK_ID, title: t("ui.tour.demo.title"), artists: t("ui.tour.demo.artist"), coverUrl: "", durationMs: 214_000, playCount: 0 } : null,
    [on, t],
  );
}
