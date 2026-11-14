import { useId, type JSX, type ReactNode } from "react";
import { Button } from "./Button";
import { ModalPanel } from "./ModalPanel";
import styles from "./Sheet.module.css";

export interface SheetAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  actions: SheetAction[];
  dismissible?: boolean;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, actions, dismissible = true, children }: SheetProps): JSX.Element | null {
  const titleId = useId();
  const ordered = [...actions].sort((a, b) => Number(!!a.primary) - Number(!!b.primary));

  return (
    <ModalPanel open={open} onClose={onClose} labelledBy={titleId} dismissible={dismissible} classes={styles}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
      {ordered.length > 0 ? (
        <div className={styles.actions}>
          {ordered.map((action) => (
            <Button key={action.label} variant={action.primary ? "primary" : "secondary"} disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </ModalPanel>
  );
}
