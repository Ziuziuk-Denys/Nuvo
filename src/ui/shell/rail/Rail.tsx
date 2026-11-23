import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Lens } from "../../components/Lens";
import { LAYER_ATTRIBUTE } from "../../components/layers";
import { useContextMenu } from "../../components/Menu";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { usePlayerStore } from "../../ports/player";
import { useCustomizationStore } from "../../ports/settings";
import { unpinEverywhere } from "../../screens/entity/entityActions";
import { PinArt } from "../PinArt";
import { useNav } from "../useNav";
import styles from "./Rail.module.css";

const LENS = "side-nav";
const LENS_RADIUS = 14;
const FOLLOW = 0.14;
const TIP_DELAY_MS = 140;

const RAIL_ICONS: Partial<Record<string, IconName>> = {
  home: "rail-home",
  library: "rail-library",
  stats: "rail-stats",
  recognize: "rail-recognize",
};

interface Tip {
  text: string;
  top: number;
  left: number;
}

const itemOf = (target: EventTarget) => (target instanceof Element ? target.closest<HTMLElement>("[data-rail-item]") : null);

function Name({ shown, children }: { shown: boolean; children: ReactNode }): JSX.Element | null {
  return shown ? (
    <span className={styles.name} aria-hidden="true">
      {children}
    </span>
  ) : null;
}

