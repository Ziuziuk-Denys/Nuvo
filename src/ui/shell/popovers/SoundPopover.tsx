import type { JSX } from "react";
import { Tabs } from "../../components/Tabs";
import { POPOVER } from "../../geometry";
import { useTranslation } from "../../ports/i18n";
import { EqHeader, EqPanel } from "./EqPanel";
import { SleepPanel, SleepStatus } from "./SleepPanel";
import { MomentsPanel } from "./MomentsPanel";
import { SpeedPanel } from "./SpeedPanel";
import styles from "./popovers.module.css";

export type SoundTab = "eq" | "speed" | "sleep" | "moments";

/** The player sizes the popover from the active tab: the curve needs the wide one, the rest one width that holds the four tabs. */
export const SOUND_TABS: { id: SoundTab; width: 440 | 560 }[] = [
  { id: "eq", width: POPOVER.wide },
  { id: "speed", width: POPOVER.sound },
  { id: "sleep", width: POPOVER.sound },
  { id: "moments", width: POPOVER.sound },
];

const TAB_LABELS: Record<SoundTab, string> = {
  eq: "ui.sound.tab_eq",
  speed: "ui.sound.tab_speed",
  sleep: "ui.sound.tab_sleep",
  moments: "ui.sound.tab_moments",
};

/** The Sound popover's content: the tabs, then the active panel. The island owns the Popover around it. */
export function SoundPopover({ tab, onTab }: { tab: SoundTab; onTab(tab: SoundTab): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.body}>
      <Tabs items={SOUND_TABS.map(({ id }) => ({ id, label: t(TAB_LABELS[id]) }))} value={tab} onChange={onTab} label={t("ui.sound.title")} />
      {tab === "eq" ? <EqPanel /> : tab === "speed" ? <SpeedPanel /> : tab === "sleep" ? <SleepPanel /> : <MomentsPanel />}
    </div>
  );
}

/** The header controls of the active tab, passed as the Popover's `trailing`. */
export function SoundTrailing({ tab }: { tab: SoundTab }): JSX.Element | null {
  if (tab === "eq") return <EqHeader />;
  if (tab === "sleep") return <SleepStatus />;
  return null;
}
