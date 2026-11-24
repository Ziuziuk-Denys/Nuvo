import type { JSX } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import type { SectionId } from "./sections";

const files = import.meta.glob<string>("./sectionGlyphs/*.svg", { query: "?raw", import: "default", eager: true });

const MARKS: Partial<Record<SectionId, IconName>> = {
  Youtube: "youtube",
  Lastfm: "lastfm",
  Discord: "discord",
  About: "nuvo-mark",
};

const GLYPHS = new Map(
  Object.entries(files).map(([path, svg]) => [path.slice("./sectionGlyphs/".length, -".svg".length), { __html: svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, "") }]),
);

export function SectionIcon({ id }: { id: SectionId }): JSX.Element {
  const mark = MARKS[id];
  if (mark) return <Icon name={mark} size={18} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // the markup is our own SVG files, bundled at build time
      dangerouslySetInnerHTML={GLYPHS.get(id)}
    />
  );
}

export function ClearGlyph(): JSX.Element {
  return <Icon name="clear-circle" size={14} />;
}
