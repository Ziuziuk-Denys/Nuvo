import type { ButtonHTMLAttributes, JSX } from "react";
import { IconButton } from "../../components/IconButton";
import type { IconName } from "../../icons";

export interface VolumeLadderProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  level: number;
  label: string;
  tooltip?: boolean;
}

export function volumeGlyph(level: number): IconName {
  if (level <= 0) return "volume-mute";
  return level < 0.33 ? "volume-low" : "volume-high";
}

export function VolumeLadder({ level, label, ...buttonProps }: VolumeLadderProps): JSX.Element {
  return <IconButton {...buttonProps} icon={volumeGlyph(level)} label={label} data-level={level.toFixed(2)} />;
}
