import { useRef, type CSSProperties, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAYER_ATTRIBUTE, trapTab, useLayer, usePresence } from "./layers";

export interface ModalPanelProps {
  open: boolean;
  onClose(): void;
  labelledBy: string;
  dismissible?: boolean;
  classes: Readonly<Record<string, string>>;
  style?: CSSProperties;
  children: ReactNode;
}

export function ModalPanel({ open, onClose, labelledBy, dismissible = true, classes, style, children }: ModalPanelProps): JSX.Element | null {
  const phase = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  // a drag that starts in the panel and ends on the backdrop is a text selection, not a dismissal
  const pressedOutside = useRef(false);
  useLayer(open, panelRef, { onEscape: () => dismissible && onClose() });

  if (phase === null) return null;

  const outside = (target: EventTarget) => !(target instanceof Node && panelRef.current?.contains(target));

  return createPortal(
    <div
      className={classes.layer}
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
      <div className={classes.backdrop} data-state={phase} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={classes.panel}
        style={style}
        data-state={phase}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