export function Rail({ ref }: { ref: Ref<HTMLElement> }): JSX.Element {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const { sections, pins, active, go } = useNav();
  const open = useCustomizationStore((state) => state.railOpen);
  const setOpen = useCustomizationStore((state) => state.setRailOpen);
  const searchOpen = useModalStore((state) => state.searchOpen);
  const openSearch = useModalStore((state) => state.openSearch);
  const closeSearch = useModalStore((state) => state.closeSearch);
  const settingsOpen = useModalStore((state) => state.settingsOpen);
  const openSettings = useModalStore((state) => state.openSettings);
  const context = usePlayerStore((state) => state.playbackContext);
  const moving = usePlayerStore((state) => state.status === "playing");
  const pinMenu = useContextMenu();
  const [tip, setTip] = useState<Tip | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pressed = useRef(false);

  const here = pathname + search;
  const openPin = pins.find((pin) => pin.href === here);
  const lens = openPin ? `${openPin.kind}:${openPin.id}` : active;

  const hideTip = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!tip) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hideTip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tip]);

  const showTip = (item: HTMLElement, delay: number) => {
    const name = item.querySelector<HTMLElement>(`.${styles.name}`);
    const text = item.dataset.railItem ?? "";
    if (text === "" || (name && name.scrollWidth <= name.clientWidth)) {
      hideTip();
      return;
    }
    const box = item.getBoundingClientRect();
    const next = { text, top: box.top + box.height / 2, left: (list.current?.getBoundingClientRect().right ?? box.right) + 12 };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTip(next), delay);
  };

  const moveGlow = (item: HTMLElement, pull: number) => {
    const mark = glow.current;
    if (!mark || !list.current) return;
    const box = item.getBoundingClientRect();
    const top = box.top - list.current.getBoundingClientRect().top + pull;
    const shown = mark.dataset.shown !== undefined;
    mark.style.transitionDuration = shown ? "" : "0ms";
    mark.style.transform = `translate(0, ${top}px)`;
    mark.dataset.shown = "";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const item = itemOf(event.target);
    if (!item || event.pointerType === "touch") return;
    const box = item.getBoundingClientRect();
    moveGlow(item, (event.clientY - box.top - box.height / 2) * FOLLOW);
    if (!pressed.current && tip?.text !== item.dataset.railItem) showTip(item, tip ? 0 : TIP_DELAY_MS);
  };

  const onPointerLeave = () => {
    pressed.current = false;
    if (glow.current) delete glow.current.dataset.shown;
    hideTip();
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const item = itemOf(event.target);
    if (item?.matches(":focus-visible")) showTip(item, 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-item]")];
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: controls.length - 1 };
    if (at < 0 || !(event.key in moves)) return;
    event.preventDefault();
    controls[(moves[event.key] + controls.length) % controls.length].focus();
  };

  const [home, ...others] = sections.map((section) => (
    <a
      key={section.id}
      href={`#${section.href}`}
      data-nav={section.id}
      data-rail-item={section.label}
      aria-label={section.label}
      aria-current={section.id === lens ? "page" : undefined}
      className={styles.item}
      onClick={(event) => go(event, section.href)}
    >
      {section.id === lens ? <Lens group={LENS} value={section.id} radius={LENS_RADIUS} /> : null}
      <Icon name={RAIL_ICONS[section.id] ?? section.icon} size={24} />
      <Name shown={open}>{section.label}</Name>
    </a>
  ));
  const openText = t(open ? "ui.nav.hide_names" : "ui.nav.show_names");

  return (
    <aside ref={ref} className={styles.rail} data-open={open ? "" : undefined} data-window-drag>
      <a href="#/" className={styles.mark} aria-label="Nuvo" data-no-window-drag onClick={(event) => go(event, "/")}>
        <Icon name="nuvo-mark" size={24} />
      </a>
      <div
        ref={list}
        className={styles.list}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={() => {
          pressed.current = true;
          hideTip();
        }}
        onFocus={onFocus}
        onBlur={hideTip}
        onKeyDown={onKeyDown}
      >
        <span ref={glow} className={styles.glow} aria-hidden="true" />
        <nav aria-label={t("ui.nav.label")} className={styles.group} data-no-window-drag>
          {home}
          <button
            type="button"
            data-nav="search"
            data-rail-item={t("ui.nav.search")}
            aria-label={t("ui.nav.search")}
            aria-expanded={searchOpen}
            className={styles.item}
            {...{ [LAYER_ATTRIBUTE]: "" }}
            onClick={searchOpen ? closeSearch : openSearch}
          >
            <Icon name="rail-search" size={24} />
            <Name shown={open}>{t("ui.nav.search")}</Name>
          </button>
          {others}
        </nav>
        {pins.length > 0 ? (
          <nav aria-label={t("ui.nav.pinned")} className={`${styles.group} ${styles.pins}`} data-no-window-drag>
            {pins.map((pin) => {
              const key = `${pin.kind}:${pin.id}`;
              const playing = context === key;
              return (
                <a
                  key={key}
                  href={`#${pin.href}`}
                  data-pin={pin.kind}
                  data-rail-item={pin.title}
                  data-playing={playing ? "" : undefined}
                  aria-label={playing ? t("ui.nav.playing", { title: pin.title }) : pin.title}
                  aria-current={key === lens ? "page" : undefined}
                  className={styles.item}
                  onClick={(event) => go(event, pin.href)}
                  onContextMenu={(event) => pinMenu.open(event, [{ label: t("ui.library.unpin"), onSelect: () => unpinEverywhere(pin.kind, pin.id) }])}
                >
                  {key === lens ? <Lens group={LENS} value={key} radius={LENS_RADIUS} /> : null}
                  <span className={styles.art} data-round={pin.kind === "artist" ? "" : undefined}>
                    <PinArt pin={pin} size={32} radius={8} />
                    {playing ? (
                      <span className={styles.bars} data-moving={moving ? "" : undefined} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                  </span>
                  <Name shown={open}>{pin.title}</Name>
                </a>
              );
            })}
          </nav>
        ) : null}
        <div className={`${styles.group} ${styles.foot}`} data-no-window-drag>
          <button
            type="button"
            data-rail-item={openText}
            aria-label={openText}
            aria-expanded={open}
            className={styles.item}
            onClick={() => {
              hideTip();
              setOpen(!open);
            }}
          >
            <Icon name="rail-names" size={24} />
            <Name shown={open}>{openText}</Name>
          </button>
          <button
            type="button"
            data-rail-item={t("ui.nav.settings")}
            aria-label={t("ui.nav.settings")}
            aria-pressed={settingsOpen}
            className={styles.item}
            data-nuvo-guard="grid"
            onClick={openSettings}
          >
            <Icon name="settings" size={24} />
            <Name shown={open}>{t("ui.nav.settings")}</Name>
          </button>
        </div>
      </div>
      {pinMenu.element}
      {tip ? createPortal(<TipBubble tip={tip} />, document.body) : null}
    </aside>
  );
}

function TipBubble({ tip }: { tip: Tip }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useLayoutEffect(() => {
    if (ref.current) ref.current.style.transitionDuration = entered.current ? "" : "0ms";
    entered.current = true;
  }, [tip]);

  return (
    <div ref={ref} role="tooltip" className={styles.tip} style={{ left: tip.left, transform: `translateY(${tip.top}px)` }}>
      <span key={tip.text}>{tip.text}</span>
    </div>
  );
}
