import type { CSSProperties, JSX } from "react";
import { Tooltip } from "../../components/Tooltip";
import type { IconName } from "../../icons";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import type { Category } from "./types";
import styles from "./Rail.module.css";

const ITEMS: { id: Category; icon: IconName }[] = [
  { id: "scenes", icon: "studio-scenes" },
  { id: "background", icon: "studio-background" },
  { id: "atmosphere", icon: "studio-effects" },
  { id: "centrepiece", icon: "studio-centre" },
  { id: "lyrics", icon: "studio-text" },
  { id: "media", icon: "studio-media" },
];

export function Rail({ category, onCategory }: { category: Category; onCategory(next: Category): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav className={styles.rail} aria-label={t("visual.studio.title")}>
      <span className={styles.tab} style={{ "--at": ITEMS.findIndex((item) => item.id === category) } as CSSProperties} aria-hidden="true" />
      {ITEMS.map((item) => (
        <Tooltip key={item.id} text={t(`visual.studio.rail_${item.id}`)} side="right">
          <button
            type="button"
            className={styles.item}
            aria-pressed={category === item.id}
            aria-label={t(`visual.studio.rail_${item.id}`)}
            onClick={() => onCategory(item.id)}
          >
            <Icon name={item.icon} size={20} />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
