import type { JSX } from "react";
import { Button } from "./Button";
import styles from "./EmptyState.module.css";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  /** Up to two. With two, the secondary comes first and the primary closes the line. */
  actions?: EmptyStateAction[];
  /** The tour's hook for this state; it outlines the type and the actions, not the whole area. */
  tour?: string;
}

/** Type and at most two actions, centred in the page's area. No icon, no illustration. */
export function EmptyState({ title, message, actions = [], tour }: EmptyStateProps): JSX.Element {
  const ordered = actions.slice(0, 2).sort((a, b) => Number(!!a.primary) - Number(!!b.primary));

  return (
    <div className={styles.area} data-empty-state="">
      <div className={styles.empty} data-tour={tour}>
        <h2 className={styles.title}>{title}</h2>
        {message ? <p className={styles.message}>{message}</p> : null}
        {ordered.length > 0 ? (
          <div className={styles.actions}>
            {ordered.map((action) => (
              <Button key={action.label} variant={action.primary ? "primary" : "secondary"} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
