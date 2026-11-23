import { useEffect, useLayoutEffect, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../ports/i18n";
import { Callout } from "../../tour/Callout";
import { ringAround, type Box } from "../../tour/placement";
import { radiusOf, seenBox } from "../../tour/targets";

const SHOWN_MS = 5_000;

export function CornerHint({ onDone }: { onDone(): void }): JSX.Element | null {
  const { t } = useTranslation();
  const [box, setBox] = useState<(Box & { radius: number }) | null>(null);
  useLayoutEffect(() => {
    const target = document.querySelector('[data-tour="look-switch"]');
    const seen = target ? seenBox(target) : null;
    setBox(target && seen ? { ...seen, radius: radiusOf(target) } : null);
  }, []);

  useEffect(() => {
    const timer = setTimeout(onDone, SHOWN_MS);
    window.addEventListener("pointerdown", onDone, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", onDone);
    };
  }, [onDone]);

  if (!box) return null;
  const view = { width: innerWidth, height: innerHeight };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, pointerEvents: "none" }} aria-live="polite">
      <Callout
        ring={ringAround(box, view)}
        panel={null}
        area={{ width: view.width, top: 0, bottom: view.height }}
        side="above"
        text={t("visual.choice.here")}
        stepKey="here"
      />
    </div>,
    document.body,
  );
}
