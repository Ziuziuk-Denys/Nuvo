import type { JSX } from "react";
import { IconButton } from "../components/IconButton";
import { useTranslation } from "../ports/i18n";
import {
  canMinimizeWindow,
  closeWindow,
  minimizeWindow,
  nativeFrame,
  toggleMaximizeWindow,
  toggleWindowFullscreen,
  useWindowFocused,
  useWindowState,
} from "../ports/navigation";
import styles from "./WindowButtons.module.css";

export function WindowButtons({ tray = false }: { tray?: boolean }): JSX.Element {
  return nativeFrame ? <MacButtons tray={tray} /> : <OwnButtons tray={tray} />;
}

function MacButtons({ tray }: { tray: boolean }): JSX.Element {
  const { t } = useTranslation();
  const { isFullScreen } = useWindowState();
  const focused = useWindowFocused();

  return (
    <div
      className={tray ? `${styles.lights} ${styles.tray}` : styles.lights}
      data-window-controls
      data-nuvo-guard="flex"
      data-blurred={focused ? undefined : ""}
    >
      <button type="button" className={`${styles.light} ${styles.closeLight}`} aria-label={t("ui.window.close")} onClick={closeWindow}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.9 3.9l4.2 4.2M8.1 3.9 3.9 8.1" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.light} ${styles.minimizeLight}`}
        aria-label={t("ui.window.minimize")}
        disabled={isFullScreen || !canMinimizeWindow()}
        onClick={() => minimizeWindow()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.4 6h5.2" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.light} ${styles.zoomLight}`}
        aria-label={t(isFullScreen ? "ui.window.exitFullscreen" : "ui.window.enterFullscreen")}
        onClick={toggleWindowFullscreen}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path className={styles.fill} d={isFullScreen ? "M5.4 5.4H2.9l2.5-2.5zM6.6 6.6h2.5L6.6 9.1z" : "M3.2 3.2h3L3.2 6.2zM8.8 8.8h-3l3-3z"} />
        </svg>
      </button>
    </div>
  );
}

function OwnButtons({ tray }: { tray: boolean }): JSX.Element {
  const { t } = useTranslation();
  const { isFullScreen, isMaximized } = useWindowState();
  const expanded = isMaximized || isFullScreen;

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
        label={t(expanded ? "ui.window.restore" : "ui.window.maximize")}
        onClick={toggleMaximizeWindow}
      />
      <IconButton className={`${styles.button} ${styles.close}`} tooltip={false} icon="window-close" label={t("ui.window.close")} onClick={closeWindow} />
    </div>
  );
}
