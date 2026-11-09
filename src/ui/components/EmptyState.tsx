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
  actions?: EmptyStateAction[];
  tour?: string;
}

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
