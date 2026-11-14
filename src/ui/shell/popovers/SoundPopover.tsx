import { useRef, type JSX, type KeyboardEvent } from "react";
import { Lens } from "../../components/Lens";
import { POPOVER } from "../../geometry";
import { useTranslation } from "../../ports/i18n";
import { EqHeader, EqPanel } from "./EqPanel";
import { SleepPanel, SleepStatus } from "./SleepPanel";
import { MomentsPanel } from "./MomentsPanel";
import { SpeedPanel } from "./SpeedPanel";
import styles from "./popovers.module.css";

export type SoundTab = "eq" | "speed" | "sleep" | "moments";

export const SOUND_TABS: { id: SoundTab; width: 320 | 440 }[] = [
  { id: "eq", width: POPOVER.sound },
  { id: "speed", width: POPOVER.narrow },
  { id: "sleep", width: POPOVER.narrow },
  { id: "moments", width: POPOVER.narrow },
];

const TAB_LABELS: Record<SoundTab, string> = {
  eq: "ui.sound.tab_eq",
  speed: "ui.sound.tab_speed",
  sleep: "ui.sound.tab_sleep",
  moments: "ui.sound.tab_moments",
};

const STEPS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => index + 1,
  ArrowLeft: (index) => index - 1,
  Home: () => 0,
  End: () => SOUND_TABS.length - 1,
};

export function SoundPopover({ tab, onTab }: { tab: SoundTab; onTab(tab: SoundTab): void }): JSX.Element {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (step(index) + SOUND_TABS.length) % SOUND_TABS.length;
    onTab(SOUND_TABS[next].id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div className={styles.body}>
      <div ref={listRef} role="tablist" aria-label={t("ui.sound.title")} className={styles.segments}>
        {SOUND_TABS.map(({ id }, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            tabIndex={id === tab ? 0 : -1}
            className={styles.segment}
            onClick={() => onTab(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {id === tab ? <Lens group="sound-tab" value={tab} radius={8} /> : null}
            <span>{t(TAB_LABELS[id])}</span>
          </button>
        ))}
      </div>
      {tab === "eq" ? <EqPanel /> : tab === "speed" ? <SpeedPanel /> : tab === "sleep" ? <SleepPanel /> : <MomentsPanel />}
    </div>
  );
}

export function SoundTrailing({ tab }: { tab: SoundTab }): JSX.Element | null {
  if (tab === "eq") return <EqHeader />;
  if (tab === "sleep") return <SleepStatus />;
  return null;
}
