import type { JSX } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import type { SectionId } from "./sections";

const GLYPHS: Record<SectionId, IconName> = {
  Language: "globe",
  Startup: "window-restore",
  Updates: "refresh",
  Playback: "play",
  BetweenSongs: "blend",
  Sound: "equalizer",
  Spatial: "reverb",
  Lyrics: "lyrics",
  Theme: "palette",
  Fonts: "studio-text",
  Background: "gallery",
  Player: "now-playing",
  Motion: "motion",
  Notch: "widget",
  Shortcuts: "keyboard",
  Youtube: "youtube",
  Lastfm: "lastfm",
  Discord: "discord",
  Privacy: "lock",
  Storage: "database",
  Network: "link",
  Tools: "tools",
  About: "nuvo-mark",
};

export function SectionIcon({ id }: { id: SectionId }): JSX.Element {
  return <Icon name={GLYPHS[id]} size={18} />;
}

export function ClearGlyph(): JSX.Element {
  return <Icon name="clear-circle" size={14} />;
}
