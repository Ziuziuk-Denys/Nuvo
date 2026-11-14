import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { Cutout } from "./contracts";
import { WING, islandPath, type IslandMode, type IslandSize } from "./lib/geometry";
import { MORPH_SPRING, springEasing } from "./lib/spring";

export const MORPH = springEasing(MORPH_SPRING);

interface IslandProps extends HTMLAttributes<HTMLDivElement> {
  mode: IslandMode;
  size: IslandSize;
  cutout: Cutout | null;
  children: ReactNode;
}

export const Island = forwardRef<HTMLDivElement, IslandProps>(function Island({ mode, size, cutout, children, ...rest }, ref) {
  const d = islandPath(size);
  const style = {
    width: size.width + WING * 2,
    height: size.height,
    "--morph-ease": MORPH.easing,
    "--morph-ms": `${MORPH.durationMs}ms`,
    "--cutout-height": `${cutout?.height ?? 0}px`,
  } as CSSProperties;
  return (
    <div ref={ref} className="island" data-mode={mode} data-cutout={cutout ? "" : undefined} style={style} {...rest}>
      <svg className="island-shape" aria-hidden="true">
        <path d={d} style={{ d: `path("${d}")` } as CSSProperties} />
      </svg>
      <div className="island-body" style={{ left: WING, right: WING, borderRadius: `0 0 ${size.radius}px ${size.radius}px` }}>
        {children}
      </div>
    </div>
  );
});
