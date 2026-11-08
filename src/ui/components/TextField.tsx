import { useId, type JSX, type ReactNode } from "react";
import { useTranslation } from "../ports/i18n";
import { IconButton } from "./IconButton";
import styles from "./TextField.module.css";

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The accessible name; kept off screen, the placeholder shows the intent. */
  label: string;
  size?: "m" | "l";
  autoFocus?: boolean;
  maxLength?: number;
  /** Given, a clear button appears while there is a value. */
  onClear?: () => void;
  /** Extra controls at the right end, after the clear button. */
  trailing?: ReactNode;
  /** Called on Enter. */
  onSubmit?: () => void;
  /** No tint of its own, for a field whose panel is the surface: the command palette. */
  bare?: boolean;
  type?: "text" | "password";
}

/** A borderless tint field. The focus ring wraps the whole field, the clear button included. */
export function TextField({
  value,
  onChange,
  placeholder,
  label,
  size = "m",
  autoFocus,
  maxLength,
  onClear,
  trailing,
  onSubmit,
  bare,
  type = "text",
}: TextFieldProps): JSX.Element {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className={[styles.field, styles[size], bare ? styles.bare : ""].join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) onSubmit?.();
        }}
      />
      {value && onClear ? <IconButton icon="close" label={t("ui.clear")} size="s" onClick={onClear} /> : null}
      {trailing}
    </div>
  );
}
