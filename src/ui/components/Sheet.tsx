import { useId, useRef, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { LAYER_ATTRIBUTE, trapTab, useLayer, usePresence } from "./layers";
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
  /** Right-aligned; the primary closes the line. */
  actions: SheetAction[];
  /** False for steps that must be finished, such as the recovery phrase: Escape and the backdrop do nothing. */
  dismissible?: boolean;
  children: ReactNode;
}

/** A centred modal dialog over the dimmed field. */
export function Sheet({ open, onClose, title, actions, dismissible = true, children }: SheetProps): JSX.Element | null {
  const phase = usePresence(open);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // a drag that starts in the panel and ends on the backdrop is a text selection, not a dismissal
  const pressedOutside = useRef(false);
  const ordered = [...actions].sort((a, b) => Number(!!a.primary) - Number(!!b.primary));

  // a sheet that cannot be dismissed still holds its place on the stack, so Escape never reaches the layer below
  useLayer(open, panelRef, { onEscape: () => dismissible && onClose() });

  if (phase === null) return null;

  const outside = (target: EventTarget) => !(target instanceof Node && panelRef.current?.contains(target));

  return createPortal(
    <div
      className={styles.layer}
      data-state={phase}
      {...{ [LAYER_ATTRIBUTE]: "" }}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event.target);
      }}
      onClick={(event) => {
        if (dismissible && pressedOutside.current && outside(event.target)) onClose();
        pressedOutside.current = false;
      }}
    >
      <div className={styles.backdrop} data-state={phase} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.panel}
        data-state={phase}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
      >
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
      </div>
    </div>,
    document.body,
  );
}
