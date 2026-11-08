import type { JSX } from "react";
import { ICON_NAMES, ICON_STROKE, ICON_SVG, type IconName, type IconSize } from "./index";

/**
 * Every file shares one root tag (24 grid, currentColor, round caps), so only the drawing inside it is kept.
 * One object per name: React 19 compares the object, so a fresh one per render rewrites the SVG every time.
 */
const ICON_BODY = Object.fromEntries(
  ICON_NAMES.map((name) => [name, { __html: ICON_SVG[name].replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "") }]),
) as Record<IconName, { __html: string }>;

/** One glyph from the Nuvo set at a pixel size; line glyphs stroke at ICON_STROKE, filled ones at none. */
export function Icon({ name, size = 20, className }: { name: IconName; size?: IconSize; className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE[size]}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      // the markup is our own SVG files, bundled at build time
      dangerouslySetInnerHTML={ICON_BODY[name]}
    />
  );
}
