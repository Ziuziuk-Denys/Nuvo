import { useEffect, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../ports/i18n";
import { Callout } from "../tour/Callout";
import { ringAround, type Box } from "../tour/placement";
import { radiusOf, seenBox } from "../tour/targets";
import { useTour } from "../tour/tourStore";

const SEEN_KEY = "nuvo.hint.dislike";
const AFTER_MS = 4_000;
const SHOWN_MS = 5_000;

function takeFirstTime(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY) === "1") return false;
    localStorage.setItem(SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function DislikeHint(): JSX.Element | null {
  const { t } = useTranslation();
  const tourOff = useTour((state) => state.phase === "off");
  const [box, setBox] = useState<(Box & { radius: number }) | null>(null);

  useEffect(() => {
    if (!tourOff) return;
    const timer = setTimeout(() => {
      const target = document.querySelector("[data-island] [data-dislike]");
      const seen = target ? seenBox(target) : null;
      if (target && seen && takeFirstTime()) setBox({ ...seen, radius: radiusOf(target) });
    }, AFTER_MS);
    return () => clearTimeout(timer);
  }, [tourOff]);

  useEffect(() => {
    if (!box) return;
    const done = () => setBox(null);
    const timer = setTimeout(done, SHOWN_MS);
    window.addEventListener("pointerdown", done, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", done);
    };
  }, [box]);

  if (!box) return null;
  const view = { width: innerWidth, height: innerHeight };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, pointerEvents: "none" }} aria-live="polite">
      <Callout
        ring={ringAround(box, view)}
        panel={null}
        area={{ width: view.width, top: 0, bottom: view.height }}
        side="above"
        text={t("ui.recs.dislike_hint")}
        stepKey="dislike"
      />
    </div>,
    document.body,
  );
}
