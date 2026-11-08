import type { JSX } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { isEntityRoute, navigateWithTransition } from "./navigate";
import styles from "./TopBar.module.css";
import { WindowButtons } from "./WindowButtons";

/** The window's top row: the Nuvo mark over the rail, a Back chip on entity pages, the window pill. Drags the window. */
export function TopBar(): JSX.Element {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const entity = isEntityRoute(location.pathname);

  const goBack = () => {
    if (window.history.length > 1) void navigate(-1);
    else void navigate("/library");
  };

  return (
    <header className={styles.bar} data-window-drag>
      <a
        href="#/"
        className={styles.mark}
        aria-label="Nuvo"
        data-no-window-drag
        onClick={(event) => {
          event.preventDefault();
          navigateWithTransition(navigate, "/");
        }}
      >
        <Icon name="nuvo-mark" size={24} />
      </a>
      {entity ? (
        <button type="button" className={styles.back} onClick={goBack} data-no-window-drag>
          <Icon name="back" size={16} />
          <span>{t("ui.nav.back")}</span>
        </button>
      ) : null}
      <WindowButtons />
    </header>
  );
}
