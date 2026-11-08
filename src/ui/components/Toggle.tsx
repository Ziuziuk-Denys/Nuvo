import { useId, type JSX, type KeyboardEvent } from "react";
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible text, tied to the switch so clicking it toggles too. */
  label: string;
  /** The row around it already names the setting: the switch alone, with the label read out only. */
  labelHidden?: boolean;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, labelHidden = false, disabled }: ToggleProps): JSX.Element {
  const id = useId();

  // keydown handles Space and Enter alike; preventDefault stops the button's own click so it flips once
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat && !disabled) onChange(!checked);
  };

  const track = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelHidden ? label : undefined}
      disabled={disabled}
      className={styles.track}
      onClick={() => onChange(!checked)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.knob} />
    </button>
  );

  if (labelHidden) return track;

  return (
    <div className={styles.toggle} data-disabled={disabled ? "" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {track}
    </div>
  );
}
