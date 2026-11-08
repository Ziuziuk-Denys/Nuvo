import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { recs, recsChanged } from "../../ports/recs";
import look from "../look.module.css";
import styles from "./HiddenLink.module.css";

/** A quiet way into what "Not interested" hides: the Settings section that lists it. Shown only once something is hidden. */
export function HiddenLink(): JSX.Element | null {
  const { t } = useTranslation();
  const [anyHidden, setAnyHidden] = useState(false);
  useEffect(() => {
    let live = true;
    const check = (): void => {
      void recs.suppressions().then((list) => {
        if (live) setAnyHidden(Array.isArray(list) && list.length > 0);
      });
    };
    check();
    recsChanged.addEventListener("change", check);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", check);
    };
  }, []);
  if (!anyHidden) return null;
  return (
    <button type="button" className={`${look.sectionLink} ${styles.link}`} onClick={() => useModalStore.getState().openSettingsSection("hidden")}>
      {t("ui.recs.hidden.open")}
    </button>
  );
}
