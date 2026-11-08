import type { ButtonHTMLAttributes, JSX } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text";
  size?: "m" | "s";
}

export function Button({ variant = "secondary", size = "m", className, type = "button", children, ...buttonProps }: ButtonProps): JSX.Element {
  return (
    <button {...buttonProps} type={type} className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")}>
      {children}
    </button>
  );
}
