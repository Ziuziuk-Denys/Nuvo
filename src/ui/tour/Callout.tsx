import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import pop from "../components/Popover.module.css";
import type { Side } from "./chapters";
import { CALLOUT_WIDTH, placeCallout, type Area, type Box } from "./placement";
import styles from "./tour.module.css";

const GUESS_HEIGHT = 64;

const SHIFT: Record<Side, string> = { below: "-4px", above: "4px", right: "0px", left: "0px" };

interface CalloutProps {
  ring: Box;
  panel: Box | null;
  area: Area;
  side?: Side;
  text: string;
  stepKey: string;
}

export function Callout({ ring, panel, area, side, text, stepKey }: CalloutProps): JSX.Element {
  const cardRef = useRef<HTMLParagraphElement>(null);
  const [height, setHeight] = useState(GUESS_HEIGHT);

  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight;
    if (measured && measured !== height) setHeight(measured);
  });

  const place = placeCallout(ring, { width: CALLOUT_WIDTH, height }, area, side, panel);
  const style = {
    width: CALLOUT_WIDTH,
    transform: `translate3d(${Math.round(place.x)}px, ${Math.round(place.y)}px, 0)`,
  } as CSSProperties;

  return (
    <>
      <svg key={`line-${stepKey}`} className={styles.line} aria-hidden="true">
        <line x1={place.from.x} y1={place.from.y} x2={place.to.x} y2={place.to.y} />
        <circle cx={place.from.x} cy={place.from.y} r={2.5} />
      </svg>
      <div className={styles.callout} style={style}>
        <p
          key={stepKey}
          ref={cardRef}
          data-callout=""
          className={`${styles.card} ${styles.calloutCard} ${pop.pop}`}
          data-state="in"
          style={{ "--shift": SHIFT[place.side] } as CSSProperties}
        >
          {text}
        </p>
      </div>
    </>
  );
}
