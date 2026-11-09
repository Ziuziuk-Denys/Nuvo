import type { ButtonHTMLAttributes, JSX } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import styles from "./IconButton.module.css";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: IconName;
  label: string;
  size?: "m" | "s";
  tone?: "field" | "island";
  active?: boolean;
  tooltip?: boolean;
}

export function IconButton({
  icon,
  label,
  size = "m",
  tone = "field",
  active,
  tooltip = true,
  className,
  type = "button",
  ...buttonProps
}: IconButtonProps): JSX.Element {
  return (
    <Tooltip text={tooltip ? label : ""}>
      <button
        {...buttonProps}
        type={type}
        aria-label={label}
        aria-pressed={active}
        data-active={active ? "" : undefined}
        className={[styles.button, styles[size], styles[tone], className].filter(Boolean).join(" ")}
      >
        <Icon name={icon} size={size === "m" ? 18 : 16} />
      </button>
    </Tooltip>
  );
}
