import type { ButtonHTMLAttributes, JSX } from "react";
import styles from "./Chip.module.css";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  active: boolean;
}

/** One choice in a set (speed, sleep length, mode). The parent owns the state. */
export function Chip({ active, className, type = "button", children, ...buttonProps }: ChipProps): JSX.Element {
  return (
    <button {...buttonProps} type={type} aria-pressed={active} className={[styles.chip, className].filter(Boolean).join(" ")}>
      {children}
    </button>
  );
}
