import type { JSX } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import type { SectionId } from "./sections";

const GLYPHS: Record<SectionId, IconName> = {
  Playback: "play",
  Sound: "equalizer",
  Hidden: "not-interested",
  Shortcuts: "keyboard",
  Appearance: "palette",
  Customization: "gallery",
  Notch: "widget",
  Youtube: "youtube",
  Lastfm: "history",
  Discord: "now-playing",
  Storage: "database",
  Network: "link",
  About: "info-circle",
};

export function SectionIcon({ id }: { id: SectionId }): JSX.Element {
  return <Icon name={GLYPHS[id]} size={18} />;
}

export function ClearGlyph(): JSX.Element {
  return <Icon name="clear-circle" size={14} />;
}
