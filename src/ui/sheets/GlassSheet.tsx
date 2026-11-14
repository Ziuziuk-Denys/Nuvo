import type { JSX, ReactNode } from "react";
import { ModalPanel } from "../components/ModalPanel";
import styles from "./GlassSheet.module.css";

export interface GlassSheetProps {
  open: boolean;
  onClose(): void;
  labelledBy: string;
  width?: number;
  dismissible?: boolean;
  children: ReactNode;
}

export function GlassSheet({ open, onClose, labelledBy, width = 420, dismissible = true, children }: GlassSheetProps): JSX.Element | null {
  return (
    <ModalPanel open={open} onClose={onClose} labelledBy={labelledBy} dismissible={dismissible} classes={styles} style={{ maxWidth: width }}>
      {children}
    </ModalPanel>
  );
}
