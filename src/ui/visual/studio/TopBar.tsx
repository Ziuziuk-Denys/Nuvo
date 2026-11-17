import type { JSX, ReactNode } from "react";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import type { Aspect } from "../../ports/visual";
import { Segmented } from "../../screens/settings/controls";
import theme from "./theme.module.css";
import type { Category } from "./types";
import styles from "./TopBar.module.css";

const FRAMES: { value: Aspect; label: string }[] = [
  { value: "tall", label: "9:16" },
  { value: "square", label: "1:1" },
  { value: "wide", label: "16:9" },
];

interface TopBarProps {
  category: Category;
  effects: { used: number; max: number };
  track: { title: string; artists: string; coverUrl?: string } | null;
  aspect: Aspect;
  onAspect(next: Aspect): void;
  onBack(): void;
  actions: ReactNode;
}

export function TopBar({ category, effects, track, aspect, onAspect, onBack, actions }: TopBarProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <header className={styles.bar} data-window-drag>
      <div className={styles.cell}>
        <button type="button" className={theme.icon} onClick={onBack} aria-label={t("visual.studio.back")} data-no-window-drag>
          <Icon name="back" size={18} />
        </button>
        <h2 key={category} className={`${theme.title} ${styles.title}`}>
          {t(`visual.studio.rail_${category}`)}
        </h2>
        {category === "atmosphere" ? (
          <span className={styles.count} data-full={effects.used >= effects.max ? "" : undefined}>
            {effects.used} / {effects.max}
          </span>
        ) : null}
      </div>
      <div className={styles.cell}>
        {track ? (
          <span className={styles.track}>
            <Cover src={track.coverUrl ?? ""} size={24} radius={5} />
            <b>{track.title}</b>
            <span>{track.artists}</span>
          </span>
        ) : null}
        <span className={styles.spacer} />
        <span data-no-window-drag>
          <Segmented label={t("visual.editor.frame")} options={FRAMES} value={aspect} onChange={onAspect} />
        </span>
      </div>
      <div className={`${styles.cell} ${styles.actions}`} data-no-window-drag>
        {actions}
      </div>
    </header>
  );
}
