import type { JSX } from "react";
import { IconButton } from "../components/IconButton";
import { useTranslation } from "../ports/i18n";
import { canMinimizeWindow, closeWindow, minimizeWindow, nativeFrame, toggleMaximizeWindow, toggleWindowFullscreen, useWindowState } from "../ports/navigation";
import styles from "./WindowButtons.module.css";

export function WindowButtons({ tray = false }: { tray?: boolean }): JSX.Element {
  return <OwnButtons tray={tray} />;
}

function OwnButtons({ tray }: { tray: boolean }): JSX.Element {
  const { t } = useTranslation();
  const { isFullScreen, isMaximized } = useWindowState();
  const expanded = isMaximized || isFullScreen;
  const fullScreen = nativeFrame && !isFullScreen;

  return (
    <div className={tray ? `${styles.buttons} ${styles.tray}` : styles.buttons} data-window-controls data-nuvo-guard="flex">
      <IconButton
        className={styles.button}
        tooltip={false}
        icon="window-minimize"
        label={t("ui.window.minimize")}
        disabled={!canMinimizeWindow()}
        onClick={() => minimizeWindow()}
      />
      <IconButton
        className={styles.button}
        tooltip={false}
        icon={expanded ? "window-restore" : "window-maximize"}
        label={t(fullScreen ? "ui.window.fullscreen" : expanded ? "ui.window.restore" : "ui.window.maximize")}
        onClick={nativeFrame ? toggleWindowFullscreen : toggleMaximizeWindow}
      />
      <IconButton className={`${styles.button} ${styles.close}`} tooltip={false} icon="window-close" label={t("ui.window.close")} onClick={closeWindow} />
    </div>
  );
}
