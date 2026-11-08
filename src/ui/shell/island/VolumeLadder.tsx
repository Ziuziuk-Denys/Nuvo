import type { ButtonHTMLAttributes, JSX } from "react";
import { IconButton } from "../../components/IconButton";
import type { IconName } from "../../icons";

export interface VolumeLadderProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Perceived level, 0 to 1. */
  level: number;
  label: string;
  tooltip?: boolean;
}

/** The speaker glyph for a level: crossed out at zero, one wave up to a third, two above. */
export function volumeGlyph(level: number): IconName {
  if (level <= 0) return "volume-mute";
  return level < 0.33 ? "volume-low" : "volume-high";
}

/** The volume button: the speaker glyph for the level, in the tool well's button style. */
export function VolumeLadder({ level, label, ...buttonProps }: VolumeLadderProps): JSX.Element {
  return <IconButton {...buttonProps} icon={volumeGlyph(level)} label={label} data-level={level.toFixed(2)} />;
}
