import { useLayoutEffect, useRef, type JSX, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lens } from "../components/Lens";
import { useContextMenu } from "../components/Menu";
import { Tooltip } from "../components/Tooltip";
import { reducedEffectsNow } from "../effects";
import { Icon } from "../icons/Icon";
import { DURATION_MS, EASE } from "../motion";
import { useTranslation } from "../ports/i18n";
import { useModalStore } from "../ports/navigation";
import { useCustomizationStore } from "../ports/settings";
import { unpinEverywhere } from "../screens/entity/entityActions";
import { PaletteField } from "../screens/palette/Palette";
import { useHistoryEnds } from "./history";
import { isEntityRoute } from "./navigate";
import { PinArt } from "./PinArt";
import { Rail } from "./rail/Rail";
import styles from "./TopBar.module.css";
import { useNav } from "./useNav";
import { WindowButtons } from "./WindowButtons";

const SWAP = { duration: DURATION_MS.base, easing: `cubic-bezier(${EASE.out.join(", ")})` };

export function TopBar(): JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openSettings = useModalStore((state) => state.openSettings);
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const searchOpen = useModalStore((state) => state.searchOpen);
  const { sections, pins, active, go } = useNav();
  const ends = useHistoryEnds();
  const pinMenu = useContextMenu();
  const entity = isEntityRoute(pathname);
  const side = useCustomizationStore((state) => state.navigation) === "side";
  const header = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const drawn = useRef(side);

  useLayoutEffect(() => {
    if (drawn.current === side) return;
    drawn.current = side;
    if (reducedEffectsNow()) return;
    header.current?.animate([{ opacity: 0 }, { opacity: 1 }], SWAP);
    rail.current?.animate(
      [
        { opacity: 0, transform: "translateX(-12px)" },
        { opacity: 1, transform: "none" },
      ],
      SWAP,
    );
  }, [side]);

  const goBack = () => {
    if (window.history.length > 1) void navigate(-1);
    else void navigate("/library");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("a")];
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: controls.length - 1 };
    if (at < 0 || !(event.key in moves)) return;
    event.preventDefault();
    controls[(moves[event.key] + controls.length) % controls.length].focus();
  };

  if (side) {
    return (
      <>
        <Rail ref={rail} />
        <header ref={header} className={styles.bar} data-window-drag>
          <div className={styles.start}>
            <div className={`${styles.group} ${styles.tray}`} data-no-window-drag>
              <Tooltip text={t("ui.nav.back")}>
                <button
                  type="button"
                  aria-label={t("ui.nav.back")}
                  className={styles.item}
                  disabled={!ends.back && !entity}
                  onClick={() => (ends.back ? void navigate(-1) : void navigate("/library"))}
                >
                  <Icon name="back" size={20} />
                </button>
              </Tooltip>
              <Tooltip text={t("ui.nav.forward")}>
                <button type="button" aria-label={t("ui.nav.forward")} className={styles.item} disabled={!ends.forward} onClick={() => void navigate(1)}>
                  <Icon name="forward" size={20} />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className={`${styles.middle} ${styles.tucked}`} data-open={searchOpen ? "" : undefined}>
            <PaletteField />
          </div>
          <div className={styles.end}>
            <div className={`${styles.group} ${styles.tray}`}>
              <WindowButtons />
            </div>
          </div>
        </header>
      </>
    );
  }

  return (
    <header ref={header} className={styles.bar} data-window-drag>
      <div className={styles.start}>
        <a href="#/" className={styles.mark} aria-label="Nuvo" data-no-window-drag onClick={(event) => go(event, "/")}>
          <Icon name="nuvo-mark" size={24} />
        </a>
        <nav aria-label={t("ui.nav.label")} className={`${styles.group} ${styles.tray}`} data-no-window-drag onKeyDown={onKeyDown}>
          {sections.map((section) => (
            <Tooltip key={section.id} text={section.label}>
              <a
                href={`#${section.href}`}
                data-nav={section.id}
                aria-label={section.label}
                aria-current={section.id === active ? "page" : undefined}
                className={styles.item}
                onClick={(event) => go(event, section.href)}
              >
                {section.id === active ? <Lens group="top-nav" value={section.id} radius={18} /> : null}
                <Icon name={section.icon} size={24} filled={section.id === active} />
              </a>
            </Tooltip>
          ))}
        </nav>
        {pins.length > 0 ? (
          <nav aria-label={t("ui.nav.pinned")} className={`${styles.group} ${styles.tray} ${styles.pins}`} data-no-window-drag onKeyDown={onKeyDown}>
            {pins.map((pin) => (
              <Tooltip key={`${pin.kind}:${pin.id}`} text={pin.title}>
                <a
                  href={`#${pin.href}`}
                  data-pin={pin.kind}
                  aria-label={pin.title}
                  className={styles.item}
                  onClick={(event) => go(event, pin.href)}
                  onContextMenu={(event) => pinMenu.open(event, [{ label: t("ui.library.unpin"), onSelect: () => unpinEverywhere(pin.kind, pin.id) }])}
                >
                  <PinArt pin={pin} size={26} radius={6} />
                </a>
              </Tooltip>
            ))}
          </nav>
        ) : null}
        {pinMenu.element}
        {entity ? (
          <button type="button" className={styles.back} onClick={goBack} data-no-window-drag>
            <Icon name="back" size={16} />
            <span>{t("ui.nav.back")}</span>
          </button>
        ) : null}
      </div>
      <div className={styles.middle}>
        <PaletteField />
      </div>
      <div className={styles.end}>
        <div className={`${styles.group} ${styles.tray}`}>
          <Tooltip text={t("ui.nav.settings")}>
            <button
              type="button"
              aria-label={t("ui.nav.settings")}
              aria-pressed={settingsOpen}
              className={styles.item}
              data-nuvo-guard="grid"
              data-no-window-drag
              onClick={openSettings}
            >
              <Icon name="settings" size={24} filled={settingsOpen} />
            </button>
          </Tooltip>
          <span className={styles.rule} aria-hidden="true" />
          <WindowButtons />
        </div>
      </div>
    </header>
  );
}
