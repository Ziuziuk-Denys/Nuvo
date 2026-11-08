import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { ISLAND_SIZES, WING, islandPath, type IslandMode } from "./lib/geometry";
import { MORPH_SPRING, springEasing } from "./lib/spring";

export const MORPH = springEasing(MORPH_SPRING);

interface IslandProps extends HTMLAttributes<HTMLDivElement> {
  mode: IslandMode;
  children: ReactNode;
}

/** The black silhouette and its box; both morph with the same spring so they stay one shape. */
export const Island = forwardRef<HTMLDivElement, IslandProps>(function Island({ mode, children, ...rest }, ref) {
  const size = ISLAND_SIZES[mode];
  const d = islandPath(size);
  const style = {
    width: size.width + WING * 2,
    height: size.height,
    "--morph-ease": MORPH.easing,
    "--morph-ms": `${MORPH.durationMs}ms`,
  } as CSSProperties;
  return (
    <div ref={ref} className="island" data-mode={mode} style={style} {...rest}>
      <svg className="island-shape" aria-hidden="true">
        {/* The attribute is the static shape; the CSS property is what transitions. */}
        <path d={d} style={{ d: `path("${d}")` } as CSSProperties} />
      </svg>
      <div className="island-body" style={{ left: WING, right: WING, borderRadius: `0 0 ${size.radius}px ${size.radius}px` }}>
        {children}
      </div>
    </div>
  );
});
